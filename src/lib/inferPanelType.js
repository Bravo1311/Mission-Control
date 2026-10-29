// Classifies a ROS topic into a visualization category — first by message
// type string, then (if that's a custom/unrecognized type) by inspecting
// the shape of the first message actually received.
export function inferPanelType(messageType, sampleMsg) {
  const t = (messageType || '').replace('/msg/', '/');
  if (/Odometry|PoseStamped|PoseWithCovarianceStamped/.test(t)) return 'trajectory';
  if (/GnssFix/.test(t)) return 'trajectory'; // fusion_interfaces/GnssFix — ECEF x/y/z, converted to ENU in plotHelpers.pos()
  if (/LaserScan|PointCloud2/.test(t)) return 'lidar';
  if (/Vector3(?:Stamped)?$/.test(t)) return 'vector';
  if (/Imu/.test(t)) return 'imu';
  if (/NavSatFix/.test(t)) return 'geo';
  if (/CompressedImage/.test(t)) return 'camera';
  if (/^sensor_msgs\/Image$/.test(t)) return 'camera';
  if (/DiagnosticArray/.test(t)) return 'diagnostics';
  if (/^std_msgs\/(Float32|Float64|Int8|Int16|Int32|Int64|UInt8|UInt16|UInt32|UInt64|Bool)$/.test(t)) return 'scalar';

  if (sampleMsg) {
    if (sampleMsg?.ranges && typeof sampleMsg.angle_increment === 'number') return 'lidar';
    if (sampleMsg?.fields && typeof sampleMsg.point_step === 'number') return 'lidar';
    if (sampleMsg?.encoding && sampleMsg?.width && sampleMsg?.height) return 'camera';
    if (sampleMsg?.pose?.pose?.position || sampleMsg?.pose?.position) return 'trajectory';
    if (typeof sampleMsg?.x_ecef_m === 'number' && typeof sampleMsg?.y_ecef_m === 'number' && typeof sampleMsg?.z_ecef_m === 'number') return 'trajectory';
    if (sampleMsg?.linear_acceleration && sampleMsg?.angular_velocity) return 'imu';
    if (typeof sampleMsg?.latitude === 'number' && typeof sampleMsg?.longitude === 'number') return 'geo';
    if (typeof sampleMsg?.format === 'string' && typeof sampleMsg?.data === 'string') return 'camera';
    if (['number', 'boolean'].includes(typeof sampleMsg?.data)) return 'scalar';
    if (Array.isArray(sampleMsg?.data) && sampleMsg.data.slice(0, 16).every((v) => typeof v === 'number')) return 'vector';
  }
  return 'raw';
}

export const PANEL_LABEL = {
  trajectory: 'State estimate',
  imu: 'IMU (accel / gyro)',
  geo: 'GPS fix',
  camera: 'Camera feed',
  lidar: 'Lidar preview',
  diagnostics: 'Diagnostics',
  scalar: 'Scalar reading',
  vector: 'Vector reading',
  raw: 'Message preview',
};