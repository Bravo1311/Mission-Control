import { Worker } from 'node:worker_threads';
import { WebSocket, WebSocketServer } from 'ws';
import { decode, encode } from 'cbor2';

const MAX_BUFFER = 4 * 1024 * 1024;
const CAMERA_TYPE = /(?:^|\/)sensor_msgs\/(?:msg\/)?(?:Image|CompressedImage)$/;

export function createPreviewProxy(target) {
  const gateway = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
  const sessions = new Set();
  const upgrade = (request, socket, head) => {
    const upstream = new WebSocket(target, { perMessageDeflate: false, handshakeTimeout: 10000,
      maxPayload: 64 * 1024 * 1024,
      ...(request.headers.origin ? { origin: request.headers.origin } : {}) });
    const abandon = () => upstream.terminate();
    socket.once('close', abandon);
    const failHandshake = () => {
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    };
    upstream.on('error', failHandshake);
    upstream.once('open', () => {
      if (socket.destroyed) { upstream.terminate(); return; }
      socket.removeListener('close', abandon);
      upstream.removeListener('error', failHandshake);
      gateway.handleUpgrade(request, socket, head, client => {
        let profile = 'desktop', worker = null, job = null, sequence = 0, pendingWrites = 0;
        const subscriptions = new Map();
        const cameraTopics = new Set();
        const stopWorker = () => {
          clearTimeout(job?.timer); job = null;
          worker?.terminate(); worker = null;
        };
        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true; stopWorker(); subscriptions.clear();
          client.terminate(); upstream.terminate(); sessions.delete(cleanup);
        };
        sessions.add(cleanup);
        client.on('close', cleanup); client.on('error', cleanup);
        upstream.on('close', cleanup); upstream.on('error', cleanup);
        const send = (data, binary) => {
          if (client.readyState !== WebSocket.OPEN || upstream.readyState !== WebSocket.OPEN) return;
          // One write window at a time; a slow phone also backpressures the bridge.
          pendingWrites++; upstream.pause();
          client.send(data, { binary }, error => {
            pendingWrites--;
            if (error) cleanup();
            else if (!pendingWrites && upstream.readyState === WebSocket.OPEN) upstream.resume();
          });
        };
        const finish = result => {
          if (!job || result.id !== job.id) return;
          const current = job; clearTimeout(current.timer); job = null;
          if (profile !== 'mobile' || subscriptions.get(current.envelope.topic) !== current.subscription) return;
          const message = result.message;
          if (!current.binary && message.data) message.data = Buffer.from(message.data).toString('base64');
          const envelope = { ...current.envelope, msg: message };
          send(current.binary ? encode(envelope) : JSON.stringify(envelope), current.binary);
        };
        const prepare = (envelope, binary, subscription) => {
          if (job || client.bufferedAmount > MAX_BUFFER) return; // latest frame, no queued decode work
          if (!worker) {
            worker = new Worker(new URL('./cameraPreview.worker.mjs', import.meta.url));
            worker.on('message', finish);
            worker.on('error', () => {
              if (job) finish({ id: job.id, message: { previewError: 'Camera preview preparation failed. Pause and resume to retry.' } });
              stopWorker();
            });
          }
          const id = ++sequence;
          job = { id, envelope: { ...envelope, msg: undefined }, binary, subscription,
            timer: setTimeout(() => {
              finish({ id, message: { previewError: 'Camera preview preparation timed out. Use a smaller image source.' } });
              stopWorker();
            }, 5000) };
          try { worker.postMessage({ id, message: envelope.msg }); }
          catch {
            finish({ id, message: { previewError: 'Unable to prepare camera preview.' } }); stopWorker();
          }
        };
        client.on('message', (data, binary) => {
          let message;
          if (!binary) { try { message = JSON.parse(data.toString()); } catch { /* bridge validates other commands */ } }
          if (message?.op === 'mission_control_preview') {
            if (['mobile', 'desktop'].includes(message.profile) && profile !== message.profile) {
              profile = message.profile; stopWorker();
            }
            return;
          }
          if (message?.op === 'subscribe') {
            subscriptions.set(message.topic, { type: message.type });
            if (CAMERA_TYPE.test(message.type || '')) cameraTopics.add(message.topic);
          }
          else if (message?.op === 'unsubscribe') {
            subscriptions.delete(message.topic);
            if (job?.envelope.topic === message.topic) stopWorker();
          }
          if (upstream.readyState === WebSocket.OPEN) {
            client.pause();
            upstream.send(data, { binary }, error => { if (error) cleanup(); else if (client.readyState === WebSocket.OPEN) client.resume(); });
          }
        });
        upstream.on('message', (data, binary) => {
          if (profile === 'mobile') {
            try {
              const message = binary ? decode(data) : JSON.parse(data.toString());
              const subscription = subscriptions.get(message.topic);
              if (message.op === 'publish' && cameraTopics.has(message.topic) && !subscription) return;
              if (message.op === 'publish' && CAMERA_TYPE.test(subscription?.type || '')) {
                prepare(message, binary, subscription); return;
              }
            } catch { /* Preserve non-ROS or unknown binary frames unchanged. */ }
          }
          send(data, binary);
        });
      });
    });
    upstream.once('unexpected-response', (_, response) => { response.resume(); failHandshake(); upstream.terminate(); });
  };
  return { upgrade, close() { sessions.forEach(cleanup => cleanup()); gateway.close(); } };
}
