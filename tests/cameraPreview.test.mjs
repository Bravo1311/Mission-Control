import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { WebSocketServer, WebSocket } from 'ws';
import { encode, decode } from 'cbor2';
import { cameraPreview } from '../scripts/cameraPreview.worker.mjs';
import { createLanServer } from '../scripts/serve-lan.mjs';

function rgbImage() {
  const data = new Uint8Array(1920 * 1080 * 3);
  for (let i = 0; i < data.length; i += 3) { data[i] = 225; data[i + 1] = 65; data[i + 2] = 20; }
  return { header: { frame_id: 'color_optical' }, width: 1920, height: 1080, step: 1920 * 3, encoding: 'rgb8', data };
}

test('host converts full-HD raw color to a small 640×360 JPEG with correct colors', async () => {
  const image = rgbImage();
  const preview = await cameraPreview(image);
  assert.equal(preview.format, 'jpeg');
  assert.equal(preview.preview.sourceWidth, 1920);
  assert.equal(preview.header.frame_id, 'color_optical');
  assert.equal(preview.encoding, undefined);
  assert.ok(preview.data.byteLength < image.data.byteLength / 20);
  const { data, info } = await sharp(preview.data).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 640); assert.equal(info.height, 360);
  assert.ok(data[0] > 200 && data[1] < 90 && data[2] < 40);
});

test('host sends depth as PNG using the same fixed grayscale display as the browser', async () => {
  const values = new Float32Array(640 * 480).fill(5);
  const preview = await cameraPreview({ header: { frame_id: 'depth_optical' }, width: 640, height: 480,
    step: 640 * 4, encoding: '32FC1', is_bigendian: false, data: new Uint8Array(values.buffer) });
  assert.equal(preview.format, 'png');
  assert.match(preview.preview.note, /Depth/);
  const { data, info } = await sharp(preview.data).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 480); assert.equal(info.height, 360);
  assert.equal(data[0], 128);
  assert.ok(preview.data.byteLength < 640 * 480);
});

test('host rejects unsupported or malformed frames before encoding', async () => {
  await assert.rejects(cameraPreview({ width: 2, height: 1, step: 6, encoding: 'rgb8', data: [] }), /Truncated/);
  await assert.rejects(cameraPreview({ format: 'compressedDepth', data: [] }), /compressedDepth/);
});

test('mobile preview proxy converts binary and JSON camera messages while keeping control messages off rosbridge', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mission-camera-proxy-'));
  await writeFile(join(root, 'index.html'), 'Mission Control');
  const bridge = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(bridge, 'listening');
  const operations = [];
  bridge.on('connection', socket => socket.on('message', raw => {
    const command = JSON.parse(raw.toString()); operations.push(command.op);
    if (command.op === 'subscribe') {
      const image = rgbImage();
      const envelope = { op: 'publish', id: command.id, topic: command.topic, msg: image };
      if (command.compression === 'cbor') socket.send(encode(envelope));
      else socket.send(JSON.stringify({ ...envelope, msg: { ...image, data: Buffer.from(image.data).toString('base64') } }));
    } else if (command.op === 'unsubscribe') {
      // Already-buffered bridge frames can arrive after a source is hidden.
      socket.send(encode({ op: 'publish', topic: command.topic, msg: rgbImage() }));
    }
  }));
  const server = createLanServer({ root, bridgeUrl: `ws://127.0.0.1:${bridge.address().port}` });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await server.shutdown(); bridge.clients.forEach(client => client.terminate()); bridge.close(); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = new WebSocket(origin.replace('http:', 'ws:') + '/rosbridge/preview', { origin });
  t.after(() => client.terminate());
  await once(client, 'open');
  client.send(JSON.stringify({ op: 'mission_control_preview', profile: 'mobile' }));
  for (const compression of ['cbor', 'none']) {
    const pending = once(client, 'message');
    client.send(JSON.stringify({ op: 'subscribe', topic: '/camera/image', type: 'sensor_msgs/msg/Image', compression, id: compression }));
    const [wire, binary] = await pending;
    assert.equal(binary, compression === 'cbor');
    assert.ok(wire.length < 100000);
    const envelope = binary ? decode(wire) : JSON.parse(wire.toString());
    assert.equal(envelope.msg.format, 'jpeg');
    assert.equal(envelope.id, compression);
    assert.equal(envelope.msg.preview.sourceWidth, 1920);
    const jpeg = binary ? envelope.msg.data : Buffer.from(envelope.msg.data, 'base64');
    assert.equal((await sharp(jpeg).metadata()).width, 640);
    let lateFrames = 0;
    const countLate = () => lateFrames++;
    client.on('message', countLate);
    client.send(JSON.stringify({ op: 'unsubscribe', topic: '/camera/image' }));
    await new Promise(resolve => setTimeout(resolve, 200));
    client.off('message', countLate);
    assert.equal(lateFrames, 0, 'Late full-resolution camera frames must not leak to the phone after unsubscribe');
  }
  assert.ok(!operations.includes('mission_control_preview'));
  client.close(); await once(client, 'close');
});
