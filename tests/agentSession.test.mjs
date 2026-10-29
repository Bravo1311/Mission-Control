import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_STORAGE_KEY, MAX_CHAT_MESSAGES, createAgentSession } from '../src/lib/agentSession.js';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

test('local messages persist, stay bounded, and are never replayed to an adapter', async () => {
  const storage = memoryStorage();
  const session = createAgentSession({ storage });
  for (let i = 0; i < MAX_CHAT_MESSAGES + 5; i++) session.submit(`Note ${i}`);
  assert.equal(session.getSnapshot().messages.length, MAX_CHAT_MESSAGES);
  const restored = createAgentSession({ storage });
  assert.equal(restored.getSnapshot().messages.at(-1).content, 'Note 64');
  let request;
  restored.setTransport({ send: async input => { request = input; return 'Ready'; } });
  assert.equal(request, undefined);
  restored.submit('Hello', { connectionStatus: 'disconnected', topics: [] });
  await flush();
  assert.deepEqual(request.messages, [{ role: 'user', content: 'Hello' }]);
  assert.deepEqual(request.context, { connectionStatus: 'disconnected', topics: [] });
  assert.equal(restored.getSnapshot().messages.at(-1).status, 'complete');
});

test('streaming cancellation aborts the request and ignores late results', async () => {
  let request, finish;
  const session = createAgentSession({ transport: { send: input => {
    request = input;
    return new Promise(resolve => { finish = resolve; });
  } } });
  session.submit('Start');
  assert.equal(session.submit('Duplicate'), false);
  await flush();
  request.onDelta('Partial');
  session.cancel();
  assert.equal(request.signal.aborted, true);
  request.onDelta(' late');
  finish('Late response');
  await flush();
  assert.equal(session.getSnapshot().pending, false);
  assert.equal(session.getSnapshot().messages.at(-1).content, 'Partial');
  assert.equal(session.getSnapshot().messages.at(-1).status, 'cancelled');
});

test('clearing history cancels in-flight work without restoring stale messages', async () => {
  const storage = memoryStorage();
  let request, finish;
  const session = createAgentSession({ storage, transport: { send: input => {
    request = input;
    return new Promise(resolve => { finish = resolve; });
  } } });
  session.submit('Start');
  await flush();
  session.clear();
  finish('Old reply');
  await flush();
  assert.equal(request.signal.aborted, true);
  assert.deepEqual(session.getSnapshot().messages, []);
  assert.deepEqual(createAgentSession({ storage }).getSnapshot().messages, []);
});

test('failed and empty responses allow a subsequent request', async () => {
  const session = createAgentSession({ transport: { send: async () => { throw new Error('Offline'); } } });
  session.submit('Hello');
  await flush();
  assert.equal(session.getSnapshot().pending, false);
  assert.equal(session.getSnapshot().messages.at(-1).error, 'Offline');
  session.setTransport({ send: async () => '' });
  assert.equal(session.submit('Try again'), true);
  await flush();
  assert.equal(session.getSnapshot().messages.at(-1).status, 'error');
  session.setTransport({ send: async () => ({ content: 'Recovered' }) });
  session.submit('Retry');
  await flush();
  assert.equal(session.getSnapshot().messages.at(-1).content, 'Recovered');
});

test('unavailable storage retains session messages and reports persistence failure', () => {
  const storage = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Full'); } };
  const session = createAgentSession({ storage });
  assert.equal(session.submit('Local note'), true);
  assert.equal(session.getSnapshot().historySaved, false);
  assert.equal(session.getSnapshot().messages[0].content, 'Local note');
});

test('restored pending replies become stopped and malformed history is ignored', () => {
  const storage = memoryStorage();
  storage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ version: 1, messages: [
    { id: 'reply', role: 'assistant', content: 'Partial', createdAt: new Date().toISOString(), status: 'pending' },
    { id: 'bad', role: 'system', content: 'Invalid', createdAt: 'invalid' },
  ] }));
  const session = createAgentSession({ storage });
  assert.equal(session.getSnapshot().messages.length, 1);
  assert.equal(session.getSnapshot().messages[0].status, 'cancelled');
  assert.equal(session.getSnapshot().pending, false);
  storage.setItem(CHAT_STORAGE_KEY, '{invalid');
  assert.deepEqual(createAgentSession({ storage }).getSnapshot().messages, []);
});
