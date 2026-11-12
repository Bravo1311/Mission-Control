import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseGroundTruth, pairedErrors, errorStats, errorPlotSeries, createErrorCalculator, MAX_ERROR_PLOT_POINTS } from '../src/lib/estimationError.js';
import { groupFlightTopics } from '../src/lib/flightState.js';
import { errorPanelId, panelDefinition, loadHiddenPanels, loadFocusPanels } from '../src/lib/panelPreferences.js';

const message = (x, velocity = x, q = { x: 0, y: 0, z: 0, w: 1 }) => ({
  pose: { pose: { position: { x, y: 0, z: 0 }, orientation: q } },
  twist: { twist: { linear: { x: velocity, y: 0, z: 0 } } },
});
const buffer = (times, values) => ({ t: times, raw: values.map(value => typeof value === 'number' ? message(value) : value), version: 1 });
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('per-drone reference choices never include another drone or fleet', () => {
  const groups = groupFlightTopics(['/drone_2/gnss/odom', '/drone_1/fusion/odom', '/drone_2/gt/odom', '/drone_1/ground_truth/odom', '/drone_1/gnss/odom', '/fleet/drone_1/odom']
    .map(name => ({ name, type: 'nav_msgs/msg/Odometry' })));
  assert.equal(groups.length, 3);
  for (const group of groups) {
    const names = group.topics.map(topic => topic.name);
    const reference = chooseGroundTruth(names, '/other/drone_1/gt');
    assert.ok(names.includes(reference));
    if (group.key === 'drone_1') assert.equal(reference, '/drone_1/ground_truth/odom');
    if (group.key === 'drone_2') assert.equal(reference, '/drone_2/gt/odom');
    assert.equal(chooseGroundTruth(names, names[0]), names[0], 'Preserve a valid user choice');
  }
  assert.equal(chooseGroundTruth([], 'missing'), null);
});

test('per-drone error panel identities and visibility preferences stay independent', () => {
  const ids = ['drone_1', 'drone_2', 'fleet/drone_1', ''].map(errorPanelId);
  assert.equal(new Set(ids).size, 4);
  assert.equal(panelDefinition(ids[0]).title, 'Estimation error · drone_1');
  assert.equal(panelDefinition(ids[2]).title, 'Estimation error · fleet/drone_1');
  assert.equal(panelDefinition(ids[3]).title, 'Estimation error · Unnamespaced');
  assert.deepEqual(loadHiddenPanels({ getItem: () => JSON.stringify([...ids, ids[0], 'error:%broken']) }), ids);
  assert.deepEqual(loadFocusPanels({ getItem: () => JSON.stringify({ [ids[0]]: true, [ids[1]]: false, invalid: true }) }), { [ids[0]]: true, [ids[1]]: false });
  assert.equal(panelDefinition('error').title, 'Estimation error', 'Old global preferences remain recognizable');
});

test('each estimate is interpolated against the shared ground truth at its own times', () => {
  const truth = buffer([0, 0.2, 0.4], [0, 2, 4]);
  const fusion = pairedErrors(truth, buffer([0.1, 0.3], [1.1, 3.1]));
  const gnss = pairedErrors(truth, buffer([0.05, 0.35], [1.5, 4.5]));
  fusion.pos.v.forEach(value => close(value, 0.1));
  gnss.pos.v.forEach(value => close(value, 1));
  assert.deepEqual(fusion.pos.t, [0.1, 0.3]);
  assert.deepEqual(gnss.pos.t, [0.05, 0.35]);
  close(errorStats(fusion.pos.v).rmse, 0.1);
  close(errorStats(gnss.pos.v).rmse, 1);
});

test('outages, missing fields and invalid values do not become zero errors or extrapolated pairs', () => {
  const truth = buffer([0, 0.2, 2, 2.2], [0, 2, 20, 22]);
  const estimate = buffer([-1, 0.1, 1, 2.1, 3], [0, 1, 10, 21, 30]);
  assert.deepEqual(pairedErrors(truth, estimate).pos.t, [0.1, 2.1]);
  const positionOnly = { pose: { position: { x: 1, y: 0, z: 0 } } };
  const series = pairedErrors(truth, buffer([0.1, 0.15], [positionOnly, message(NaN, NaN, { x: NaN, y: 0, z: 0, w: 1 })]));
  assert.deepEqual(series.pos.v, [0]);
  assert.deepEqual(series.ori.v, []);
  assert.deepEqual(series.vel.v, []);
  assert.equal(errorStats(series.ori.v).current, null);
});

test('orientation errors normalize quaternions and treat opposite signs as the same rotation', () => {
  const truth = buffer([0, 0.2], [message(0), message(0, 0, { x: 0, y: 0, z: 0, w: -3 })]);
  const estimate = buffer([0.1], [message(0, 0, { x: 0, y: 0, z: 0, w: 5 })]);
  close(pairedErrors(truth, estimate).ori.v[0], 0);
  const quarterTurn = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
  close(pairedErrors(truth, buffer([0.1], [message(0, 0, quarterTurn)])).ori.v[0], 90);
  assert.deepEqual(pairedErrors(truth, buffer([0.1], [message(0, 0, { x: 0, y: 0, z: 0, w: 0 })])).ori.v, []);
});

test('native NavSatFix contributes position alone using the existing ENU origin', () => {
  const truth = buffer([0, 0.2], [0, 0]);
  const fix = { latitude: 50.781020, longitude: 6.047028, altitude: 10, status: { status: 0 } };
  const result = pairedErrors(truth, buffer([0.1], [fix]));
  close(result.pos.v[0], 0);
  assert.deepEqual(result.ori.v, []);
  assert.deepEqual(result.vel.v, []);
  assert.deepEqual(pairedErrors(truth, buffer([0.1], [{ ...fix, status: { status: -1 } }])).pos.v, []);
});

test('chart points stay bounded and preserve peaks while stats use all pairs', () => {
  const series = { t: Array.from({ length: 2400 }, (_, i) => i / 20), v: Array.from({ length: 2400 }, () => 1) };
  series.v[1317] = 50;
  const display = errorPlotSeries(series);
  assert.ok(display.t.length <= MAX_ERROR_PLOT_POINTS);
  assert.equal(display.t[0], series.t[0]);
  assert.equal(display.t.at(-1), series.t.at(-1));
  assert.ok(display.v.includes(50));
  assert.ok(display.t.every((time, index) => !index || time > display.t[index - 1]));
  const stats = errorStats(series.v);
  assert.equal(stats.count, 2400);
  assert.equal(stats.max, 50);
  close(stats.mean, 2449 / 2400);
});

test('cache reuses idle results, handles reference changes and releases removed estimates', () => {
  const calculate = createErrorCalculator(), truth = buffer([0, 0.2], [0, 2]);
  const a = { name: 'fusion', buffer: buffer([0.1], [1.25]) };
  const b = { name: 'gnss', buffer: buffer([0.1], [2]) };
  const first = calculate(truth, [a, b]);
  assert.equal(calculate(truth, [a, b]), first, 'Unchanged results keep chart props stable');
  assert.equal(calculate(truth, [a, b])[0].all, first[0].all);
  a.buffer.raw[0] = message(1.5); a.buffer.version++;
  const updated = calculate(truth, [a, b]);
  close(updated[0].stats.pos.current, 0.5);
  assert.equal(updated[1].all, first[1].all);
  calculate(truth, [a]);
  assert.notEqual(calculate(truth, [a, b])[1].all, first[1].all);
  truth.raw = [message(1), message(3)]; truth.version++;
  close(calculate(truth, [a, b])[0].stats.pos.current, 0.5);
  close(calculate(buffer([0, 0.2], [10, 12]), [a])[0].stats.pos.current, 9.5);
  assert.deepEqual(calculate(truth, []), []);
});
