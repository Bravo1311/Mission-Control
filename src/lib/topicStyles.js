// Drone badges retain a group color. Source traces use separated hues plus
// line patterns: subtle shades of one hue are too similar for overlaid data.
// Derive styles from names so selection order, reconnects and removals cannot
// recolor existing topics. Keep the data palette independent of UI orange.
const VEHICLE_PALETTE = [
  { hue: 212, saturation: 38, lightness: 64 },
  { hue: 40, saturation: 44, lightness: 60 },
  { hue: 106, saturation: 18, lightness: 60 },
  { hue: 253, saturation: 19, lightness: 66 },
  { hue: 18, saturation: 32, lightness: 62 },
  { hue: 195, saturation: 18, lightness: 64 },
  { hue: 64, saturation: 23, lightness: 61 },
  { hue: 220, saturation: 8, lightness: 73 },
];
const SOURCES = {
  fusion: { label: 'Fusion', pattern: 'solid', hueOffset: 0, saturation: 64, lightness: 67 },
  imu: { label: 'IMU', pattern: 'dotted', hueOffset: 300, saturation: 56, lightness: 66 },
  gps: { label: 'GPS', pattern: 'dashed', hueOffset: 180, saturation: 72, lightness: 66 },
  reference: { label: 'Reference', pattern: 'long-dashed', hueOffset: 0, saturation: 8, lightness: 87 },
  odometry: { label: 'Odometry', pattern: 'long-dashed', hueOffset: 120, saturation: 64, lightness: 70 },
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
  const sourceHash = hash(sourceLabel);
  const source = SOURCES[sourceKind] || {
    label: 'Source', pattern: ['solid', 'dashed', 'dotted', 'long-dashed'][hash(sourceKey) % 4],
    hueOffset: sourceHash % 360, saturation: 60, lightness: 69,
  };
  const numbered = prefix.at(-1)?.match(/^(?:drone|uav|robot)[_-]?(\d+)$/i);
  const index = numbered ? Number(numbered[1]) : null;
  const paletteIndex = index === null ? hash(groupKey || 'unnamespaced')
    : index + VEHICLE_PALETTE.length - 1
      + (prefix.length > 1 ? hash(prefix.slice(0, -1).join('/').toLowerCase()) : 0);
  const { hue, saturation, lightness } = VEHICLE_PALETTE[paletteIndex % VEHICLE_PALETTE.length];
  // A simple source uses its role hue. Additional routes and aliases (e.g.
  // fusion/local vs fusion/global, or GPS vs GNSS) need a wider color spread,
  // not nearly identical shades. Full names keep those choices stable.
  const route = sourceKey.replace(/\/(?:odom|odometry|pose|fix|state|estimate)$/, '');
  const primary = route === (sourceKind === 'reference' ? 'ground_truth' : sourceKind);
  const variant = primary ? 0 : 45 + sourceHash % 270;
  const sourceHue = (hue + source.hueOffset + variant + (sourceHash >>> 8) % 17 - 8 + 360) % 360;
  const sourceLightness = (sourceKind === 'reference' && !primary ? 70 : source.lightness) + sourceHash % 9 - 4;
  const color = colorHex(sourceHue, sourceKind === 'reference' && !primary ? 56 : source.saturation, sourceLightness);
  return {
    groupKey, groupLabel: prefix.join('/') || 'Unnamespaced', hue, sourceHue,
    groupColor: colorHex(hue, saturation, lightness + 2), color,
    nightColor: color,
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
