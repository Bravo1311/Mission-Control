import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { topicStyle as trajectoryStyle } from '../src/lib/topicStyles.js';

test('one vehicle uses one hue, with distinct IMU, GPS and fusion source styles', () => {
  const styles = ['imu/odom', 'gps/odom', 'fusion/odom'].map(path => trajectoryStyle(`/drone_1/${path}`));
  assert.equal(new Set(styles.map(style => style.hue)).size, 1);
  assert.equal(new Set(styles.map(style => style.color)).size, 3);
  assert.deepEqual(styles.map(style => style.pattern), ['dotted', 'dashed', 'solid']);
  assert.deepEqual(styles.map(style => style.sourceLabel), ['imu/odom', 'gps/odom', 'fusion/odom']);
  // The same color strings must be understood by both CSS and Three.js.
  for (const style of styles) assert.notEqual(new Color(style.color).getHexString(), 'ffffff');
});

test('source conventions match between drones while vehicle hues differ', () => {
  assert.notEqual(trajectoryStyle('/drone_0/odom').hue, trajectoryStyle('/drone_1/odom').hue);
  for (const source of ['imu/odom', 'gps/fix', 'fusion/odom', 'ground_truth/pose', 'odometry']) {
    const a = trajectoryStyle(`/drone_1/${source}`), b = trajectoryStyle(`/drone_2/${source}`);
    assert.notEqual(a.hue, b.hue);
    assert.equal(a.pattern, b.pattern);
    assert.equal(a.sourceKind, b.sourceKind);
    assert.equal(a.sourceLabel, b.sourceLabel);
  }
});

test('grouping handles case, nested vehicle namespaces and arbitrary prefixes', () => {
  assert.equal(trajectoryStyle('/Drone_1/imu/odom').groupKey, trajectoryStyle('/drone_1/gps/fix').groupKey);
  const nested = trajectoryStyle('/fleet_a/drone_2/localization/gnss/odom');
  assert.equal(nested.groupKey, 'fleet_a/drone_2');
  assert.equal(nested.sourceKind, 'gps');
  assert.notEqual(nested.groupKey, trajectoryStyle('/fleet_b/drone_2/odom').groupKey);
  assert.equal(trajectoryStyle('/rover_alpha/localization/odom').groupLabel, 'rover_alpha');
  assert.equal(trajectoryStyle('/odom').groupLabel, 'Unnamespaced');
  assert.equal(trajectoryStyle('/imu/filtered_pose').sourceLabel, 'filtered_pose');
});

test('topic order and removing other sources never alter an existing track style', () => {
  const names = ['/drone_1/imu/odom', '/drone_2/imu/odom', '/drone_1/fusion/odom'];
  const first = new Map(names.map(name => [name, trajectoryStyle(name)]));
  for (const name of names.toReversed()) assert.deepEqual(trajectoryStyle(name), first.get(name));
  assert.deepEqual(trajectoryStyle(names[1]), first.get(names[1]));
  assert.equal(trajectoryStyle('/drone_1/fusion/gps/odom').sourceKind, 'fusion');
  assert.equal(trajectoryStyle('/drone_1/imu_bias/odom').sourceKind, 'imu');
  assert.equal(trajectoryStyle('/drone_1/gpsim/odom').sourceKind, 'odometry');
});
