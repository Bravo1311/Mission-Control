import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { parseArgs } from 'node:util';
import { createPreviewProxy } from './previewProxy.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

const AGENT_MAX_BODY = 64 * 1024;
const AGENT_TIMEOUT_MS = 180000;   // a language-model turn can take a while

// Forwards the Snappy chat API (python3 -m drone_agent_core.web). Only the
// content type, length and Authorization header cross; cookies and the browser
// Origin do not, and a foreign Origin is refused here, as for the WebSocket.
function proxyAgent(request, response, pathname, agent) {
  const fail = (code, message) => { if (!response.headersSent) response.writeHead(code, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: message })); };
  if (!['GET', 'POST'].includes(request.method)) { fail(405, 'use GET or POST'); return; }
  if (request.headers.origin) {
    try {
      const origin = new URL(request.headers.origin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) { fail(403, 'cross-origin requests are not allowed'); return; }
    } catch { fail(403, 'cross-origin requests are not allowed'); return; }
  }
  const length = request.headers['content-length'];
  if (request.method === 'POST' && (length === undefined || !/^\d+$/.test(length))) { fail(411, 'Content-Length is required'); return; }
  if (Number(length) > AGENT_MAX_BODY) { fail(413, 'request too large'); return; }
  const headers = {};
  for (const name of ['content-type', 'content-length', 'authorization']) if (request.headers[name]) headers[name] = request.headers[name];
  const upstream = http.request({ hostname: agent.hostname, port: agent.port, path: pathname, method: request.method, headers, timeout: AGENT_TIMEOUT_MS }, remote => {
    response.writeHead(remote.statusCode, { 'Content-Type': remote.headers['content-type'] || mime['.json'], 'Cache-Control': 'no-store' });
    remote.pipe(response);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => fail(502, 'Snappy is not reachable'));
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}

export function createLanServer({ root = fileURLToPath(new URL('../dist', import.meta.url)), bridgeUrl = 'ws://127.0.0.1:2019', agentUrl = 'http://127.0.0.1:8765' } = {}) {
  const agent = new URL(agentUrl);
  if (agent.protocol !== 'http:' || agent.username || agent.password || agent.hash) {
    throw new Error('Agent URL must use http:// without credentials or a fragment.');
  }
  const target = new URL(bridgeUrl);
  if (!['ws:', 'wss:'].includes(target.protocol) || target.username || target.password || target.hash) {
    throw new Error('Bridge URL must use ws:// or wss:// without credentials or a fragment.');
  }
  const rootPath = realpath(root);
  const sockets = new Set();
  const previewProxy = createPreviewProxy(target);
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    if (request.url.split('?')[0].startsWith('/api/agent/')) { proxyAgent(request, response, request.url.split('?')[0], agent); return; }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/dashboard-config.json') {
        response.writeHead(200, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ bridgePath: '/rosbridge/preview' }));
        return;
      }
      if (['/rosbridge', '/rosbridge/preview'].includes(pathname)) { response.writeHead(426).end('WebSocket upgrade required.'); return; }
      if (pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(403).end(); return;
      }
      const base = await rootPath;
      const file = await realpath(resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`));
      if (!file.startsWith(base + sep)) { response.writeHead(403).end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      response.writeHead(error instanceof URIError ? 400 : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500).end();
    }
  });
  // Proxy the WebSocket byte stream directly: pipe provides backpressure and
  // preserves rosbridge CBOR frames without decoding/re-encoding on the host.
  server.on('upgrade', (request, client, head) => {
    const reject = code => client.end(`HTTP/1.1 ${code}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (!['/rosbridge', '/rosbridge/preview'].includes(request.url) || request.headers.upgrade?.toLowerCase() !== 'websocket') {
      reject('404 Not Found'); return;
    }
    if (request.headers.origin) {
      try {
        const origin = new URL(request.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) {
          reject('403 Forbidden'); return;
        }
      } catch { reject('403 Forbidden'); return; }
    }
    if (request.url === '/rosbridge/preview') { previewProxy.upgrade(request, client, head); return; }
    const upstreamUrl = new URL(target);
    upstreamUrl.protocol = target.protocol === 'wss:' ? 'https:' : 'http:';
    const upstream = (target.protocol === 'wss:' ? https : http).request(upstreamUrl, {
      headers: { ...request.headers, host: target.host }, method: 'GET', timeout: 10000,
    });
    const closePending = () => upstream.destroy();
    client.once('close', closePending);
    upstream.on('timeout', () => upstream.destroy(new Error('Bridge connection timed out')));
    upstream.on('error', () => { if (!client.destroyed) reject('502 Bad Gateway'); });
    upstream.on('response', response => { response.resume(); reject('502 Bad Gateway'); });
    upstream.on('upgrade', (response, remote, remoteHead) => {
      client.removeListener('close', closePending);
      remote.setTimeout(0);
      sockets.add(remote); remote.once('close', () => sockets.delete(remote));
      client.on('error', () => remote.destroy());
      remote.on('error', () => client.destroy());
      client.once('close', () => remote.destroy());
      remote.once('close', () => client.destroy());
      const headers = response.rawHeaders;
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${Array.from({ length: headers.length / 2 }, (_, i) => `${headers[i * 2]}: ${headers[i * 2 + 1]}`).join('\r\n')}\r\n\r\n`);
      if (head.length) remote.write(head);
      if (remoteHead.length) client.write(remoteHead);
      client.pipe(remote); remote.pipe(client);
    });
    upstream.end();
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  });
  server.shutdown = () => new Promise(resolve => {
    server.close(resolve);
    previewProxy.close();
    sockets.forEach(socket => socket.destroy());
  });
  // Consume an early missing-build rejection even if no HTTP request arrives.
  rootPath.catch(() => {});
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { host: { type: 'string', default: '0.0.0.0' },
      port: { type: 'string', default: '4173' }, agent: { type: 'string', default: process.env.SNAPPY_AGENT_URL || 'http://127.0.0.1:8765' }, bridge: { type: 'string', default: process.env.ROSBRIDGE_URL || 'ws://127.0.0.1:2019' } } });
    const port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
    await stat(new URL('../dist/index.html', import.meta.url));
    const server = createLanServer({ bridgeUrl: values.bridge, agentUrl: values.agent });
    server.on('error', error => { console.error(`LAN server: ${error.message}`); process.exitCode = 1; });
    server.listen(port, values.host, () => {
      console.log(`Mission Control: http://localhost:${port}`);
      const addresses = values.host === '0.0.0.0' || values.host === '::'
        ? Object.values(networkInterfaces()).flat().filter(address => address.family === 'IPv4' && !address.internal).map(address => address.address)
        : [values.host];
      [...new Set(addresses)].forEach(address => console.log(`Phone / LAN: http://${address.includes(':') ? `[${address}]` : address}:${port}`));
      console.log(`Rosbridge proxy: /rosbridge/preview → ${values.bridge} (mobile camera previews enabled)`);
      console.log(`Snappy chat API: /api/agent/* → ${values.agent} (needs the access token printed by the Snappy web server)`);
      console.log('Use a trusted local network. Press Ctrl+C to stop.');
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.shutdown(); });
  } catch (error) { console.error(`LAN server: ${error.message}. Run npm run build first.`); process.exitCode = 1; }
}
