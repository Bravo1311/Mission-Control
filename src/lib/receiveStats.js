import { byteLength } from './sensorData.js';

export function recordReception(buffer, msg, now) {
  const stats = buffer.reception ||= { start: now, count: 0, bytes: 0, fps: 0, mib: 0, last: now };
  stats.count++;
  stats.bytes += byteLength(msg.data) + (msg.ranges?.length || 0) * 4;
  stats.last = now;
  const elapsed = (now - stats.start) / 1000;
  if (elapsed >= 1) {
    stats.fps = stats.count / elapsed;
    stats.mib = stats.bytes / elapsed / 1048576;
    stats.start = now; stats.count = 0; stats.bytes = 0;
  }
}

export function receptionSummary(buffer, now) {
  const stats = buffer.reception;
  if (!stats) return 'RX waiting';
  if (now - stats.last > 1500) return 'RX stalled';
  return `RX ${stats.fps.toFixed(1)} FPS · ${stats.mib.toFixed(1)} MiB/s payload`;
}
