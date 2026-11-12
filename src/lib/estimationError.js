import { pos, orientation, velocityEnu } from './plotHelpers.js';
import { topicStyle } from './topicStyles.js';

export const MAX_PAIR_GAP_S = 0.5;
export const MAX_ERROR_PLOT_POINTS = 600;
const lerp = (a, b, s) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const vector = value => value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z) ? value : null;
const quaternion = value => {
  if (!vector(value) || !Number.isFinite(value.w)) return null;
  const norm = Math.hypot(value.x, value.y, value.z, value.w);
  if (!Number.isFinite(norm) || norm < 1e-9) return null;
  return norm === 1 ? value : { x: value.x / norm, y: value.y / norm, z: value.z / norm, w: value.w / norm };
};
const nlerp = (a, b, s) => {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  return quaternion({ x: a.x + (sign * b.x - a.x) * s, y: a.y + (sign * b.y - a.y) * s,
    z: a.z + (sign * b.z - a.z) * s, w: a.w + (sign * b.w - a.w) * s });
};

export const ERROR_METRICS = {
  pos: { label: 'Position', unit: 'm', yTitle: 'Position error (m)', thresholds: [0.5, 2],
    get: message => vector(pos(message)), blend: lerp, error: distance },
  ori: { label: 'Orientation', unit: '°', yTitle: 'Orientation error (°)', thresholds: [2, 5],
    get: message => quaternion(orientation(message)), blend: nlerp,
    error: (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.x*b.x + a.y*b.y + a.z*b.z + a.w*b.w))) * 180 / Math.PI },
  vel: { label: 'Velocity', unit: 'm/s', yTitle: 'Velocity error (m/s)', thresholds: [0.2, 1],
    get: message => vector(velocityEnu(message)), blend: lerp, error: distance },
};

const METRIC_ENTRIES = Object.entries(ERROR_METRICS);

export function chooseGroundTruth(names, preferred) {
  if (names.includes(preferred)) return preferred;
  return names.find(name => topicStyle(name).sourceKind === 'reference')
    || names.find(name => topicStyle(name).sourceKind === 'odometry')
    || names.find(name => topicStyle(name).sourceKind !== 'fusion') || names[0] || null;
}

function prepare(buffer) {
  return Object.fromEntries(METRIC_ENTRIES.map(([key, metric]) => [key, buffer.raw.map(metric.get)]));
}

// Use the dashboard's shared elapsed-time clock. Never extrapolate truth or
// interpolate across a reception outage. Both buffers are time-sorted.
export function pairedErrors(truth, estimate, preparedTruth = prepare(truth)) {
  const result = Object.fromEntries(Object.keys(ERROR_METRICS).map(key => [key, { t: [], v: [] }]));
  const n = truth.t.length;
  if (n < 2) return result;
  let j = 0;
  for (let i = 0; i < estimate.t.length; i++) {
    const time = estimate.t[i];
    if (!Number.isFinite(time) || time < truth.t[0] || time > truth.t[n - 1]) continue;
    while (j < n - 2 && truth.t[j + 1] < time) j++;
    const start = truth.t[j], end = truth.t[j + 1];
    if (end - start > MAX_PAIR_GAP_S) continue;
    const fraction = end === start ? 0 : (time - start) / (end - start);
    for (const [key, metric] of METRIC_ENTRIES) {
      const value = metric.get(estimate.raw[i]);
      const a = preparedTruth[key][j], b = preparedTruth[key][j + 1];
      if (!value || !a || !b) continue;
      const error = metric.error(value, metric.blend(a, b, fraction));
      if (Number.isFinite(error)) { result[key].t.push(time); result[key].v.push(error); }
    }
  }
  return result;
}

export function errorStats(values) {
  if (!values.length) return { current: null, mean: null, rmse: null, max: null, count: 0 };
  let sum = 0, squares = 0, max = 0;
  for (const value of values) { sum += value; squares += value * value; max = Math.max(max, value); }
  return { current: values.at(-1), mean: sum / values.length, rmse: Math.sqrt(squares / values.length), max, count: values.length };
}

// Retain each bucket's extrema so brief spikes survive chart decimation.
// Statistics always use all pairs, not the display sample.
export function errorPlotSeries(series) {
  const n = series.t.length;
  if (n <= MAX_ERROR_PLOT_POINTS) return series;
  const indices = [0], buckets = (MAX_ERROR_PLOT_POINTS - 2) / 2;
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor(bucket * (n - 2) / buckets);
    const end = 1 + Math.floor((bucket + 1) * (n - 2) / buckets);
    let min = start, max = start;
    for (let i = start + 1; i < end; i++) {
      if (series.v[i] < series.v[min]) min = i;
      if (series.v[i] > series.v[max]) max = i;
    }
    indices.push(...(min === max ? [min] : min < max ? [min, max] : [max, min]));
  }
  indices.push(n - 1);
  return { t: indices.map(i => series.t[i]), v: indices.map(i => series.v[i]) };
}

// One cache per panel, bounded by its selected estimates. Parse the shared
// truth once per version and reuse results when buffers are idle.
export function createErrorCalculator() {
  let reference, version, preparedTruth;
  let previous = [];
  const cache = new Map();
  return (truth, estimates) => {
    if (truth !== reference || truth.version !== version) {
      reference = truth; version = truth.version; preparedTruth = prepare(truth); cache.clear();
    }
    const active = new Set(estimates.map(estimate => estimate.name));
    for (const name of cache.keys()) if (!active.has(name)) cache.delete(name);
    const result = estimates.map(({ name, buffer }) => {
      let entry = cache.get(name);
      if (!entry || entry.buffer !== buffer || entry.version !== buffer.version) {
        const all = pairedErrors(truth, buffer, preparedTruth);
        entry = { name, buffer, version: buffer.version, all,
          stats: Object.fromEntries(Object.entries(all).map(([key, series]) => [key, errorStats(series.v)])),
          plots: Object.fromEntries(Object.entries(all).map(([key, series]) => [key, errorPlotSeries(series)])) };
        cache.set(name, entry);
      }
      return entry;
    });
    if (result.length !== previous.length || result.some((entry, index) => entry !== previous[index])) previous = result;
    return previous;
  };
}
