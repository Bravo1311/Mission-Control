import { topicStyle } from './topicStyles.js';
import { orientation, quaternionToEuler, horizontalSpeed, verticalSpeed } from './plotHelpers.js';

const SOURCE_ORDER = ['fusion', 'odometry', 'reference', 'imu', 'gps', 'other'];

export function groupFlightTopics(topics) {
  const groups = new Map();
  for (const topic of topics) {
    const style = topicStyle(topic.name);
    if (!groups.has(style.groupKey)) groups.set(style.groupKey, { key: style.groupKey, label: style.groupLabel, topics: [] });
    groups.get(style.groupKey).topics.push({ ...topic, style });
  }
  for (const group of groups.values()) group.topics.sort((a, b) => SOURCE_ORDER.indexOf(a.style.sourceKind) - SOURCE_ORDER.indexOf(b.style.sourceKind)
    || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

export function flightReading(topic, message) {
  let euler = null;
  const q = orientation(message);
  if (q && ['x', 'y', 'z', 'w'].every(key => Number.isFinite(q[key]))) {
    const norm = Math.hypot(q.x, q.y, q.z, q.w);
    if (Number.isFinite(norm) && norm > 1e-9) euler = quaternionToEuler(Object.fromEntries(['x', 'y', 'z', 'w'].map(key => [key, q[key] / norm])));
  }
  const degrees = value => value * 180 / Math.PI;
  const ground = horizontalSpeed(message), vertical = verticalSpeed(message);
  return { ...topic, style: topic.style || topicStyle(topic.name),
    roll: euler ? degrees(euler.roll) : null, pitch: euler ? degrees(euler.pitch) : null,
    heading: euler ? (90 - degrees(euler.yaw) + 360) % 360 : null,
    ground: Number.isFinite(ground) ? ground : null, vertical: Number.isFinite(vertical) ? vertical : null,
    frame: message?.header?.frame_id || '—', waiting: !message };
}

export function flightSpeedLimit(values, minimum) {
  const largest = Math.max(minimum, ...values.filter(Number.isFinite).map(Math.abs));
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  return [1, 2, 5, 10].find(step => step * magnitude >= largest) * magnitude;
}
