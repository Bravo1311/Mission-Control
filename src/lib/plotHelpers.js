// Shared across StateEstimatePanel, GpsPanel, and (later) anywhere else
// that overlays multiple topics — keeps topic->color consistent app-wide.
// Portfolio orange leads; other series retain distinct comparison colors.
export const PALETTE = ['#FF4D0A', '#ECECEC', '#3DDC84', '#FF4B3A', '#B084F5', '#FF8A00', '#7C9EFF', '#FF6FA8'];

export function plotLayout(extra) {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#a0b1c2', size: 11 },
    margin: { l: 45, r: 10, t: 10, b: 35 },
    showlegend: false,
    ...extra,
  };
}

// Works for nav_msgs/Odometry (pose.pose.position), geometry_msgs/PoseStamped
// (pose.position), and ECEF-shaped custom messages like fusion_interfaces/GnssFix
// (x_ecef_m/y_ecef_m/z_ecef_m), which get converted to local ENU on the fly.
const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

// Reference origin — matches the Aachen reference point used in gnss_sim.
// Adjust here if your simulation reference point ever changes.
const REF = { lat: 50.781020, lon: 6.047028, alt: 10.0 };

function geodeticToEcef(latDeg, lonDeg, alt) {
  const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (N + alt) * cosLat * Math.cos(lon),
    (N + alt) * cosLat * Math.sin(lon),
    (N * (1 - WGS84_E2) + alt) * sinLat,
  ];
}

function ecefToEnu(x, y, z, refLatDeg, refLonDeg, refAlt) {
  const [x0, y0, z0] = geodeticToEcef(refLatDeg, refLonDeg, refAlt);
  const dx = x - x0, dy = y - y0, dz = z - z0;
  const lat = (refLatDeg * Math.PI) / 180, lon = (refLonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const e = -sinLon * dx + cosLon * dy;
  const n = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const u = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
  return { x: e, y: n, z: u }; // x=East, y=North — matches the plot's x/y axes
}

export function pos(msg) {
  if (msg?.pose?.pose?.position) return msg.pose.pose.position;
  if (msg?.pose?.position) return msg.pose.position;
  if (typeof msg?.x_ecef_m === 'number' && typeof msg?.y_ecef_m === 'number' && typeof msg?.z_ecef_m === 'number') {
    return ecefToEnu(msg.x_ecef_m, msg.y_ecef_m, msg.z_ecef_m, REF.lat, REF.lon, REF.alt);
  }
  return null;
}

// Closed-form (Bowring's) ECEF -> geodetic. Accurate enough for near-surface
// UAV altitudes; no need for the iterative form here.
function ecefToGeodetic(x, y, z) {
  const a = WGS84_A, e2 = WGS84_E2;
  const b = a * Math.sqrt(1 - e2);
  const ep2 = (a * a - b * b) / (b * b);
  const p = Math.sqrt(x * x + y * y);
  const th = Math.atan2(a * z, b * p);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z + ep2 * b * Math.pow(Math.sin(th), 3), p - e2 * a * Math.pow(Math.cos(th), 3));
  const sinLat = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const alt = p / Math.cos(lat) - N;
  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI, alt };
}

function enuToGeodetic(e, n, u, refLatDeg, refLonDeg, refAlt) {
  const lat = (refLatDeg * Math.PI) / 180, lon = (refLonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const dx = -sinLon * e - sinLat * cosLon * n + cosLat * cosLon * u;
  const dy = cosLon * e - sinLat * sinLon * n + cosLat * sinLon * u;
  const dz = cosLat * n + sinLat * u;
  const [x0, y0, z0] = geodeticToEcef(refLatDeg, refLonDeg, refAlt);
  return ecefToGeodetic(x0 + dx, y0 + dy, z0 + dz);
}

// Best-effort lat/lon for ANY position-bearing message, for putting it on
// the map: native NavSatFix fields (exact), ECEF fields (exact), or a
// pose's local x/y treated as East/North relative to REF (assumes that
// topic's local frame is georeferenced at REF — true for anything derived
// from gnss_sim; verify before trusting it for raw simulator ground truth).
export function latLon(msg) {
  if (typeof msg?.latitude === 'number' && typeof msg?.longitude === 'number') {
    return { lat: msg.latitude, lon: msg.longitude };
  }
  if (typeof msg?.x_ecef_m === 'number' && typeof msg?.y_ecef_m === 'number' && typeof msg?.z_ecef_m === 'number') {
    return ecefToGeodetic(msg.x_ecef_m, msg.y_ecef_m, msg.z_ecef_m);
  }
  const p = pos(msg);
  if (p) return enuToGeodetic(p.x, p.y, p.z || 0, REF.lat, REF.lon, REF.alt);
  return null;
}

// Extracts a message's orientation quaternion, wherever it's shaped like
// ROS puts it (Odometry vs PoseStamped). Returns null for messages with no
// orientation field — e.g. GnssFix (position/velocity only, no attitude).
export function orientation(msg) {
  const o = msg?.pose?.pose?.orientation || msg?.pose?.orientation;
  if (o && typeof o.x === 'number') return o; // {x, y, z, w}
  return null;
}

// Quaternion -> Euler (roll/pitch/yaw, radians), assuming REP-103 body-frame
// convention (x-forward, y-left, z-up) — standard for ROS orientation data.
export function quaternionToEuler({ x, y, z, w }) {
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return { roll, pitch, yaw };
}

// Rotates an ECEF velocity VECTOR into local ENU — same rotation matrix as
// ecefToEnu's position conversion, but no origin subtraction: a velocity is
// a direction/magnitude, not a point in space, so only the rotational part
// applies. Needed because, unlike total speed magnitude (frame-invariant
// under pure rotation), splitting into horizontal vs. vertical components
// genuinely requires knowing which direction is "up" — you can't get that
// from ECEF components alone without this conversion.
function ecefVectorToEnu(vx, vy, vz, refLatDeg, refLonDeg) {
  const lat = (refLatDeg * Math.PI) / 180, lon = (refLonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat), sinLon = Math.sin(lon), cosLon = Math.cos(lon);
  const e = -sinLon * vx + cosLon * vy;
  const n = -sinLat * cosLon * vx - sinLat * sinLon * vy + cosLat * vz;
  const u = cosLat * cosLon * vx + cosLat * sinLon * vy + sinLat * vz;
  return { x: e, y: n, z: u }; // x=East, y=North, z=Up
}

export function velocityEnu(msg) {
  const lin = msg?.twist?.twist?.linear;
  if (lin && typeof lin.x === 'number') {
    return { x: lin.x, y: lin.y, z: lin.z }; // Odometry twist assumed already world-frame ENU
  }
  if (typeof msg?.vx_ecef_mps === 'number') {
    return ecefVectorToEnu(msg.vx_ecef_mps, msg.vy_ecef_mps, msg.vz_ecef_mps, REF.lat, REF.lon);
  }
  return null;
}

// Ground speed — horizontal only (East/North components), like a real
// airspeed indicator, which does NOT include climb/descent rate.
export function horizontalSpeed(msg) {
  const v = velocityEnu(msg);
  return v ? Math.sqrt(v.x ** 2 + v.y ** 2) : null;
}

// Vertical speed — signed: positive = climbing, negative = descending.
// This is what a real VSI shows, kept deliberately separate from ground
// speed rather than folded into one magnitude.
export function verticalSpeed(msg) {
  const v = velocityEnu(msg);
  return v ? v.z : null;
}