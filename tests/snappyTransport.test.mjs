import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSnappyToken, createSnappyTransport, loadSnappyToken, SNAPPY_TOKEN_KEY } from '../src/lib/snappyTransport.js';
import { routeConsoleInput, missionConsoleReply } from '../src/lib/missionControls.js';

const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values }; };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('the token is taken from the address fragment, stored, and removed from the address bar', () => {
  const storage = memory(); const replaced = [];
  const token = captureSnappyToken({ storage,
    location: { hash: '#snappy=abc123&x=1', pathname: '/', search: '?a=b' },
    history: { replaceState: (...args) => replaced.push(args) } });
  assert.equal(token, 'abc123');
  assert.equal(loadSnappyToken(storage), 'abc123');
  assert.equal(replaced[0][2], '/?a=b#x=1');
  assert.equal(captureSnappyToken({ storage, location: { hash: '', pathname: '/', search: '' }, history: {} }), '');
  assert.equal(storage.values.get(SNAPPY_TOKEN_KEY), 'abc123');
});

test('the transport sends only the newest message and the token, and returns the content', async () => {
  const calls = [];
  const transport = createSnappyTransport({ getToken: () => 'tok', fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(200, { content: 'hello' }); } });
  const text = await transport.send({ messages: [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'x' }, { role: 'user', content: 'take off' }], context: { topics: [{ name: '/secret' }] } });
  assert.equal(text, 'hello');
  assert.equal(calls[0].url, '/api/agent/chat');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(calls[0].init.body), { messages: [{ role: 'user', content: 'take off' }] });
});

test('transport failures explain what to do', async () => {
  const send = (getToken, fetchImpl) => createSnappyTransport({ getToken, fetchImpl }).send({ messages: [{ role: 'user', content: 'x' }] });
  await assert.rejects(send(() => '', async () => reply(200, {})), /No Snappy access token/);
  await assert.rejects(send(() => 't', async () => reply(401, {})), /rejected the access token/);
  await assert.rejects(send(() => 't', async () => reply(403, {})), /did not come from the dashboard/);
  await assert.rejects(send(() => 't', async () => reply(502, {})), /not reachable/);
  await assert.rejects(send(() => 't', async () => { throw new TypeError('fetch failed'); }), /not reachable/);
  await assert.rejects(send(() => 't', async () => reply(400, { error: 'bad body' })), /HTTP 400.*bad body/);
  await assert.rejects(send(() => 't', async () => reply(200, { content: 5 })), /content string/);
});

test('an aborted request stays an abort', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(createSnappyTransport({ getToken: () => 't', fetchImpl: async () => { throw abort; } }).send({ messages: [{ role: 'user', content: 'x' }] }), { name: 'AbortError' });
});

test('the console keeps dashboard commands local and sends the rest to Snappy', () => {
  for (const word of ['/help', '/status', '/topics', '/controls']) assert.equal(routeConsoleInput(word).kind, 'local', word);
  assert.deepEqual(routeConsoleInput('/note check battery'), { kind: 'note', text: 'check battery' });
  assert.deepEqual(routeConsoleInput('/flight'), { kind: 'snappy', text: '/status' });
  for (const text of ['take off to 5 m', '/approve 17a63ffe8b19', '/enable', '/stop', '/stpo']) assert.deepEqual(routeConsoleInput(text), { kind: 'snappy', text });
});

test('the console help lists both command sets', () => {
  const help = missionConsoleReply('/help', {});
  assert.match(help, /\/flight/);
  assert.match(help, /\/topics/);
  assert.match(help, /\/approve/);
});
