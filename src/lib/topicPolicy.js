import { inferPanelType } from './inferPanelType.js';
import { sensorProblem } from './sensorData.js';

export function topicPolicy(type) {
  const kind = inferPanelType(type);
  return { kind, throttle: kind === 'camera' ? 50 : kind === 'lidar' ? (/PointCloud2/.test(type) ? 500 : 200) : 50 };
}

// Histories are useful for trajectory analysis. Bulk payloads and readouts only
// need the latest message; retaining whole images/clouds is prohibitively costly.
export function appendSample(buffer, message, time, kind) {
  buffer.version = (buffer.version || 0) + 1;
  if (!['trajectory', 'geo', 'scalar'].includes(kind)) {
    const problem = ['camera', 'lidar'].includes(kind) ? sensorProblem(message, kind) : null;
    buffer.t[0] = time;
    buffer.raw[0] = problem ? { previewError: problem, header: message.header } : message;
    buffer.t.length = buffer.raw.length = 1;
    return;
  }
  buffer.t.push(time); buffer.raw.push(message);
  const cutoff = time - (kind === 'scalar' ? 20 : 120);
  let drop = Math.max(0, buffer.t.length - 2400);
  while (drop < buffer.t.length && buffer.t[drop] < cutoff) drop++;
  if (drop) { buffer.t.splice(0, drop); buffer.raw.splice(0, drop); }
}
