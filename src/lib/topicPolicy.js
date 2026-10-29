import { inferPanelType } from './inferPanelType.js';
import { sensorProblem, byteLength } from './sensorData.js';
import { performanceProfile } from './performanceProfile.js';

export function topicPolicy(type, mode = 'desktop') {
  const kind = inferPanelType(type);
  const profile = performanceProfile(mode);
  return { kind, throttle: kind === 'camera' ? profile.cameraMs : kind === 'lidar' ? (/PointCloud2/.test(type) ? profile.cloudMs : profile.scanMs) : profile.instrumentMs };
}

// Include base64 expansion in JSON mode. Round upward to avoid resubscribing
// for every small size change in a variable-size compressed image stream.
export function sensorPayloadBytes(message, compression = 'cbor') {
  const size = byteLength(message.data) * (compression === 'none' ? 4 / 3 : 1)
    + (message.ranges?.length || 0) * (compression === 'none' ? 16 : 4) + 1024;
  return Math.ceil(size / 65536) * 65536;
}

export function sensorThrottle(type, mode, active, bytes = 0, activeSensors = 1) {
  const { throttle } = topicPolicy(type, mode);
  if (mode !== 'mobile') return active ? throttle : 1000;
  // null means no subscription; preserve the selected source and retained frame.
  if (!active) return null;
  // Start conservatively until the first payload reveals the actual wire size.
  if (!bytes) return 3000;
  const budget = performanceProfile(mode).sensorBytesPerSecond / Math.max(1, activeSensors);
  return Math.max(throttle, Math.ceil(bytes / budget * 10) * 100);
}

export function trimHistory(buffer, time, kind, mode = 'desktop') {
  const profile = performanceProfile(mode);
  const cutoff = time - (kind === 'scalar' ? 20 : profile.historySeconds);
  let drop = Math.max(0, buffer.t.length - profile.historySamples);
  while (drop < buffer.t.length && buffer.t[drop] < cutoff) drop++;
  if (drop) {
    buffer.t.splice(0, drop); buffer.raw.splice(0, drop);
    buffer.version = (buffer.version || 0) + 1;
  }
}

// Histories are useful for trajectory analysis. Bulk payloads and readouts only
// need the latest message; retaining whole images/clouds is prohibitively costly.
export function appendSample(buffer, message, time, kind, mode = 'desktop') {
  buffer.version = (buffer.version || 0) + 1;
  if (!['trajectory', 'geo', 'scalar'].includes(kind)) {
    const problem = ['camera', 'lidar'].includes(kind) ? sensorProblem(message, kind) : null;
    buffer.t[0] = time;
    buffer.raw[0] = problem ? { previewError: problem, header: message.header } : message;
    buffer.t.length = buffer.raw.length = 1;
    return;
  }
  buffer.t.push(time); buffer.raw.push(message);
  trimHistory(buffer, time, kind, mode);
}
