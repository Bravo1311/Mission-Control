import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryUpdates, sampleIndices } from '../src/lib/telemetryUpdates.js';

test('high-rate traffic is coalesced independently for instruments and charts', () => {
  const updates = createTelemetryUpdates();
  let fast = 0, slow = 0;
  updates.channel(50).subscribe(() => fast++);
  updates.channel(250).subscribe(() => slow++);
  for (let ms = 0; ms < 10000; ms++) {
    for (let topic = 0; topic < 32; topic++) updates.mark();
    updates.flush(ms);
  }
  assert.equal(fast, 200);
  assert.equal(slow, 40);
});

test('idle flushes do no rendering and removed listeners stay removed', () => {
  const updates = createTelemetryUpdates();
  let calls = 0;
  const channel = updates.channel(50);
  const stop = channel.subscribe(() => calls++);
  updates.flush(0);
  assert.equal(calls, 0);
  updates.mark(); updates.flush(50);
  assert.equal(calls, 1);
  for (let t = 100; t < 10000; t += 50) updates.flush(t);
  assert.equal(calls, 1);
  stop(); updates.mark(); updates.flush(10000);
  assert.equal(calls, 1);
});

test('drawing budget preserves endpoints and chronological order', () => {
  for (const length of [0, 1, 2, 599, 600, 2400, 20000]) {
    const indices = sampleIndices(length);
    assert.equal(indices.length, Math.min(length, 600));
    if (!length) continue;
    assert.equal(indices[0], 0);
    assert.equal(indices.at(-1), length - 1);
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual(indices, [...indices].sort((a, b) => a - b));
  }
});
