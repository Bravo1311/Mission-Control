import { bytes, decodeRawImage, decodeLidar, sensorProblem, compressedDimensions } from '../lib/sensorData.js';
import { performanceProfile } from '../lib/performanceProfile.js';

function lidarImage(msg, range, profile) {
  const { points, count, total } = decodeLidar(msg, profile.maxPoints);
  const canvas = new OffscreenCanvas(profile.lidarSize, profile.lidarSize);
  const ctx = canvas.getContext('2d');
  ctx.scale(profile.lidarSize / 800, profile.lidarSize / 800);
  ctx.fillStyle = '#10141a'; ctx.fillRect(0, 0, 800, 800);
  ctx.strokeStyle = '#2b3947'; ctx.lineWidth = 1;
  for (const radius of [100, 200, 300, 380]) {
    ctx.beginPath(); ctx.arc(400, 400, radius, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(400, 20); ctx.lineTo(400, 780); ctx.moveTo(20, 400); ctx.lineTo(780, 400); ctx.stroke();
  ctx.fillStyle = '#a0b1c2'; ctx.font = '20px monospace';
  ctx.fillText('+X / forward', 412, 24); ctx.fillText('+Y / left', 20, 388);
  ctx.fillText(`${range} m radius`, 16, 778);
  const scale = 380 / range;
  ctx.fillStyle = '#ff4d0a';
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const x = 400 - points[i * 3 + 1] * scale;
    const y = 400 - points[i * 3] * scale;
    if (x < 0 || x >= 800 || y < 0 || y >= 800) continue;
    ctx.fillRect(x, y, 2, 2); drawn++;
  }
  ctx.fillStyle = '#e2eaf2'; ctx.beginPath(); ctx.moveTo(400, 391); ctx.lineTo(394, 407); ctx.lineTo(406, 407); ctx.closePath(); ctx.fill();
  return { bitmap: canvas.transferToImageBitmap(), note: `${drawn.toLocaleString()} drawn / ${total.toLocaleString()} input points · XY projection` };
}

async function cameraImage(msg, profile) {
  if (msg.encoding) {
    const frame = decodeRawImage(msg, profile);
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    canvas.getContext('2d').putImageData(new ImageData(frame.rgba, frame.width, frame.height), 0, 0);
    return { bitmap: canvas.transferToImageBitmap(), note: `${frame.sourceWidth} × ${frame.sourceHeight} · ${frame.note}` };
  }
  if (/compressedDepth/i.test(msg.format)) throw new Error('compressedDepth transport is not supported. Select a raw 16UC1 or 32FC1 depth topic.');
  const data = bytes(msg.data);
  const dimensions = compressedDimensions(data);
  const scale = Math.min(1, profile.maxWidth / dimensions.width, profile.maxHeight / dimensions.height);
  // Decode directly to the display budget and transfer the decoded bitmap.
  // No second canvas, draw or bitmap allocation for compressed frames.
  const bitmap = await createImageBitmap(new Blob([data]), {
    resizeWidth: Math.max(1, Math.floor(dimensions.width * scale)),
    resizeHeight: Math.max(1, Math.floor(dimensions.height * scale)),
    resizeQuality: 'low',
  });
  return { bitmap, note: `${dimensions.width} × ${dimensions.height} · ${msg.format || 'compressed image'}${msg.preview?.note ? ` · ${msg.preview.note}` : ''}` };
}

self.onmessage = async ({ data: { kind, msg, range, mode } }) => {
  try {
    const started = performance.now();
    const problem = sensorProblem(msg, kind);
    if (problem) throw new Error(problem);
    const profile = performanceProfile(mode);
    const result = kind === 'camera' ? await cameraImage(msg, profile) : lidarImage(msg, range, profile);
    self.postMessage({ ...result, decodeMs: performance.now() - started }, [result.bitmap]);
  } catch (error) {
    self.postMessage({ error: error.message || 'Could not decode sensor frame.' });
  }
};
