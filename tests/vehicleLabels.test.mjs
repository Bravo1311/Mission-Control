import test from 'node:test';
import assert from 'node:assert/strict';
import { topicStyle } from '../src/lib/topicStyles.js';
import { vehicleAnchors, placeVehicleLabels } from '../src/lib/vehicleLabels.js';

const record = (name, extra = {}) => ({ name, style: topicStyle(name), x: 100, y: 100, width: 150, height: 42, ...extra });

test('one label per vehicle follows an available fusion source with a stable fallback', () => {
  const records = [record('/drone_1/gps/odom'), record('/drone_2/imu/odom'), record('/drone_1/fusion/odom'), record('/drone_1/odometry')];
  const anchors = vehicleAnchors(records);
  assert.deepEqual(anchors.map(anchor => anchor.name), ['/drone_1/fusion/odom', '/drone_2/imu/odom']);
  assert.deepEqual(vehicleAnchors(records.toReversed()), anchors);
  assert.equal(vehicleAnchors(records.filter(item => !item.name.includes('fusion')))[0].name, '/drone_1/odometry');
  assert.deepEqual(vehicleAnchors([]), []);
});

test('coincident drone positions get separate labels bounded by desktop and phone panels', () => {
  for (const [width, height] of [[660, 360], [340, 240]]) {
    const placed = placeVehicleLabels([record('/drone_1/fusion/odom'), record('/drone_2/fusion/odom')], width, height);
    for (const box of placed) {
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.ok(box.y >= 0 && box.y + box.height <= height);
      assert.equal(box.anchorX, 100); assert.equal(box.anchorY, 100);
    }
    const [a, b] = placed;
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
});

test('labels near any panel edge remain inside while retaining the true anchor', () => {
  for (const [x, y] of [[0, 0], [340, 0], [0, 240], [340, 240]]) {
    const [box] = placeVehicleLabels([record('/drone_1/odom', { x, y })], 340, 240);
    assert.ok(box.x >= 0 && box.x + box.width <= 340);
    assert.ok(box.y >= 0 && box.y + box.height <= 240);
    assert.equal(box.anchorX, x); assert.equal(box.anchorY, y);
  }
});
