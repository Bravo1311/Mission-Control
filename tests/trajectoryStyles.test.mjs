import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { topicStyle as trajectoryStyle } from '../src/lib/topicStyles.js';

test('drone badges share one group color while IMU, GPS and fusion have separated source hues', () => {
  const styles = ['imu/odom', 'gps/odom', 'fusion/odom'].map(path => trajectoryStyle(`/drone_1/${path}`));
  assert.equal(new Set(styles.map(style => style.hue)).size, 1);
  assert.equal(new Set(styles.map(style => style.groupColor)).size, 1);
  assert.equal(new Set(styles.map(style => style.sourceHue)).size, 3);
  assert.equal(new Set(styles.map(style => style.color)).size, 3);
  assert.deepEqual(styles.map(style => style.pattern), ['dotted', 'dashed', 'solid']);
  assert.deepEqual(styles.map(style => style.sourceLabel), ['imu/odom', 'gps/odom', 'fusion/odom']);
  // The same color strings must be understood by both CSS and Three.js.
  for (const style of styles) assert.notEqual(new Color(style.color).getHexString(), 'ffffff');
});

const rgb = color => [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
const distance = (a, b) => Math.hypot(...rgb(a).map((value, index) => value - rgb(b)[index]));
const luminance = color => rgb(color).map(value => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

test('common sources have visibly separated colors and contrast against dark chart surfaces', () => {
  for (const drone of ['drone_1', 'drone_2', 'drone_3', 'drone_4', 'drone_5', 'drone_6', 'drone_7', 'drone_8', 'fleet/robot_1']) {
    const styles = ['fusion/odom', 'imu/odom', 'gps/odom', 'odometry', 'ground_truth/pose'].map(source => trajectoryStyle(`/${drone}/${source}`));
    for (const [index, style] of styles.entries()) {
      for (const other of styles.slice(index + 1)) {
        assert.ok(distance(style.color, other.color) >= 65, `${drone}: ${style.sourceLabel} ${style.color} is too close to ${other.sourceLabel} ${other.color}`);
      }
      for (const background of ['#10141a', '#171d25', '#000000']) {
        assert.ok((luminance(style.color) + 0.05) / (luminance(background) + 0.05) >= 4, `${style.color} must remain visible on ${background}`);
      }
      assert.equal(style.nightColor, style.color, 'Night lighting must preserve source identity');
    }
  }
});

test('separate feeds of the same source kind get name-specific colors', () => {
  for (const sources of [['gps/odom', 'gnss/odom', 'rtk/odom'], ['fusion/local/odom', 'fusion/global/odom', 'ekf/odom'], ['odometry', 'odom', 'wheel/odom']]) {
    const colors = sources.map(source => trajectoryStyle(`/drone_1/${source}`).color);
    assert.equal(new Set(colors).size, sources.length);
    for (const [index, color] of colors.entries()) {
      for (const other of colors.slice(index + 1)) assert.ok(distance(color, other) >= 65, `${sources.join(', ')} must have more than subtle shade differences`);
    }
  }
});

test('source conventions match between drones while vehicle hues differ', () => {
  assert.notEqual(trajectoryStyle('/drone_1/odometry').pattern, trajectoryStyle('/drone_1/fusion/odom').pattern);
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
