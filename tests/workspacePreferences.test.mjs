import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFlightTopics, flightReading, flightSpeedLimit } from '../src/lib/flightState.js';
import { loadHiddenPanels, saveHiddenPanels, flightPanelId, panelDefinition } from '../src/lib/panelPreferences.js';

const topic = name => ({ name, type: 'nav_msgs/msg/Odometry' });

test('flight grouping preserves every topic for simultaneous overlays in a stable order', () => {
  const topics = ['/drone_1/odometry', '/drone_2/imu/odom', '/drone_1/gps/odom', '/drone_1/fusion/odom'].map(topic);
  const groups = groupFlightTopics(topics);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].topics.length, 3);
  assert.deepEqual(groups.flatMap(group => group.topics).map(item => item.name).toSorted(), topics.map(item => item.name).toSorted());
  assert.deepEqual(groupFlightTopics(topics.toReversed()), groups);
  assert.equal(groupFlightTopics([topic('/fleet_a/Drone_1/odom'), topic('/fleet_a/drone_1/fusion/odom'), topic('/fleet_b/drone_1/odom')]).length, 2);
});

test('hidden panel storage accepts known panels only and tolerates invalid storage', () => {
  assert.deepEqual(loadHiddenPanels({ getItem: () => '["camera","trajectory","camera","unknown"]' }), ['camera', 'trajectory']);
  for (const text of ['null', '{}', 'bad', 'false']) assert.deepEqual(loadHiddenPanels({ getItem: () => text }), []);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadHiddenPanels(blocked), []);
  assert.doesNotThrow(() => saveHiddenPanels(blocked, ['camera']));
  let saved;
  saveHiddenPanels({ setItem: (_, value) => { saved = value; } }, ['camera', 'gps']);
  assert.deepEqual(loadHiddenPanels({ getItem: () => saved }), ['camera', 'gps']);
});

test('each drone has a stable independent flight-panel identity and hidden preference', () => {
  const a = flightPanelId('fleet_a/drone_1'), b = flightPanelId('fleet_b/drone_1');
  assert.notEqual(a, b);
  assert.equal(panelDefinition(a).title, 'Flight state · fleet_a/drone_1');
  assert.equal(panelDefinition(flightPanelId('')).title, 'Flight state · Unnamespaced');
  const saved = JSON.stringify([a, b, a, 'attitude:%broken', 'unknown']);
  assert.deepEqual(loadHiddenPanels({ getItem: () => saved }), [a, b]);
  assert.deepEqual(loadHiddenPanels({ getItem: () => '["attitude"]' }), ['attitude']);
});

test('overlay readings keep topics independent, normalize quaternions and use compass headings', () => {
  for (const [yaw, expected] of [[0, 90], [Math.PI/2, 0], [Math.PI, 270], [-Math.PI/2, 180]]) {
    const reading = flightReading(topic('/drone_1/odom'), { pose: { pose: { orientation: { x: 0, y: 0, z: 3*Math.sin(yaw/2), w: 3*Math.cos(yaw/2) } } }, twist: { twist: { linear: { x: 3, y: 4, z: -2 } } } });
    assert.ok(Math.abs(reading.heading-expected) < 1e-8);
    assert.equal(reading.ground, 5); assert.equal(reading.vertical, -2);
  }
  const missing = flightReading(topic('/drone_2/pose'), { pose: { position: { x: 1, y: 2, z: 3 } } });
  for (const field of ['roll', 'pitch', 'heading', 'ground', 'vertical']) assert.equal(missing[field], null);
  assert.equal(flightReading(topic('/drone_2/pose')).waiting, true);
  assert.equal(flightReading(topic('/drone_2/pose'), { pose: { orientation: { x: 0, y: 0, z: 0, w: 0 } } }).heading, null);
});

test('shared speed ranges include every source and expand for signed outliers', () => {
  assert.equal(flightSpeedLimit([2, 3, null], 20), 20);
  assert.equal(flightSpeedLimit([2, 83], 20), 100);
  assert.equal(flightSpeedLimit([-12, 0.1], 5), 20);
  assert.equal(flightSpeedLimit([NaN, Infinity, null], 5), 5);
});
