import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBridgeUrl, loadBridgeUrl } from '../src/lib/connectionConfig.js';
import { performanceProfile, loadPerformancePreference } from '../src/lib/performanceProfile.js';
import { topicPolicy, appendSample, trimHistory, sensorThrottle, sensorPayloadBytes } from '../src/lib/topicPolicy.js';
import { decodeRawImage, decodeLidar } from '../src/lib/sensorData.js';

test('phone connections use the host address or same-origin bridge, including HTTPS and IPv6', () => {
  assert.equal(defaultBridgeUrl(new URL('http://192.168.1.50:4173/')), 'ws://192.168.1.50:2019');
  assert.equal(defaultBridgeUrl(new URL('https://dashboard.local/'), '/rosbridge'), 'wss://dashboard.local/rosbridge');
  assert.equal(defaultBridgeUrl(new URL('http://[::1]:4173/')), 'ws://[::1]:2019');
  assert.equal(defaultBridgeUrl(new URL('http://192.168.1.50:4173/'), '/rosbridge'), 'ws://192.168.1.50:4173/rosbridge');
  for (const invalid of ['//other-host/bridge', '/\\other-host/bridge', 'https://other-host/bridge']) {
    assert.equal(defaultBridgeUrl(new URL('http://192.168.1.50:4173/'), invalid), 'ws://192.168.1.50:2019');
  }
});

test('runtime bridge config works with LAN hosting and falls back on generic static hosts', async () => {
  const location = new URL('http://192.168.1.50:4173/');
  assert.equal(await loadBridgeUrl(location, async () => new Response(JSON.stringify({ bridgePath: '/rosbridge' }), { headers: { 'Content-Type': 'application/json' } })), 'ws://192.168.1.50:4173/rosbridge');
  assert.equal(await loadBridgeUrl(location, async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } })), 'ws://192.168.1.50:2019');
  assert.equal(await loadBridgeUrl(location, async () => { throw new Error('Offline'); }), 'ws://192.168.1.50:2019');
});

test('mobile subscriptions reduce traffic while desktop budgets are preserved', () => {
  const camera = 'sensor_msgs/msg/Image', cloud = 'sensor_msgs/msg/PointCloud2', scan = 'sensor_msgs/msg/LaserScan';
  assert.equal(topicPolicy(camera, 'mobile').throttle, 100);
  assert.equal(topicPolicy(cloud, 'mobile').throttle, 1000);
  assert.equal(topicPolicy(scan, 'mobile').throttle, 500);
  assert.equal(topicPolicy('nav_msgs/msg/Odometry', 'mobile').throttle, 100);
  assert.equal(topicPolicy(camera).throttle, 50);
  assert.equal(topicPolicy(cloud).throttle, 500);
});

test('switching to mobile trims existing history immediately and future traffic stays bounded', () => {
  const buffer = { t: [], raw: [] };
  for (let i = 0; i < 2400; i++) appendSample(buffer, { i }, i / 20, 'trajectory');
  trimHistory(buffer, buffer.t.at(-1), 'trajectory', 'mobile');
  assert.equal(buffer.raw.length, 600);
  assert.equal(buffer.raw.at(-1).i, 2399);
  for (let i = 2400; i < 6000; i++) appendSample(buffer, { i }, i / 10, 'trajectory', 'mobile');
  assert.ok(buffer.raw.length <= 600);
  assert.ok(buffer.t.at(-1) - buffer.t[0] <= 60);
  assert.equal(buffer.raw.at(-1).i, 5999);
});

test('mobile raw decoding and lidar sampling enforce the smaller output budgets', () => {
  const profile = performanceProfile('mobile');
  const frame = decodeRawImage({ width: 1280, height: 720, step: 3840, encoding: 'rgb8', data: new Uint8Array(1280 * 720 * 3) }, profile);
  assert.equal(frame.width, 640); assert.equal(frame.height, 360);
  assert.equal(frame.rgba.byteLength, 640 * 360 * 4);
  const scan = decodeLidar({ ranges: Array(30000).fill(5), angle_min: 0, angle_increment: 0.01, range_min: 0.1, range_max: 100 }, profile.maxPoints);
  assert.equal(scan.count, 3000);
  assert.equal(scan.total, 30000);
});

test('corrupt or blocked performance storage falls back to automatic selection', () => {
  assert.equal(loadPerformancePreference({ getItem: () => 'mobile' }), 'mobile');
  assert.equal(loadPerformancePreference({ getItem: () => 'unexpected' }), 'auto');
  assert.equal(loadPerformancePreference({ getItem() { throw new Error('Denied'); } }), 'auto');
});

test('mobile budgets full-resolution wire payloads before display resizing and shares capacity across visible sensors', () => {
  const type = 'sensor_msgs/msg/Image';
  const image = { data: new Uint8Array(1920 * 1080 * 3) };
  const bytes = sensorPayloadBytes(image);
  assert.ok(bytes >= 1920 * 1080 * 3);
  assert.equal(sensorThrottle(type, 'mobile', true), 3000);
  const interval = sensorThrottle(type, 'mobile', true, bytes);
  assert.ok(interval >= 2900, 'Full-HD raw images must not be requested at 10 FPS');
  assert.ok(bytes * 1000 / interval <= 2 * 1024 * 1024);
  const shared = sensorThrottle(type, 'mobile', true, bytes, 2);
  assert.ok(2 * bytes * 1000 / shared <= 2 * 1024 * 1024);
  assert.equal(sensorThrottle(type, 'mobile', false, bytes), null);
  assert.equal(sensorThrottle(type, 'desktop', true, bytes), 50);
  assert.equal(sensorThrottle(type, 'desktop', false, bytes), 1000);
  assert.equal(sensorThrottle('sensor_msgs/msg/CompressedImage', 'mobile', true, 60000), 100);
  assert.ok(sensorPayloadBytes(image, 'none') > bytes, 'JSON base64 expansion must count against the budget');
});
