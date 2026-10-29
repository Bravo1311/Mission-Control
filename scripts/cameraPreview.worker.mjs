import { parentPort } from 'node:worker_threads';
import sharp from 'sharp';
import { bytes, decodeRawImage, sensorProblem, compressedDimensions, MAX_IMAGE_PIXELS } from '../src/lib/sensorData.js';

sharp.cache(false);
sharp.concurrency(1);

export async function cameraPreview(message) {
  const problem = sensorProblem(message, 'camera');
  if (problem) throw new Error(problem);
  let image, sourceWidth, sourceHeight, note;
  const encoding = String(message.encoding || '').toLowerCase();
  const grayscale = ['16uc1', '32fc1', 'mono16', 'mono8', '8uc1'].includes(encoding);
  if (message.encoding) {
    const frame = decodeRawImage(message, { maxWidth: 640, maxHeight: 360 });
    sourceWidth = frame.sourceWidth; sourceHeight = frame.sourceHeight; note = frame.note;
    image = sharp(frame.rgba, { raw: { width: frame.width, height: frame.height, channels: 4 } });
  } else {
    if (/compressedDepth/i.test(message.format)) throw new Error('compressedDepth is not supported. Select a raw depth image topic.');
    const data = bytes(message.data);
    const dimensions = compressedDimensions(data);
    sourceWidth = dimensions.width; sourceHeight = dimensions.height;
    image = sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS }).resize({ width: 640, height: 360, fit: 'inside', withoutEnlargement: true });
  }
  const format = grayscale ? 'png' : 'jpeg';
  const output = grayscale
    ? await image.removeAlpha().greyscale().png({ compressionLevel: 3 }).toBuffer()
    : await image.flatten({ background: '#10141a' }).jpeg({ quality: 72 }).toBuffer();
  return { header: message.header, format, data: new Uint8Array(output),
    preview: { sourceWidth, sourceHeight, encoding: message.encoding || message.format, note,
      description: 'Resized on host for mobile preview' } };
}

parentPort?.on('message', async ({ id, message }) => {
  try {
    const result = await cameraPreview(message);
    parentPort.postMessage({ id, message: result }, [result.data.buffer]);
  } catch (error) {
    parentPort.postMessage({ id, message: { header: message.header,
      previewError: String(error.message || 'Unable to prepare camera preview.').slice(0, 500) } });
  }
});
