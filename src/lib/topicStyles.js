// Color identifies the vehicle; shade and line pattern identify the source.
// Derive both from names so selection order and unsubscribe/reconnect do not
// recolor existing tracks. ROS names themselves remain case-sensitive.
// Separate consecutive vehicles by hue, rather than giving both pale cool
// colors. Keep this data palette independent of the orange interface accent.
const VEHICLE_HUES = [190, 310, 82, 46, 230, 142, 10, 270];
const SOURCES = {
  fusion: { label: 'Fusion', pattern: 'solid', lightness: 57, saturation: 62 },
  imu: { label: 'IMU', pattern: 'dotted', lightness: 64, saturation: 55 },
  gps: { label: 'GPS', pattern: 'dashed', lightness: 60, saturation: 60 },
  reference: { label: 'Reference', pattern: 'long-dashed', lightness: 68, saturation: 52 },
  odometry: { label: 'Odometry', pattern: 'long-dashed', lightness: 62, saturation: 57 },
};

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

// Hex works identically in CSS, SVG/Leaflet, Three.js, Plotly and canvas.
function colorHex(hue, saturation, lightness) {
  const s = saturation / 100, l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  return '#' + [0, 8, 4].map(n => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  }).join('');
}

export function topicStyle(name) {
  const parts = name.split('/').filter(Boolean);
  // Recognize vehicle namespaces even below a fleet/site namespace. Otherwise
  // use the first namespace, e.g. /robot_alpha/localization/odom -> robot_alpha.
  const vehicle = parts.findIndex(part => /^(?:drone|uav|robot)[_-]?\d+$/i.test(part));
  const prefixEnd = vehicle >= 0 ? vehicle + 1 : parts.length > 1 ? 1 : 0;
  const prefix = parts.slice(0, prefixEnd);
  const groupKey = prefix.join('/').toLowerCase();
  const sourceLabel = parts.slice(prefixEnd).join('/') || name;
  const sourceKey = sourceLabel.toLowerCase();
  const tokens = sourceKey.split(/[^a-z0-9]+/);
  const has = (...words) => words.some(word => tokens.includes(word));
  // Fusion wins over its input names, e.g. /fusion/gps/odom.
  const sourceKind = has('fusion', 'fused', 'ekf', 'ukf', 'filter', 'filtered') ? 'fusion'
    : has('ground', 'groundtruth', 'truth', 'reference', 'gt') ? 'reference'
    : has('imu', 'inertial', 'ins') ? 'imu'
    : has('gps', 'gnss', 'rtk', 'navsat') ? 'gps'
    : has('odom', 'odometry', 'pose') ? 'odometry' : 'other';
  const source = SOURCES[sourceKind] || {
    label: 'Source', pattern: ['solid', 'dashed', 'dotted', 'long-dashed'][hash(sourceKey) % 4],
    lightness: 57 + hash(sourceKey) % 9, saturation: 58,
  };
  const numbered = prefix.at(-1)?.match(/^(?:drone|uav|robot)[_-]?(\d+)$/i);
  const index = numbered ? Number(numbered[1]) : null;
  const hue = index === null ? hash(groupKey || 'unnamespaced') % 360
    : (VEHICLE_HUES[(index + VEHICLE_HUES.length - 1) % VEHICLE_HUES.length] + Math.floor(index / VEHICLE_HUES.length) * 137.508
      + (prefix.length > 1 ? hash(prefix.slice(0, -1).join('/').toLowerCase()) % 360 : 0)) % 360;
  const color = colorHex(hue, source.saturation, source.lightness);
  return {
    groupKey, groupLabel: prefix.join('/') || 'Unnamespaced', hue,
    groupColor: colorHex(hue, 62, 60), color,
    nightColor: colorHex(117, 72, Math.max(64, Math.min(78, source.lightness + 9))),
    fill: `rgba(${[1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)).join(',')},0.08)`,
    sourceLabel, sourceKind, sourceTitle: source.label, pattern: source.pattern,
  };
}

// Pixel lengths are also used for the SVG legend. The renderer converts them
// to world units at the current zoom so dash patterns stay legible at any scale.
export const TOPIC_DASHES = {
  solid: null,
  dashed: [7, 4],
  dotted: [2, 4],
  'long-dashed': [12, 4],
};

export const TOPIC_PLOT_DASHES = { solid: 'solid', dashed: 'dash', dotted: 'dot', 'long-dashed': 'longdash' };
