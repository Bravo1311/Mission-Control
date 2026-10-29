import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRawImage, decodeLidar, MAX_POINTS, MAX_SENSOR_BYTES, sensorProblem, compressedDimensions } from '../src/lib/sensorData.js';
import { inferPanelType } from '../src/lib/inferPanelType.js';
import { appendSample, topicPolicy } from '../src/lib/topicPolicy.js';
import { createLatestFramePump } from '../src/lib/latestFrame.js';

const image = overrides => ({ width: 2, height: 1, step: 6, encoding: 'rgb8', data: [255, 0, 0, 0, 255, 0], ...overrides });
function cloud(big = false) {
  const data = new Uint8Array(64);
  const view = new DataView(data.buffer);
  // Two rows with padding and reordered coordinate fields.
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const i = row * 2 + col, offset = row * 32 + col * 12;
    view.setFloat32(offset, i + 3, !big); view.setFloat32(offset + 4, i + 1, !big); view.setFloat32(offset + 8, i + 2, !big);
  }
  return { width: 2, height: 2, point_step: 12, row_step: 32, is_bigendian: big, data,
    fields: [{ name: 'x', offset: 4, datatype: 7, count: 1 }, { name: 'y', offset: 8, datatype: 7, count: 1 }, { name: 'z', offset: 0, datatype: 7, count: 1 }] };
}

test('ROS 1 and ROS 2 names select sensor displays before first message', () => {
  for (const prefix of ['sensor_msgs/', 'sensor_msgs/msg/']) for (const [type, expected] of [['Image', 'camera'], ['CompressedImage', 'camera'], ['LaserScan', 'lidar'], ['PointCloud2', 'lidar'], ['Imu', 'imu']]) assert.equal(inferPanelType(prefix + type), expected);
  assert.equal(inferPanelType('std_msgs/msg/Bool'), 'scalar');
  assert.equal(inferPanelType('geometry_msgs/msg/Vector3Stamped'), 'vector');
  assert.equal(topicPolicy('sensor_msgs/msg/PointCloud2').throttle, 500);
});

test('raw images handle base64, BGR, alpha and padded rows', () => {
  assert.deepEqual([...decodeRawImage(image()).rgba], [255, 0, 0, 255, 0, 255, 0, 255]);
  assert.deepEqual([...decodeRawImage(image({ encoding: 'bgr8', data: Buffer.from([0, 0, 255, 0, 255, 0]).toString('base64') })).rgba], [255, 0, 0, 255, 0, 255, 0, 255]);
  const padded = decodeRawImage(image({ width: 1, height: 2, step: 4, data: [9, 8, 7, 0, 6, 5, 4, 0] }));
  assert.deepEqual([...padded.rgba], [9, 8, 7, 255, 6, 5, 4, 255]);
  assert.deepEqual([...decodeRawImage(image({ width: 1, step: 4, encoding: 'bgra8', data: [3, 2, 1, 42] })).rgba], [1, 2, 3, 42]);
});

test('depth images honor endianness and fixed 10 m scale', () => {
  assert.equal(decodeRawImage(image({ width: 1, step: 2, encoding: '16UC1', is_bigendian: 1, data: [0x13, 0x88] })).rgba[0], 128);
  const bytes = new Uint8Array(8); const view = new DataView(bytes.buffer);
  view.setFloat32(0, 5, true); view.setFloat32(4, NaN, true);
  const result = decodeRawImage(image({ step: 8, encoding: '32FC1', data: bytes }));
  assert.equal(result.rgba[0], 128); assert.equal(result.rgba[4], 0);
});

test('raw decoding rejects malformed data and bounds output resolution', () => {
  assert.throws(() => decodeRawImage(image({ data: [] })), /Truncated/);
  assert.throws(() => decodeRawImage(image({ step: 1 })), /stride/);
  assert.throws(() => decodeRawImage(image({ encoding: 'yuv422' })), /Unsupported/);
  assert.throws(() => decodeRawImage(image({ width: 100000, height: 100000 })), /megapixel/);
  const result = decodeRawImage(image({ width: 1920, height: 1080, step: 1920, encoding: 'mono8', data: new Uint8Array(1920 * 1080) }));
  assert.equal(result.width, 1280); assert.equal(result.height, 720);
});

test('compressed headers reject oversized images before bitmap decoding', () => {
  const png = new Uint8Array(24); const view = new DataView(png.buffer);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(16, 640); view.setUint32(20, 480);
  assert.deepEqual(compressedDimensions(png), { width: 640, height: 480 });
  view.setUint32(16, 100000); assert.throws(() => compressedDimensions(png), /megapixel/);
  assert.throws(() => compressedDimensions(new Uint8Array(3)), /Invalid/);
  const jpeg = Uint8Array.from([255,216,255,192,0,8,8,0,20,0,30,0]);
  assert.deepEqual(compressedDimensions(jpeg), { width: 30, height: 20 });
});

test('PointCloud2 honors field offsets, row padding and both byte orders', () => {
  for (const big of [true, false]) assert.deepEqual([...decodeLidar(cloud(big)).points], [1,2,3,2,3,4,3,4,5,4,5,6]);
  const c = cloud(); c.data = Buffer.from(c.data).toString('base64'); assert.equal(decodeLidar(c).count, 4);
});

test('PointCloud2 drops invalid coordinates and reports unsupported layouts', () => {
  const c = cloud(); new DataView(c.data.buffer).setFloat32(4, NaN, true);
  assert.equal(decodeLidar(c).count, 3);
  assert.throws(() => decodeLidar({ ...cloud(), data: [] }), /Truncated/);
  assert.throws(() => decodeLidar({ ...cloud(), fields: [] }), /coordinate/);
  assert.equal(decodeLidar({ width: 0, height: 1 }).count, 0);
});

test('LaserScan rejects invalid ranges and respects point budget', () => {
  const scan = { ranges: [1, NaN, Infinity, -1, 11, 2], angle_min: 0, angle_increment: Math.PI / 2, range_min: 0.1, range_max: 10 };
  const result = decodeLidar(scan);
  assert.equal(result.count, 2); assert.equal(result.points[0], 1); assert.ok(Math.abs(result.points[4] - 2) < 0.001);
  const large = decodeLidar({ ...scan, ranges: new Float32Array(1000000).fill(5) });
  assert.ok(large.count <= MAX_POINTS); assert.equal(large.total, 1000000);
});

test('large sensor frames are replaced with an error, never retained', () => {
  const frame = { data: { length: MAX_SENSOR_BYTES + 1 } };
  assert.match(sensorProblem(frame, 'camera'), /16 MiB/);
  const buffer = { t: [], raw: [] }; appendSample(buffer, frame, 0, 'camera');
  assert.equal(buffer.raw.length, 1); assert.match(buffer.raw[0].previewError, /16 MiB/); assert.equal(buffer.raw[0].data, undefined);
});

test('long sessions retain one frame per bulk topic and bounded analytical history', () => {
  for (const kind of ['camera', 'lidar', 'imu', 'vector', 'diagnostics', 'raw']) {
    const buffer = { t: [], raw: [] };
    for (let i = 0; i < 100000; i++) appendSample(buffer, { data: i }, i / 20, kind);
    assert.equal(buffer.raw.length, 1); assert.equal(buffer.raw[0].data, 99999);
  }
  const buffer = { t: [], raw: [] };
  for (let i = 0; i < 10000; i++) appendSample(buffer, { data: i }, i / 20, 'trajectory');
  assert.equal(buffer.raw.length, 2400);
});

test('slow workers skip intermediate frames and reject results after clear', () => {
  let buffer = { raw: [{ id: 1 }] }; const sent = [];
  const pump = createLatestFramePump(() => buffer, msg => sent.push(msg.id));
  pump.pull();
  for (let i = 2; i <= 1000; i++) { buffer.raw[0] = { id: i }; assert.equal(pump.pull(), false); }
  assert.deepEqual(sent, [1]); assert.equal(pump.complete(), true);
  pump.pull(); assert.deepEqual(sent, [1, 1000]);
  buffer = { raw: [] }; assert.equal(pump.complete(), false);
  assert.equal(pump.pull(), false);
  buffer.raw.push({ id: 1001 }); pump.pull(); pump.complete();
  assert.equal(pump.pull(), false); pump.retry(); assert.equal(pump.pull(), true);
});


test('receive statistics distinguish slow delivery from a stalled feed', async () => {
  const { recordReception, receptionSummary } = await import('../src/lib/receiveStats.js');
  const buffer = {};
  assert.equal(receptionSummary(buffer, 0), 'RX waiting');
  for (let i = 0; i <= 10; i++) recordReception(buffer, { data: new Uint8Array(1024) }, i * 100);
  assert.match(receptionSummary(buffer, 1100), /RX 11.0 FPS/);
  assert.equal(receptionSummary(buffer, 3000), 'RX stalled');
});

test('comparison defaults choose distinct reference and estimate topics', async () => {
  const { chooseComparison, formatReadout } = await import('../src/lib/comparisonRoles.js');
  const names = ['/drone_1/fusion/odom', '/drone_1/odometry'];
  assert.deepEqual(chooseComparison(names, null, null), { truth: names[1], estimate: names[0] });
  assert.notEqual(chooseComparison(names, names[0], names[0]).truth, chooseComparison(names, names[0], names[0]).estimate);
  assert.deepEqual(chooseComparison(names, names[0], names[1]), { truth: names[0], estimate: names[1] });
  assert.deepEqual(chooseComparison(['/truth'], null, null), { truth: '/truth', estimate: null });
  assert.equal(formatReadout(-0.001), '0.00');
  assert.equal(formatReadout(NaN), '—');
});

test('trajectory framing handles stationary, distant and invalid positions', async () => {
  const { trajectoryFit, niceGridStep, finitePosition } = await import('../src/lib/trajectoryView.js');
  assert.equal(finitePosition({ x: 1, y: 2 }), true);
  assert.equal(finitePosition({ x: NaN, y: 2 }), false);
  assert.equal(finitePosition({ x: 1, y: Infinity }), false);
  assert.equal(trajectoryFit({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }), null);
  const stationary = trajectoryFit({ min: [1000, -200, 10], max: [1000, -200, 10] });
  assert.deepEqual(stationary.center, [1000, -200, 10]);
  assert.ok(stationary.halfHeight > 0);
  const large = trajectoryFit({ min: [-100, -200, -10], max: [100, 200, 20] }, 0.5);
  assert.deepEqual(large.center, [0, 0, 5]);
  assert.ok(large.halfHeight * 0.5 >= Math.hypot(200, 400, 30) / 2);
  assert.ok(large.plane <= -10);
  const vertical = trajectoryFit({ min: [0, 0, 0], max: [0, 0, 1000] }, 1, '2d');
  assert.equal(vertical.radius, 5);
  assert.ok(vertical.distance > 1000);
  assert.equal(niceGridStep(10), 1);
  assert.equal(niceGridStep(35), 5);
  assert.ok(Number.isFinite(niceGridStep(NaN)));
});


test('trajectory fitting can include the actual coordinate origin', async () => {
  const { boundsWithOrigin, trajectoryFit } = await import('../src/lib/trajectoryView.js');
  const bounds = boundsWithOrigin({ min: [10, -30, 5], max: [20, -10, 15] });
  assert.deepEqual(bounds, { min: [0, -30, 0], max: [20, 0, 15] });
  assert.deepEqual(trajectoryFit(bounds).center, [10, -15, 7.5]);
  const empty = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  assert.equal(trajectoryFit(boundsWithOrigin(empty)), null);
});
