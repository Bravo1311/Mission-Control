import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';
import { createLanServer } from '../scripts/serve-lan.mjs';

async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'mission-lan-test-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<h1>Mission Control</h1>');
  await writeFile(join(root, 'assets', 'test.js'), 'console.log("dashboard");');
  const server = createLanServer({ root, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await server.shutdown(); await rm(root, { recursive: true, force: true }); });
  return { server, root, url: `http://127.0.0.1:${server.address().port}` };
}

test('LAN server serves the built site and same-origin config with correct cache and MIME headers', async t => {
  const { url } = await setup(t);
  const page = await fetch(url);
  assert.equal(await page.text(), '<h1>Mission Control</h1>');
  assert.match(page.headers.get('content-type'), /text\/html/);
  const config = await fetch(`${url}/dashboard-config.json`);
  assert.deepEqual(await config.json(), { bridgePath: '/rosbridge/preview' });
  assert.equal(config.headers.get('cache-control'), 'no-store');
  const asset = await fetch(`${url}/assets/test.js`, { method: 'HEAD' });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal(await asset.text(), '');
  assert.equal((await fetch(`${url}/missing.js`)).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});

test('LAN server prevents traversal, dotfiles, malformed paths, and escaping symlinks', async t => {
  const { url, root } = await setup(t);
  await symlink('/etc/hosts', join(root, 'outside.txt'));
  for (const path of ['/.env', '/%2e%2e%2fpackage.json', '/outside.txt']) {
    assert.equal((await fetch(url + path)).status, 403, path);
  }
  assert.equal((await fetch(`${url}/%XX`)).status, 400);
});

test('LAN proxy carries text and binary frames and preserves configured bridge paths', async t => {
  const bridge = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(bridge, 'listening');
  t.after(() => { bridge.clients.forEach(client => client.terminate()); bridge.close(); });
  let upstreamPath;
  bridge.on('connection', (socket, request) => {
    upstreamPath = request.url;
    socket.on('message', (data, binary) => socket.send(data, { binary }));
  });
  const { url } = await setup(t, { bridgeUrl: `ws://127.0.0.1:${bridge.address().port}/robot?session=test` });
  const client = new WebSocket(url.replace('http:', 'ws:') + '/rosbridge', { origin: url });
  t.after(() => client.terminate());
  await once(client, 'open');
  let reply = once(client, 'message');
  client.send('{"op":"subscribe","topic":"/imu"}');
  let [data, binary] = await reply;
  assert.equal(binary, false); assert.match(data.toString(), /subscribe/);
  reply = once(client, 'message');
  const frame = Buffer.alloc(1024 * 1024, 217);
  client.send(frame);
  [data, binary] = await reply;
  assert.equal(binary, true); assert.deepEqual(data, frame);
  assert.equal(upstreamPath, '/robot?session=test');
  client.close(); await once(client, 'close');
});

test('LAN proxy rejects other origins and responds cleanly when the bridge is unavailable', async t => {
  const { url } = await setup(t, { bridgeUrl: 'ws://127.0.0.1:1' });
  for (const [origin, status] of [['http://untrusted.example', 403], [url, 502]]) {
    const client = new WebSocket(url.replace('http:', 'ws:') + '/rosbridge', { origin });
    const response = await new Promise(resolve => {
      client.on('unexpected-response', (_, response) => { response.resume(); client.terminate(); resolve(response.statusCode); });
      client.on('error', () => {});
    });
    assert.equal(response, status);
  }
});
