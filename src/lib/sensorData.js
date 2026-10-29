// Hard budgets apply before decoding or allocating image/point output.
export const MAX_SENSOR_BYTES = 16 * 1024 * 1024;
export const MAX_POINTS = 12000;
export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;

export function byteLength(data) {
  if (typeof data === 'string') return Math.ceil(data.length * 3 / 4);
  return data?.byteLength ?? data?.length ?? 0;
}

export function sensorProblem(msg, kind) {
  if (byteLength(msg.data) > MAX_SENSOR_BYTES) return 'Frame exceeds the 16 MiB preview limit. Reduce resolution or downsample at the publisher.';
  if (kind === 'camera' && msg.width * msg.height > MAX_IMAGE_PIXELS) return 'Image exceeds the 16 megapixel preview limit.';
  if (msg.ranges?.length > 1000000) return 'Scan exceeds the one-million-ray input limit.';
  return null;
}

export function bytes(data) {
  if (byteLength(data) > MAX_SENSOR_BYTES) throw new Error('Frame exceeds the 16 MiB preview limit.');
  if (typeof data === 'string') {
    const binary = atob(data);
    // Avoid the iterator + callback allocation for every byte of every frame.
    const result = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
    return result;
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  throw new Error('Missing or unsupported binary payload.');
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}.`);
  return value;
}

export function decodeRawImage(msg, { maxWidth = 1280, maxHeight = 720 } = {}) {
  const width = positiveInteger(msg.width, 'image width');
  const height = positiveInteger(msg.height, 'image height');
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('Image exceeds the 16 megapixel preview limit.');
  const encoding = String(msg.encoding).toLowerCase();
  const channels = { rgb8: 3, bgr8: 3, rgba8: 4, bgra8: 4, mono8: 1, '8uc1': 1 }[encoding];
  const depth = ['16uc1', 'mono16', '32fc1'].includes(encoding);
  const pixelBytes = channels || (encoding === '32fc1' ? 4 : depth ? 2 : 0);
  if (!pixelBytes) throw new Error(`Unsupported image encoding: ${msg.encoding}. Use rgb8, bgr8, rgba8, bgra8, mono8, mono16, 16UC1 or 32FC1.`);
  const step = positiveInteger(msg.step, 'image row stride');
  if (step < width * pixelBytes) throw new Error('Image row stride is shorter than its pixels.');
  const data = bytes(msg.data);
  if (step * height > data.length) throw new Error('Truncated image payload.');
  const scale = Math.min(1, Math.min(1280, positiveInteger(maxWidth, 'output width')) / width,
    Math.min(720, positiveInteger(maxHeight, 'output height')) / height);
  const outWidth = Math.max(1, Math.floor(width * scale));
  const outHeight = Math.max(1, Math.floor(height * scale));
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const little = !msg.is_bigendian;
  for (let y = 0; y < outHeight; y++) {
    const row = Math.floor(y * height / outHeight) * step;
    for (let x = 0; x < outWidth; x++) {
      const offset = row + Math.floor(x * width / outWidth) * pixelBytes;
      const target = (y * outWidth + x) * 4;
      if (depth) {
        // Fixed scale avoids a full-frame min/max pass and brightness flicker.
        const value = encoding === '32fc1' ? view.getFloat32(offset, little) : view.getUint16(offset, little);
        const normalized = encoding === 'mono16' ? value / 65535 : value / (encoding === '32fc1' ? 10 : 10000);
        const gray = Number.isFinite(normalized) && normalized > 0 ? Math.round(Math.min(1, normalized) * 255) : 0;
        rgba[target] = rgba[target + 1] = rgba[target + 2] = gray;
      } else if (channels === 1) {
        rgba[target] = rgba[target + 1] = rgba[target + 2] = data[offset];
      } else {
        const bgr = encoding.startsWith('bgr');
        rgba[target] = data[offset + (bgr ? 2 : 0)];
        rgba[target + 1] = data[offset + 1];
        rgba[target + 2] = data[offset + (bgr ? 0 : 2)];
      }
      rgba[target + 3] = channels === 4 ? data[offset + 3] : 255;
    }
  }
  return { rgba, width: outWidth, height: outHeight, sourceWidth: width, sourceHeight: height,
    note: depth ? (encoding === 'mono16' ? 'Intensity: 0–65535' : 'Depth: black 0 m → white 10 m') : encoding };
}

export function decodeLidar(msg, limit = MAX_POINTS) {
  limit = Math.max(1, Math.min(MAX_POINTS, Math.floor(limit)));
  const out = new Float32Array(limit * 3);
  let count = 0;
  const add = (x, y, z) => {
    if (![x, y, z].every(Number.isFinite)) return;
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1e7) return;
    out[count * 3] = x; out[count * 3 + 1] = y; out[count * 3 + 2] = z; count++;
  };
  let total;
  if (msg.ranges) {
    total = msg.ranges.length;
    if (total > 1000000) throw new Error('Scan exceeds the one-million-ray input limit.');
    if (![msg.angle_min, msg.angle_increment, msg.range_min, msg.range_max].every(Number.isFinite)) throw new Error('Invalid LaserScan bounds.');
    const stride = Math.max(1, Math.ceil(total / limit));
    for (let i = 0; i < total; i += stride) {
      const r = msg.ranges[i];
      if (!Number.isFinite(r) || r < msg.range_min || r > msg.range_max) continue;
      const angle = msg.angle_min + i * msg.angle_increment;
      add(r * Math.cos(angle), r * Math.sin(angle), 0);
    }
  } else {
    if (msg.width === 0 || msg.height === 0) return { points: out.subarray(0, 0), count: 0, total: 0 };
    const width = positiveInteger(msg.width, 'cloud width');
    const height = positiveInteger(msg.height, 'cloud height');
    const pointStep = positiveInteger(msg.point_step, 'point stride');
    const rowStep = positiveInteger(msg.row_step, 'cloud row stride');
    if (rowStep < width * pointStep) throw new Error('Cloud row stride is shorter than its points.');
    const data = bytes(msg.data);
    if (rowStep * height > data.length) throw new Error('Truncated point cloud payload.');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const little = !msg.is_bigendian;
    const readers = { 1: ['getInt8', 1], 2: ['getUint8', 1], 3: ['getInt16', 2], 4: ['getUint16', 2],
      5: ['getInt32', 4], 6: ['getUint32', 4], 7: ['getFloat32', 4], 8: ['getFloat64', 8] };
    const fields = ['x', 'y', 'z'].map(name => {
      const field = msg.fields?.find(f => f.name === name);
      const reader = readers[field?.datatype];
      if (!field || !reader || field.count < 1 || !Number.isInteger(field.offset) || field.offset < 0 || field.offset + reader[1] > pointStep) throw new Error(`Missing or unsupported ${name} coordinate field.`);
      return offset => view[reader[0]](offset + field.offset, little);
    });
    total = width * height;
    const stride = Math.max(1, Math.ceil(total / limit));
    for (let i = 0; i < total; i += stride) {
      const offset = Math.floor(i / width) * rowStep + (i % width) * pointStep;
      add(fields[0](offset), fields[1](offset), fields[2](offset));
    }
  }
  return { points: out.subarray(0, count * 3), count, total };
}

// Read JPEG/PNG dimensions before handing compressed data to the browser decoder.
export function compressedDimensions(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let width, height;
  if (data.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < data.length) {
      if (data[offset++] !== 0xff) throw new Error('Invalid JPEG marker.');
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > data.length) throw new Error('Truncated JPEG payload.');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw new Error('Invalid JPEG size header.');
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  }
  positiveInteger(width, 'compressed image width (JPEG/PNG required)');
  positiveInteger(height, 'compressed image height');
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('Decoded image exceeds the 16 megapixel preview limit.');
  return { width, height };
}
