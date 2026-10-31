import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { validateControl, resolveControl, loadControls, executeRosControl, missionConsoleReply, CONTROLS_KEY, loadCommandLog } from '../src/lib/missionControls.js';
import { createAgentSession, CHAT_STORAGE_KEY } from '../src/lib/agentSession.js';

const control = { id: 'check', label: 'Check vehicle', kind: 'service', endpoint: '/{vehicle}/check', type: 'std_srvs/srv/Trigger', payload: '{}' };
class FakeRos extends EventEmitter {
  isConnected = true;
  packets = [];
  callOnConnection(packet) { this.packets.push(packet); }
}

test('controls validate ROS requests and preserve exact namespace case', () => {
  const prepared = resolveControl(control, '/Fleet/Drone_1/');
  assert.equal(prepared.endpoint, '/Fleet/Drone_1/check');
  assert.deepEqual(prepared.payload, {});
  assert.equal(prepared.target, '/Fleet/Drone_1');
  assert.throws(() => validateControl({ ...control, payload: '[]' }), /JSON object/);
  assert.throws(() => validateControl({ ...control, payload: 'broken' }), /valid JSON/);
  assert.throws(() => validateControl({ ...control, endpoint: '/{unknown}/command' }), /endpoint/);
  assert.throws(() => validateControl({ ...control, endpoint: 'relative/path' }), /absolute/);
  assert.throws(() => validateControl({ ...control, type: 'Wrong' }), /ROS type/);
});

test('control storage recovers from corrupt entries without executing anything', () => {
  assert.deepEqual(loadControls({ getItem: () => 'broken' }), []);
  assert.deepEqual(loadControls({ getItem() { throw new Error('blocked'); } }), []);
  const saved = loadControls({ getItem: key => key === CONTROLS_KEY ? JSON.stringify([control, { label: 'bad' }]) : null });
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].payload, {});
});

test('disconnected and unresolved commands send no packets and never queue', async () => {
  const ros = new FakeRos(); ros.isConnected = false;
  await assert.rejects(executeRosControl(ros, resolveControl(control, 'drone_1')), /Connect/);
  assert.equal(ros.packets.length, 0);
  ros.isConnected = true;
  await assert.rejects(executeRosControl(ros, control), /Resolve the target/);
  assert.equal(ros.packets.length, 0);
});

test('service commands send once and clean up response/close listeners', async () => {
  const ros = new FakeRos();
  const promise = executeRosControl(ros, resolveControl(control, 'drone_1'));
  assert.equal(ros.packets.length, 1);
  const packet = ros.packets[0];
  assert.equal(packet.op, 'call_service');
  assert.equal(packet.service, '/drone_1/check');
  assert.deepEqual(packet.args, {});
  ros.emit(packet.id, { result: true, values: { success: true } });
  assert.equal((await promise).state, 'replied');
  assert.equal(ros.listenerCount(packet.id), 0);
  assert.equal(ros.listenerCount('close'), 0);
  const rejected = executeRosControl(ros, resolveControl(control, 'drone_1'));
  ros.emit(ros.packets.at(-1).id, { result: true, values: { success: false, message: 'not ready' } });
  assert.equal((await rejected).state, 'rejected');
});

test('service timeout and disconnect preserve unknown outcomes and do not retry', async () => {
  const ros = new FakeRos();
  await assert.rejects(executeRosControl(ros, resolveControl(control, 'drone_1'), 10), /outcome is unknown/);
  assert.equal(ros.packets.length, 1);
  assert.equal(ros.eventNames().length, 0);
  const promise = executeRosControl(ros, resolveControl(control, 'drone_1'));
  ros.emit('close');
  await assert.rejects(promise, /will not be retried/);
  assert.equal(ros.packets.length, 2);
  assert.equal(ros.eventNames().length, 0);
});

test('one-shot publication advertises, sends, releases and reports no vehicle confirmation', async () => {
  const ros = new FakeRos();
  const command = resolveControl({ ...control, kind: 'publish', type: 'std_msgs/msg/Bool', payload: '{"data":true}' }, 'drone_2');
  const result = await executeRosControl(ros, command);
  assert.deepEqual(ros.packets.map(packet => packet.op), ['advertise', 'publish', 'unadvertise']);
  assert.equal(ros.packets[1].topic, '/drone_2/check');
  assert.deepEqual(ros.packets[1].msg, { data: true });
  assert.equal(result.state, 'sent');
  assert.match(result.message, /not confirmed/);
});

test('mission console reports local status and never interprets text as vehicle commands', () => {
  const context = { status: 'connected', target: '/drone_1', topics: [{ name: '/drone_1/odom', type: 'nav_msgs/msg/Odometry' }], controls: [control] };
  assert.match(missionConsoleReply('/status', context), /Target: \/drone_1/);
  assert.match(missionConsoleReply('/topics', context), /nav_msgs/);
  assert.match(missionConsoleReply('/controls', context), /Check vehicle/);
  assert.match(missionConsoleReply('take off now', context), /local mission note/);
  assert.match(missionConsoleReply('/launch', context), /Unknown console command/);
});

test('mission and analysis chat histories stay separate', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const analysis = createAgentSession({ storage });
  const mission = createAgentSession({ storage, storageKey: 'mission-chat' });
  analysis.submit('analysis note'); mission.submit('mission note');
  assert.equal(JSON.parse(values.get(CHAT_STORAGE_KEY)).messages[0].content, 'analysis note');
  assert.equal(JSON.parse(values.get('mission-chat')).messages[0].content, 'mission note');
  assert.equal(createAgentSession({ storage, storageKey: 'mission-chat' }).getSnapshot().messages.length, 1);
});

test('pending command records recover as unknown rather than implying success or replay', () => {
  const saved = [{ id: 'pending', at: new Date().toISOString(), label: 'Check', endpoint: '/drone_1/check', state: 'pending', message: 'Waiting' }];
  const log = loadCommandLog({ getItem: () => JSON.stringify(saved) });
  assert.equal(log[0].state, 'unknown');
  assert.match(log[0].message, /no retry/);
  assert.deepEqual(loadCommandLog({ getItem: () => 'broken' }), []);
});

test('large service responses are bounded before being formatted for the command log', async () => {
  const ros = new FakeRos();
  const promise = executeRosControl(ros, resolveControl(control, 'drone_1'));
  ros.emit(ros.packets[0].id, { result: true, values: { samples: Array(100000).fill('x'.repeat(5000)) } });
  assert.ok((await promise).message.length <= 2000);
});
