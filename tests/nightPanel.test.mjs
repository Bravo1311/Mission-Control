import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNightPreferences, nightBrightness, applyNightPreferences, focusPanelLayout, cameraBrightness } from '../src/lib/nightPanel.js';
import { loadFocusPanels, saveFocusPanels, FOCUS_PANELS_KEY } from '../src/lib/panelPreferences.js';
import { streamStatus } from '../src/lib/streamStatus.js';

test('legacy Night preferences enable lighting without implicitly enabling Focus', () => {
  const defaults = { enabled: false, brightness: 75, focus: false, cameraBrightness: 80 };
  assert.deepEqual(loadNightPreferences(), defaults);
  assert.deepEqual(loadNightPreferences({ getItem: key => key === 'mission-control.night-panel' ? 'on' : null }), { ...defaults, enabled: true });
  assert.deepEqual(loadNightPreferences({ getItem() { throw new Error('blocked'); } }), defaults);
  assert.equal(nightBrightness('bad'), 75);
  assert.equal(nightBrightness(5), 40);
  assert.equal(nightBrightness(500), 100);
  assert.equal(cameraBrightness('bad'), 80);
  assert.equal(cameraBrightness(5), 20);
  assert.equal(cameraBrightness(500), 100);
});

test('Night, Focus and camera illumination apply independently without resetting either mode', () => {
  const properties = {};
  const root = { dataset: {}, style: { setProperty: (key, value) => { properties[key] = value; } } };
  applyNightPreferences(root, { enabled: true, focus: false, brightness: 65, cameraBrightness: 45 });
  assert.deepEqual(root.dataset, { night: 'on', focus: 'off' });
  assert.equal(properties['--night-brightness'], '0.65');
  assert.equal(properties['--night-camera-brightness'], '0.45');
  applyNightPreferences(root, { enabled: false, focus: true, brightness: 80 });
  assert.deepEqual(root.dataset, { night: 'off', focus: 'on' });
});

test('Focus prioritizes alerts and lit panels, compacts standby, and never mutates normal geometry', () => {
  const panels = [{ id: 'trajectory' }, { id: 'attitude:a', kind: 'attitude' }, { id: 'attitude:b', kind: 'attitude' }, { id: 'error' }, { id: 'camera' }];
  const normal = panels.map((panel, index) => ({ i: panel.id, x: 0, y: index*20, w: panel.kind === 'attitude' ? 6 : 12, h: 16, minH: 8 }));
  const copy = structuredClone(normal);
  const focus = focusPanelLayout(normal, panels, { trajectory: 'standby', 'attitude:a': 'standby', 'attitude:b': 'revealed', error: 'alert', camera: 'standby' });
  assert.deepEqual(normal, copy);
  assert.deepEqual(focus.map(item => item.i), ['error', 'attitude:b', 'trajectory', 'attitude:a', 'camera']);
  assert.equal(focus[0].y, 0);
  assert.equal(focus.at(-1).h, 2);
  assert.equal(focus.at(-1).w, 12);
  assert.equal(focus.find(item => item.i === 'attitude:a').h, 2, 'Flight panels can also be blanked');
  assert.equal(focus.find(item => item.i === 'error').h, 16);
  assert.deepEqual(focusPanelLayout([], [], {}), []);
});

test('per-panel Focus choices persist including an explicitly blanked drone panel', () => {
  let value;
  const storage = { getItem: key => key === FOCUS_PANELS_KEY ? value : null, setItem: (key, next) => { assert.equal(key, FOCUS_PANELS_KEY); value = next; } };
  const choices = { gps: true, 'attitude:drone_1': false, error: false };
  saveFocusPanels(storage, choices);
  assert.deepEqual(loadFocusPanels(storage), choices);
  value = '{"gps":true,"unknown":true,"camera":"yes"}';
  assert.deepEqual(loadFocusPanels(storage), { gps: true });
  value = 'null'; assert.deepEqual(loadFocusPanels(storage), {});
  value = '[]'; assert.deepEqual(loadFocusPanels(storage), {});
  value = 'broken'; assert.deepEqual(loadFocusPanels(storage), {});
});

test('stream status distinguishes retained, missing, intentionally paused and slow data', () => {
  const buffer = { raw: [{}], reception: { last: 1000, fps: 20 } };
  assert.equal(streamStatus(buffer, 'connected', 2000), 'Live');
  assert.equal(streamStatus(buffer, 'connected', 5000), 'Stale');
  assert.equal(streamStatus(buffer, 'disconnected', 2000), 'Disconnected');
  assert.equal(streamStatus({ raw: [] }, 'connected', 2000), 'Waiting');
  assert.equal(streamStatus(buffer, 'connected', 5000, { paused: true }), 'Paused');
  assert.equal(streamStatus(buffer, 'connected', 5000, { standby: true }), 'Standby');
  assert.equal(streamStatus({ raw: [{}], reception: { last: 1000, fps: .1 } }, 'connected', 20000), 'Live');
});
