// Optional real-browser smoke test: requires google-chrome on PATH.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { encode } from 'cbor2';
import { createLanServer } from '../scripts/serve-lan.mjs';

const profiling = process.argv.includes('--profile');
const PROFILE_DONE = Symbol('profile complete');
const development = process.argv.includes('--dev') || !!process.env.DASHBOARD_DEV;
const navigationOnly = process.argv.includes('--navigation-only') || !!process.env.DASHBOARD_NAV_ONLY;
const lan = process.argv.includes('--lan');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'mission-sensors-'));
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await new Promise(resolve => server.once('listening', resolve));
const raw = { header: { frame_id: 'camera_optical' }, width: 1280, height: 720, step: 3840, encoding: 'rgb8', data: Buffer.alloc(1280 * 720 * 3, 120).toString('base64') };
const scan = { header: { frame_id: 'laser' }, ranges: Array.from({ length: 3600 }, (_, i) => 10 + 3 * Math.sin(i / 100)), angle_min: -Math.PI, angle_increment: Math.PI * 2 / 3600, range_min: 0.1, range_max: 60 };
const cloudData = Buffer.alloc(200000 * 12);
for (let i = 0; i < 200000; i++) { cloudData.writeFloatLE(15 * Math.cos(i / 100), i * 12); cloudData.writeFloatLE(15 * Math.sin(i / 100), i * 12 + 4); cloudData.writeFloatLE(i % 10, i * 12 + 8); }
const cloud = { header: { frame_id: 'lidar' }, width: 200000, height: 1, point_step: 12, row_step: cloudData.length, fields: ['x', 'y', 'z'].map((name, i) => ({ name, datatype: 7, count: 1, offset: i * 4 })), data: cloudData.toString('base64') };
const fixtures = {
  '/camera/raw': ['sensor_msgs/msg/Image', raw],
  '/camera/compressed': ['sensor_msgs/msg/CompressedImage', null],
  '/scan': ['sensor_msgs/msg/LaserScan', scan],
  '/cloud': ['sensor_msgs/msg/PointCloud2', cloud],
  '/imu': ['sensor_msgs/msg/Imu', { linear_acceleration: { x: 0, y: 0, z: 9.81 }, angular_velocity: { x: 0.1, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }],
  '/battery': ['std_msgs/msg/Float32', { data: 24.8 }],
};
const odom = (x, y, speed, yaw) => ({ header: { frame_id: 'map' }, pose: { pose: { position: { x, y, z: 2 }, orientation: { x: 0.026, y: -0.012, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) } } }, twist: { twist: { linear: { x: speed, y: 0.1, z: 0.12 } } } });
fixtures['/drone_1/odometry'] = ['nav_msgs/msg/Odometry', odom(10, 10, 2.4, 1.3)];
fixtures['/drone_1/fusion/odom'] = ['nav_msgs/msg/Odometry', odom(10.25, 10.15, 2.48, 1.31)];
const groupedTracks = ['/drone_1/imu/odom', '/drone_1/gps/odom', '/drone_2/imu/odom', '/drone_2/gps/odom', '/drone_2/fusion/odom'];
for (const [i, name] of groupedTracks.entries()) fixtures[name] = ['nav_msgs/msg/Odometry', odom(10 + i, 10 + i, 2.4 + i*0.6, 0.5 + i*0.3)];
let navigationTimer;
const subscriptions = new Map();
const sockets = new Set();
const controlPackets = [];
let streaming = true;
server.on('connection', socket => {
  sockets.add(socket); const timers = new Map();
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (message.op === 'call_service') {
      const command = message.service.endsWith('/mission_test');
      if (command) controlPackets.push(message);
      socket.send(JSON.stringify({ op: 'service_response', service: message.service, id: message.id, result: true, values: command ? { success: true, message: 'Test vehicle ready' } : { topics: Object.keys(fixtures), types: Object.values(fixtures).map(f => f[0]) } }));
    }
    if (message.op === 'publish') controlPackets.push(message);
    if (message.op === 'subscribe') {
      subscriptions.set(message.topic, message);
      const publish = () => { if (streaming && fixtures[message.topic]?.[1] && socket.readyState === 1) socket.send(message.compression === 'cbor' ? encode({ op: 'publish', topic: message.topic, msg: { ...fixtures[message.topic][1], ...(typeof fixtures[message.topic][1].data === 'string' ? { data: new Uint8Array(Buffer.from(fixtures[message.topic][1].data, 'base64')) } : {}) } }) : JSON.stringify({ op: 'publish', topic: message.topic, msg: fixtures[message.topic][1] })); };
      clearInterval(timers.get(message.topic));
      timers.set(message.topic, setInterval(publish, Math.max(message.throttle_rate || 0, 50))); publish();
    }
    if (message.op === 'unsubscribe') { clearInterval(timers.get(message.topic)); timers.delete(message.topic); subscriptions.delete(message.topic); }
  });
  socket.on('close', () => { timers.forEach(clearInterval); sockets.delete(socket); });
});
const vite = lan ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(development ? [] : ['preview']), '--host', '127.0.0.1', '--port', '4189', '--strictPort'], { stdio: 'ignore' });
const lanServer = lan ? createLanServer({ bridgeUrl: `ws://127.0.0.1:${server.address().port}` }) : null;
if (lanServer) await new Promise((resolve, reject) => { lanServer.once('error', reject); lanServer.listen(4189, '127.0.0.1', resolve); });
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,1200', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
    chrome.stderr.on('data', chunk => { const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    chrome.on('error', reject);
  });
  socket = new WebSocket(endpoint);
  await new Promise(resolve => socket.once('open', resolve));
  let seq = 0; const pending = new Map(); const errors = [];
  socket.on('message', raw => { const message = JSON.parse(raw); if (message.id) { const job = pending.get(message.id); pending.delete(message.id); if (message.error) job.reject(message.error); else job.resolve(message.result); } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || '')); });
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => call(method, params, sessionId);
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.__drawCalls=0;for(const API of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){if(!API)continue;for(const name of ['drawArrays','drawElements']){const original=API.prototype[name];if(!original)continue;API.prototype[name]=function(...args){window.__drawCalls++;return original.apply(this,args);};}}window.__workers={alive:0,peak:0,busy:0,maxBusy:0,cameraFrames:0}; const NativeWorker=Worker; window.Worker=class extends NativeWorker { constructor(...args){super(...args);this.counted=true;window.__workers.alive++;window.__workers.peak=Math.max(window.__workers.peak,window.__workers.alive);this.pending=0;this.addEventListener('message',event=>{if(this.kind==='camera' && event.data.bitmap)window.__workers.cameraFrames++;this.pending--;window.__workers.busy--;});} postMessage(...args){this.kind=args[0].kind;this.pending++;window.__workers.busy++;window.__workers.maxBusy=Math.max(window.__workers.maxBusy,window.__workers.busy);return super.postMessage(...args);} terminate(){if(this.counted){window.__workers.alive--;window.__workers.busy-=this.pending;this.counted=false;}super.terminate();}}; window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});` });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, timeout = 20000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (errors.length) throw new Error(errors.join('\n')); if (await evaluate(`Boolean(${expression})`)) return; await delay(100); } throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`); };
  const capturePanel = async (selector, path) => {
    const clip = await evaluate(`(()=>{const boxes=[...document.querySelectorAll(${JSON.stringify(selector)})].map(node=>node.getBoundingClientRect());const left=Math.min(...boxes.map(box=>box.left)),top=Math.min(...boxes.map(box=>box.top));return {x:left+scrollX,y:top+scrollY,width:Math.max(...boxes.map(box=>box.right))-left,height:Math.max(...boxes.map(box=>box.bottom))-top,scale:1};})()`);
    const launcherVisibility = await evaluate(`document.querySelector('.chat-launcher')?.style.visibility || ''`);
    await evaluate(`(()=>{const launcher=document.querySelector('.chat-launcher');if(launcher)launcher.style.visibility='hidden';})()`);
    try {
      const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
      await writeFile(path, Buffer.from(shot.data, 'base64'));
    } finally {
      await evaluate(`(()=>{const launcher=document.querySelector('.chat-launcher');if(launcher)launcher.style.visibility=${JSON.stringify(launcherVisibility)};})()`);
    }
  };
  const untilBridge = async check => {
    const end = Date.now() + 5000;
    while (Date.now() < end) { if (check()) return; await delay(50); }
    throw new Error(`Bridge subscription timeout: ${JSON.stringify([...subscriptions].map(([name, sub]) => [name, sub.throttle_rate]))}`);
  };
  const assertTopicColors = async () => {
    const scroll = await evaluate('scrollY');
    await evaluate(`document.querySelector('.estimation-panel')?.scrollIntoView({block:'center'})`);
    await delay(350);
    const mismatches = await evaluate(`(()=>{
      const failures=[], ctx=document.createElement('canvas').getContext('2d');
      const normalize=color=>{ctx.fillStyle=color;return ctx.fillStyle;};
      const color=node=>normalize(getComputedStyle(node).color);
      for(const item of document.querySelectorAll('.trajectory-legend-item')){
        const name=item.dataset.topic, expected=color(item.querySelector('svg'));
        const card=[...document.querySelectorAll('.flight-source-row')].find(node=>node.dataset.topic===name);
        const trail=[...document.querySelectorAll('.topic-map-trail')].find(node=>node.dataset.topic===name);
        const marker=[...document.querySelectorAll('.drone-marker-icon')].find(node=>node.dataset.topic===name);
        const row=[...document.querySelectorAll('.topic-row')].find(node=>node.dataset.topic===name);
        if(!card||color(card.querySelector('.topic-swatch'))!==expected)failures.push(name+' flight');
        const needle=[...document.querySelectorAll('.flight-heading-track')].find(node=>node.dataset.topic===name);
        if(needle&&normalize(getComputedStyle(needle.querySelector('line')).stroke)!==expected)failures.push(name+' heading needle');
        if(!trail||normalize(getComputedStyle(trail).stroke)!==expected)failures.push(name+' map trail');
        if(trail&&getComputedStyle(trail).strokeDasharray!==getComputedStyle(item.querySelector('line')).strokeDasharray)failures.push(name+' map pattern');
        if(!marker||normalize(getComputedStyle(marker.querySelector('circle')).stroke)!==expected)failures.push(name+' map marker');
        if(row&&color(row.querySelector('.topic-swatch'))!==expected)failures.push(name+' topic list');
      }
      for(const label of document.querySelectorAll('.error-comparison label')){
        const name=label.querySelector('select').value;
        const item=[...document.querySelectorAll('.trajectory-legend-item')].find(node=>node.dataset.topic===name);
        if(!item||normalize(getComputedStyle(label).borderLeftColor)!==color(item.querySelector('svg')))failures.push(name+' comparison');
      }
      const plot=document.querySelector('.estimation-panel .js-plotly-plot');
      const estimate=document.querySelector('[aria-label="Estimate topic"]')?.value;
      const item=[...document.querySelectorAll('.trajectory-legend-item')].find(node=>node.dataset.topic===estimate);
      if(plot&&item&&normalize(plot.data[0].line.color)!==color(item.querySelector('svg')))failures.push('estimate chart');
      return failures;
    })()`);
    assert.deepEqual(mismatches, [], 'Topic identity must match across panels');
    await evaluate(`window.scrollTo(0,${scroll})`);
  };
  const assertVehicleLabels = async expected => {
    await until(`document.querySelectorAll('.trajectory-stage .vehicle-floating-tag').length===${expected} && document.querySelectorAll('.map-stage .vehicle-floating-tag').length===${expected}`);
    const labels = await evaluate(`(()=>{
      const result=[];
      for(const stage of document.querySelectorAll('.trajectory-stage,.map-stage')){
        const bounds=stage.getBoundingClientRect(), tags=[...stage.querySelectorAll('.vehicle-floating-tag')];
        const boxes=tags.map(tag=>tag.getBoundingClientRect());
        result.push({inside:boxes.every(box=>box.left>=bounds.left-1&&box.right<=bounds.right+1&&box.top>=bounds.top-1&&box.bottom<=bounds.bottom+1),
          overlap:boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom)),
          groups:tags.map(tag=>tag.dataset.vehicle), topics:tags.map(tag=>tag.dataset.topic)});
      }
      return result;
    })()`);
    for (const stage of labels) {
      assert.equal(stage.inside, true, 'Floating drone labels must remain within their panel');
      assert.equal(stage.overlap, false, 'Two nearby drone labels must remain separate');
      assert.deepEqual(stage.groups, expected === 2 ? ['drone_1', 'drone_2'] : ['drone_1']);
      assert.ok(stage.topics.includes('/drone_1/fusion/odom'), 'The floating tag should identify its fusion anchor');
    }
  };
  const assertFlightOverlays = async count => {
    await until(`document.querySelectorAll('.flight-source-row').length===${count} && document.querySelectorAll('.flight-heading-track').length===${count} && document.querySelectorAll('.flight-attitude-track').length===${count} && document.querySelectorAll('.flight-speed-marker').length===${count*2}`);
    assert.equal(await evaluate(`document.querySelectorAll('.flight-state-panel select').length`), 0, 'All topics must be visible without source switching');
    const panels = await evaluate(`[...document.querySelectorAll('.flight-state-panel')].map(panel=>({vehicle:panel.dataset.vehicle,groups:[...new Set([...panel.querySelectorAll('.flight-source-row')].map(row=>row.dataset.vehicle))],rows:[...panel.querySelectorAll('.flight-source-row')].map(row=>row.dataset.topic).sort(),heading:[...panel.querySelectorAll('.flight-heading-track')].map(node=>node.dataset.topic).sort(),attitude:[...panel.querySelectorAll('.flight-attitude-track')].map(node=>node.dataset.topic).sort(),headingDials:new Set([...panel.querySelectorAll('.flight-heading-track')].map(node=>node.closest('svg'))).size,attitudeDials:new Set([...panel.querySelectorAll('.flight-attitude-track')].map(node=>node.closest('svg'))).size}))`);
    assert.equal(new Set(panels.map(panel=>panel.vehicle)).size, panels.length, 'One independent panel per drone');
    for (const panel of panels) {
      assert.deepEqual(panel.groups, [panel.vehicle], 'A state panel must never contain another drone topics');
      assert.deepEqual(panel.heading, panel.rows);
      assert.deepEqual(panel.attitude, panel.rows);
      assert.equal(panel.headingDials, 1, 'Each drone sources share its heading dial');
      assert.equal(panel.attitudeDials, 1, 'Each drone sources share its attitude dial');
    }
    const rows = await evaluate(`[...document.querySelectorAll('.flight-source-row')].map(row=>row.dataset.topic).sort()`);
    for (const selector of ['.flight-heading-track', '.flight-attitude-track', '.flight-speed-marker[data-metric="ground"]', '.flight-speed-marker[data-metric="vertical"]']) {
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('${selector}')].map(node=>node.dataset.topic).sort()`), rows);
    }
  };
  for (let i = 0; i < 50; i++) { try { if ((await fetch('http://127.0.0.1:4189')).ok) break; } catch {} await delay(100); }
  await cdp('Page.navigate', { url: 'http://127.0.0.1:4189' });
  await until(`document.querySelector('.header-actions .btn-primary')`);
  assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#ff4d0a', 'Preserve the orange interface theme');
  // The terminal works without a backend and keeps notes across page reloads.
  await evaluate(`document.querySelector('.chat-launcher').click()`);
  await until(`document.activeElement?.id==='agent-message'`);
  const localNote = '<img src=x onerror="window.__chatMarkupExecuted=true"> Local mission note';
  await evaluate(`(()=>{const input=document.querySelector('#agent-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(localNote)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`document.querySelector('.chat-composer').requestSubmit()`);
  await until(`document.querySelectorAll('.chat-message').length===1`);
  assert.equal(await evaluate(`document.querySelector('.chat-message p').textContent`), localNote);
  assert.equal(await evaluate(`!!document.querySelector('.chat-message img') || !!window.__chatMarkupExecuted`), false);
  assert.equal(await evaluate(`document.querySelector('.chat-message header').textContent.includes('Local only')`), true);
  await evaluate(`window.__terminalBeforeReload=true`);
  await cdp('Page.reload');
  await until(`!window.__terminalBeforeReload && document.querySelector('.chat-launcher')`);
  await evaluate(`document.querySelector('.chat-launcher').click()`);
  await until(`document.querySelectorAll('.chat-message').length===1`);
  assert.equal(await evaluate(`document.querySelector('.chat-message p').textContent`), localNote);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(200);
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('.agent-terminal').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight})()`), true, 'Terminal should fit the mobile viewport');
  const terminal = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-terminal-mobile.png', Buffer.from(terminal.data, 'base64'));
  await evaluate(`document.querySelector('.chat-toolbar button').click()`);
  await until(`document.querySelector('.chat-empty') && !document.querySelector('.chat-message')`);
  await evaluate(`document.querySelector('#agent-message').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(`!document.querySelector('.agent-terminal') && document.activeElement===document.querySelector('.chat-launcher')`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  fixtures['/camera/compressed'][1] = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');x.fillStyle='#a9bdca';x.fillRect(0,0,320,90);x.fillStyle='#758185';x.fillRect(0,90,320,90);x.fillStyle='#c9ced0';for(let i=0;i<5;i++){x.beginPath();x.moveTo(30+i*60,120);x.lineTo(10+i*60,170);x.lineTo(90+i*60,170);x.lineTo(85+i*60,120);x.closePath();x.fill();}return {format:'png',header:{frame_id:'compressed_optical'},data:c.toDataURL('image/png').split(',')[1]}})()`);
  await evaluate(`document.querySelector('.header-actions .btn-primary').click()`);
  await until(`document.querySelector('[aria-label="Rosbridge WebSocket address"]')`);
  await evaluate(`(()=>{const s=document.querySelector('#performance-mode');s.value='mobile';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`localStorage.getItem('mission-control.performance.v1')==='mobile'`);
  await evaluate(`window.__performanceBeforeReload=true`);
  await cdp('Page.reload');
  await until(`!window.__performanceBeforeReload && document.querySelector('.header-actions .btn-primary')`);
  await evaluate(`document.querySelector('.header-actions .btn-primary').click()`);
  await until(`document.querySelector('#performance-mode')?.value==='mobile'`);
  await evaluate(`(()=>{const s=document.querySelector('#performance-mode');s.value='auto';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.querySelector('.performance-description').textContent.includes('1280')`);
  if (lan) assert.equal(await evaluate(`document.querySelector('[aria-label="Rosbridge WebSocket address"]').value`), 'ws://127.0.0.1:4189/rosbridge/preview');
  else await evaluate(`(()=>{const input=document.querySelector('[aria-label="Rosbridge WebSocket address"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'ws://127.0.0.1:${server.address().port}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Connect').click()`);
  await until(`document.querySelectorAll('.topic-row').length===${Object.keys(fixtures).length}`);
  let stats = {};
  if (!navigationOnly) {
  await evaluate(`[...document.querySelectorAll('.topic-row input[type=checkbox]')].filter(input=>!input.getAttribute('aria-label').includes('/drone_')).forEach(input=>input.click())`);
  await evaluate(`document.querySelector('.offcanvas .btn-close').click()`);
  await until(`document.querySelectorAll('.sensor-canvas').length===2`);
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="camera source"]');s.value='/camera/raw';s.dispatchEvent(new Event('change',{bubbles:true}));const l=document.querySelector('[aria-label="lidar source"]');l.value='/scan';l.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.body.innerText.includes('1280 × 720') && document.body.innerText.includes('3,600 input points')`);
  const rawBefore = await evaluate('window.__workers.cameraFrames');
  await delay(3000);
  const rawFps = (await evaluate('window.__workers.cameraFrames') - rawBefore) / 3;
  assert.ok(rawFps >= 12, `720p raw camera throughput too low: ${rawFps} FPS`);
  assert.equal(subscriptions.get('/camera/raw').throttle_rate, 50);
  assert.equal(subscriptions.get('/cloud').throttle_rate, 1000);
  assert.equal(subscriptions.get('/camera/raw').compression, 'cbor');
  for (const sub of subscriptions.values()) assert.equal(sub.queue_length, 1);
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="camera source"]');s.value='/camera/compressed';s.dispatchEvent(new Event('change',{bubbles:true}));const l=document.querySelector('[aria-label="lidar source"]');l.value='/cloud';l.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.body.innerText.includes('320 × 180') && document.body.innerText.includes('200,000 input points')`);
  await evaluate(`document.querySelector('[aria-label="Hide Camera feed panel"]').click()`);
  await until(`!document.querySelector('[aria-label="camera source"]') && window.__workers.alive===1`);
  await untilBridge(() => subscriptions.get('/camera/compressed')?.throttle_rate === 1000);
  assert.equal(await evaluate(`document.querySelector('.count-badge').textContent`), '6', 'Hiding camera must retain selected topics');
  await evaluate(`document.querySelector('[aria-label="Restore Camera feed panel"]').click()`);
  await until(`document.querySelector('[aria-label="camera source"]')?.value==='/camera/compressed' && window.__workers.alive===2`);
  await evaluate(`document.querySelector('.sensor-panel').scrollIntoView({block:'start'});document.querySelector('.hidden-panels-toggle').click()`);
  await until(`document.body.innerText.includes('320 × 180')`);
  assert.equal(await evaluate(`performance.getEntriesByType('resource').some(r=>r.name.includes('plotlyView'))`), false);
  assert.equal(await evaluate(`getComputedStyle(document.body).color`), 'rgb(233, 237, 241)');
  await cdp('HeapProfiler.collectGarbage');
  const heapBefore = (await cdp('Runtime.getHeapUsage')).usedSize;
  const framesBefore = await evaluate('window.__workers.cameraFrames');
  assert.equal(subscriptions.get('/cloud').throttle_rate, 500);
  assert.equal(subscriptions.get('/camera/raw').throttle_rate, 1000);
  await evaluate('window.__longTasks=[]');
  await delay(20000);
  stats = await evaluate('({workers:window.__workers,longTasks:window.__longTasks})');
  await cdp('HeapProfiler.collectGarbage');
  stats.rawCameraFps = rawFps;
  stats.heapBefore = heapBefore;
  stats.heapAfter = (await cdp('Runtime.getHeapUsage')).usedSize;
  stats.cameraFps = (stats.workers.cameraFrames - framesBefore) / 20;
  assert.ok(stats.cameraFps >= 12, `Camera throughput too low: ${stats.cameraFps} FPS`);
  assert.ok(stats.heapAfter < heapBefore + 16 * 1024 * 1024, 'Main-thread retained heap should remain bounded');
  assert.ok(stats.workers.alive <= 2); assert.ok(stats.workers.maxBusy <= 2);
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-sensor-preview.png', Buffer.from(shot.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1900, height: 940, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  assert.equal(await evaluate(`[...document.querySelectorAll('.sensor-panel')].every(p=>p.getBoundingClientRect().bottom <= window.innerHeight)`), true, 'Sensor panels should fit desktop viewport');
  assert.equal(await evaluate(`localStorage.getItem('mission-control.grid-layout.v3')`), null, 'Automatic compaction must not save a custom layout');
  const desktop = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-workspace-desktop.png', Buffer.from(desktop.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(500);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Mobile layout must not overflow horizontally');
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="camera source"]');s.value='/camera/raw';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.sensor-panel').scrollIntoView({block:'start'});})()`);
  await until(`document.querySelector('.sensor-canvas')?.width===640 && document.querySelector('.sensor-canvas')?.height===360`);
  await untilBridge(() => lan ? subscriptions.get('/camera/raw')?.throttle_rate === 100 : subscriptions.get('/camera/raw')?.throttle_rate >= 1300);
  await evaluate(`document.querySelectorAll('.sensor-panel')[1].scrollIntoView({block:'start'})`);
  await until(`document.querySelectorAll('.sensor-canvas')[1]?.width===480`);
  await untilBridge(() => !subscriptions.has('/camera/raw'));
  assert.equal(subscriptions.has('/camera/raw'), false, 'Off-screen camera should stop transport in Mobile mode');
  assert.ok(await evaluate(`parseInt(document.querySelectorAll('.sensor-format')[1].textContent.replaceAll(',',''))<=3000`));
  await evaluate(`(()=>{const s=document.querySelector('[aria-label="camera source"]');s.value='/camera/compressed';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.sensor-panel').scrollIntoView({block:'start'});})()`);
  await until(`document.querySelector('.sensor-canvas')?.width===320`);
  await untilBridge(() => subscriptions.get('/camera/compressed')?.throttle_rate === 100);
  const mobile = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-workspace-mobile.png', Buffer.from(mobile.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await delay(500);
  fixtures['/camera/compressed'][1] = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#ff4d0a';ctx.fillRect(0,0,320,240);return {format:'jpeg',data:c.toDataURL('image/jpeg').split(',')[1]}})()`);
  await until(`document.body.innerText.includes('320 × 240 · jpeg')`);
  fixtures['/cloud'][1] = {...cloud, data: ''};
  await until(`document.body.innerText.includes('Truncated point cloud')`);
  fixtures['/cloud'][1] = cloud;
  await until(`!document.querySelector('.sensor-message') && document.body.innerText.includes('200,000 input points')`);
  const cameraRateBeforeNight = subscriptions.get('/camera/compressed').throttle_rate;
  await evaluate(`document.querySelector('.night-toggle').click()`);
  await until(`document.documentElement.dataset.night==='on' && document.querySelector('.sensor-panel').dataset.nightState==='active'`);
  assert.equal(subscriptions.get('/camera/compressed').throttle_rate, cameraRateBeforeNight, 'Night lighting must not change sensor transport');
  const litFrames = await evaluate('window.__workers.cameraFrames');
  await until(`window.__workers.cameraFrames>${litFrames}`);
  await evaluate(`document.querySelector('.sensor-settings summary').click()`);
  await evaluate(`(()=>{const slider=document.querySelector('[aria-label="Night camera brightness"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'45');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`getComputedStyle(document.querySelector('.sensor-canvas')).opacity==='0.45'`);
  await evaluate(`document.querySelector('.sensor-settings summary').click()`);
  await evaluate(`document.querySelector('.focus-toggle').click()`);
  await until(`document.querySelector('.sensor-panel').dataset.nightState==='standby' && document.querySelector('.sensor-panel .panel-body').inert`);
  await untilBridge(() => subscriptions.get('/camera/compressed')?.throttle_rate === 1000 && subscriptions.get('/cloud')?.throttle_rate === 1000);
  const nightFrames = await evaluate('window.__workers.cameraFrames');
  await delay(300);
  assert.equal(await evaluate('window.__workers.cameraFrames'), nightFrames, 'Focus blanking should suspend camera decoding');
  await evaluate(`document.querySelector('[aria-label="Show Camera feed in Focus mode"]').click()`);
  await until(`document.querySelector('.sensor-panel').dataset.nightState==='revealed'`);
  await evaluate(`document.querySelector('.sensor-panel').scrollIntoView({block:'start'})`);
  await until(`window.__workers.cameraFrames>${nightFrames}`);
  await evaluate(`document.querySelector('[aria-label="Blank Camera feed in Focus mode"]').click()`);
  await until(`document.querySelector('.sensor-panel').dataset.nightState==='standby'`);
  await evaluate(`document.querySelector('.focus-toggle').click();document.querySelector('.night-toggle').click()`);
  await until(`document.documentElement.dataset.night==='off' && document.documentElement.dataset.focus==='off' && document.querySelector('.sensor-panel').dataset.nightState==='active'`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.sensor-canvas')).opacity`), '1', 'Camera dimming must not affect day mode');
  await evaluate(`[...document.querySelectorAll('.panel button')].find(b=>b.textContent==='Pause').click()`);
  await until(`document.body.innerText.includes('Display paused')`);
  assert.equal(await evaluate('window.__workers.alive'), 1);
  await evaluate(`[...document.querySelectorAll('.panel button')].find(b=>b.textContent==='Resume').click()`);
  await until(`window.__workers.alive===2`);
  streaming = false; await delay(500);
  await evaluate(`[...document.querySelectorAll('.header-actions button')].find(b=>b.textContent.trim()==='Clear').click()`);
  await until(`[...document.querySelectorAll('.sensor-caption')].every(c=>c.textContent.includes('Waiting for a frame'))`);
  await evaluate(`document.querySelector('.header-actions .btn-primary').click()`);
  await until(`document.querySelectorAll('.topic-row input:checked').length===6`);
  await evaluate(`[...document.querySelectorAll('.topic-row input:checked')].forEach(input=>input.click())`);
  await until(`window.__workers.alive===0 && document.querySelectorAll('.sensor-canvas').length===0`);
  assert.equal(subscriptions.size, 0);
  }
  streaming = true;
  const navigationStart = Date.now();
  navigationTimer = setInterval(() => {
    const t = (Date.now() - navigationStart) / 1200;
    const reference = fixtures['/drone_1/odometry'][1].pose.pose.position;
    Object.assign(reference, { x: 10 + 8 * Math.cos(t), y: 10 + 5 * Math.sin(t), z: 2 + 0.5 * Math.sin(t * 2) });
    const estimate = fixtures['/drone_1/fusion/odom'][1].pose.pose.position;
    Object.assign(estimate, { x: reference.x + 0.25 + 0.08 * Math.sin(t * 2), y: reference.y + 0.15, z: reference.z + 0.12 });
    for (const [i, name] of groupedTracks.entries()) Object.assign(fixtures[name][1].pose.pose.position, { x: reference.x + (i >= 2 ? 4 : 0) + i * 0.15, y: reference.y + (i >= 2 ? 4 : 0) + i * 0.12, z: reference.z + i * 0.15 });
  }, 50);
  await evaluate(`document.querySelector('input[aria-label="Toggle /drone_1/fusion/odom"]').click()`);
  await until(`document.querySelectorAll('.flight-source-row').length===1`);
  await evaluate(`document.querySelector('input[aria-label="Toggle /drone_1/odometry"]').click()`);
  await evaluate(`document.querySelector('.offcanvas .btn-close').click()`);
  await evaluate(`document.querySelector('.estimation-panel').scrollIntoView({block:'start'})`);
  await until(`document.querySelector('.estimation-panel .js-plotly-plot')`);
  await assertFlightOverlays(2);
  await until(`document.querySelector('.flight-source-row[data-topic="/drone_1/odometry"] [data-metric="ground"]').textContent==='2.40'`);
  // Show the user's exact case: two independent readings inside the same
  // attitude and heading SVGs, with different simulated values for clarity.
  const rawOdom = fixtures['/drone_1/odometry'][1], fusedOdom = fixtures['/drone_1/fusion/odom'][1];
  const savedDual = [rawOdom, fusedOdom].map(msg => ({ orientation: msg.pose.pose.orientation, linear: msg.twist.twist.linear }));
  const quaternion = (roll, pitch, yaw) => {
    const [r, p, y] = [roll, pitch, yaw].map(value=>value*Math.PI/360);
    return { x:Math.sin(r)*Math.cos(p)*Math.cos(y)-Math.cos(r)*Math.sin(p)*Math.sin(y),
      y:Math.cos(r)*Math.sin(p)*Math.cos(y)+Math.sin(r)*Math.cos(p)*Math.sin(y),
      z:Math.cos(r)*Math.cos(p)*Math.sin(y)-Math.sin(r)*Math.sin(p)*Math.cos(y),
      w:Math.cos(r)*Math.cos(p)*Math.cos(y)+Math.sin(r)*Math.sin(p)*Math.sin(y) };
  };
  rawOdom.pose.pose.orientation = quaternion(10, -6, 60);
  fusedOdom.pose.pose.orientation = quaternion(4, 2, 75);
  rawOdom.twist.twist.linear = { x:3, y:0, z:0.4 };
  fusedOdom.twist.twist.linear = { x:4, y:0, z:0.1 };
  await until(`document.querySelector('.flight-source-row[data-topic="/drone_1/odometry"] [data-metric="roll"]').textContent==='10.0' && document.querySelector('.flight-source-row[data-topic="/drone_1/fusion/odom"] [data-metric="roll"]').textContent==='4.0'`);
  await assertFlightOverlays(2);
  const dual = await evaluate(`(()=>{const panel=document.querySelector('.flight-state-panel[data-vehicle="drone_1"]');const a=[...panel.querySelectorAll('.flight-attitude-track')],h=[...panel.querySelectorAll('.flight-heading-track')];return {attitude:a.length===2&&a[0].closest('svg')===a[1].closest('svg'),heading:h.length===2&&h[0].closest('svg')===h[1].closest('svg'),patterns:h.map(node=>node.querySelector('line').getAttribute('stroke-dasharray'))};})()`);
  assert.equal(dual.attitude, true); assert.equal(dual.heading, true);
  assert.notEqual(dual.patterns[0], dual.patterns[1], 'Odometry and fusion must have distinguishable traces');
  await capturePanel('.flight-state-panel[data-vehicle="drone_1"]', '/tmp/mission-drone-1-dual-odom-overlay.png');
  [rawOdom, fusedOdom].forEach((msg, index) => { msg.pose.pose.orientation=savedDual[index].orientation;msg.twist.twist.linear=savedDual[index].linear; });
  await until(`document.querySelector('.flight-source-row[data-topic="/drone_1/odometry"] [data-metric="ground"]').textContent==='2.40'`);
  await evaluate(`document.querySelector('[aria-label="Highlight /drone_1/odometry"]').click()`);
  await until(`document.querySelector('[aria-label="Highlight /drone_1/odometry"]').getAttribute('aria-pressed')==='true'`);
  await assertFlightOverlays(2);
  await evaluate(`document.querySelector('[aria-label="Hide Flight state · drone_1 panel"]').click()`);
  await until(`!document.querySelector('.flight-state-panel') && document.querySelector('.hidden-panels-toggle').getAttribute('aria-expanded')==='true'`);
  await evaluate(`document.querySelector('[aria-label="Restore Flight state · drone_1 panel"]').click()`);
  await until(`document.querySelector('[aria-label="Highlight /drone_1/odometry"]')?.getAttribute('aria-pressed')==='true'`);
  await evaluate(`document.querySelector('[aria-label="Highlight /drone_1/odometry"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('.hidden-panels-toggle').click()`);
  await delay(1800);
  await evaluate(`document.querySelector('.trajectory-panel').scrollIntoView({block:'start'});[...document.querySelectorAll('.trajectory-panel button')].find(button=>button.textContent==='Fit tracks').click()`);
  await delay(300);
  assert.equal(await evaluate(`!document.querySelector('.trajectory-origin').hidden`), true, '3D origin must be visible after fitting');
  await assertVehicleLabels(1);
  const viewer3d = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-trajectory-3d.png', Buffer.from(viewer3d.data, 'base64'));
  await evaluate(`[...document.querySelectorAll('.trajectory-panel button')].find(button=>button.textContent==='2D').click()`);
  await until(`document.querySelector('.trajectory-projection')?.textContent==='Top-down XY' && document.querySelector('[aria-label="Top-down XY position tracks"]')`);
  await delay(300);
  assert.equal(await evaluate(`!document.querySelector('.trajectory-origin').hidden`), true, '2D origin must be visible after fitting');
  const viewer2d = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-trajectory-2d.png', Buffer.from(viewer2d.data, 'base64'));
  assert.equal(await evaluate(`document.querySelectorAll('.trajectory-canvas canvas').length`), 1);
  await evaluate(`document.querySelector('[aria-label="Hide Trajectory panel"]').click()`);
  await until(`!document.querySelector('.trajectory-panel')`);
  await evaluate(`document.querySelector('[aria-label="Restore Trajectory panel"]').click()`);
  await until(`document.querySelector('[aria-label="Top-down XY position tracks"]')`);
  await evaluate(`document.querySelector('.hidden-panels-toggle').click()`);
  await evaluate(`document.querySelector('.header-actions .btn-primary').click()`);
  for (const name of groupedTracks) await evaluate(`document.querySelector('input[aria-label="Toggle ${name}"]').click()`);
  await evaluate(`document.querySelector('.offcanvas .btn-close').click()`);
  await until(`document.querySelectorAll('.trajectory-legend-group').length===2 && document.querySelectorAll('.trajectory-legend-item').length===7`);
  await until(`document.querySelectorAll('.topic-map-trail').length===7`);
  await assertFlightOverlays(7);
  assert.equal(await evaluate(`document.querySelectorAll('.flight-state-panel').length`), 2);
  assert.equal(await evaluate(`document.querySelectorAll('.flight-state-panel[data-vehicle="drone_1"] .flight-source-row').length`), 4);
  assert.equal(await evaluate(`document.querySelectorAll('.flight-state-panel[data-vehicle="drone_2"] .flight-source-row').length`), 3);
  await evaluate(`document.querySelector('[aria-label="Highlight /drone_1/gps/odom"]').click()`);
  await until(`document.querySelector('[aria-label="Highlight /drone_1/gps/odom"]').getAttribute('aria-pressed')==='true'`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.flight-state-panel[data-vehicle="drone_2"] .flight-heading-track')].every(node=>node.getAttribute('opacity')==='1')`), true, 'Highlighting drone 1 must not dim drone 2');
  await evaluate(`document.querySelector('[aria-label="Hide Flight state · drone_1 panel"]').click()`);
  await until(`!document.querySelector('.flight-state-panel[data-vehicle="drone_1"]') && document.querySelector('.flight-state-panel[data-vehicle="drone_2"]')`);
  await assertFlightOverlays(3);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('mission-control.hidden-panels.v1')).includes('attitude:drone_1')`), true);
  await evaluate(`document.querySelector('[aria-label="Restore Flight state · drone_1 panel"]').click()`);
  await assertFlightOverlays(7);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Highlight /drone_1/gps/odom"]').getAttribute('aria-pressed')`), 'true');
  await evaluate(`document.querySelector('[aria-label="Highlight /drone_1/gps/odom"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('.hidden-panels-toggle').click()`);
  const originalGps = fixtures['/drone_1/gps/odom'][1];
  fixtures['/drone_1/gps/odom'][1] = { header: { frame_id: 'map' }, pose: { pose: { position: { x: 10, y: 10, z: 2 } } } };
  await until(`document.querySelectorAll('.flight-heading-track').length===6 && document.querySelectorAll('.flight-source-row').length===7`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.flight-source-row[data-topic="/drone_1/gps/odom"] td[data-metric]')].every(cell=>cell.textContent==='—')`), true, 'Missing fields must not borrow another topic values');
  fixtures['/drone_1/gps/odom'][1] = { ...originalGps, twist: { twist: { linear: { x: 83, y: 0, z: -12 } } } };
  await until(`document.querySelector('.flight-source-row[data-topic="/drone_1/gps/odom"] [data-metric="ground"]').textContent==='83.00'`);
  assert.equal(await evaluate(`document.querySelector('.flight-overlay-speed svg').getAttribute('aria-label').includes('0 to 100')`), true, 'All speeds must fit one shared scale');
  assert.equal(await evaluate(`document.querySelector('.flight-state-panel[data-vehicle="drone_2"] .flight-overlay-speed svg').getAttribute('aria-label').includes('0 to 20')`), true, 'Drone 2 must retain its own speed range');
  fixtures['/drone_1/gps/odom'][1] = originalGps;
  await assertFlightOverlays(7);
  await until(`document.querySelector('.flight-source-row[data-topic="/drone_1/gps/odom"] [data-metric="ground"]').textContent!=='83.00'`);
  await capturePanel('.flight-state-panel', '/tmp/mission-flight-overlay-desktop.png');
  await assertTopicColors();
  await assertVehicleLabels(2);
  if (profiling) {
    await cdp('Performance.enable');
    await cdp('Profiler.enable');
    const measurements = [];
    for (const mode of ['day', 'night']) {
      if (mode === 'night') await evaluate(`document.querySelector('.night-toggle').click()`);
      for (const view of ['trajectory-panel', 'flight-state-panel', 'estimation-panel']) {
        await evaluate(`document.querySelector('.${view}').scrollIntoView({block:'start'})`);
        await delay(700);
        const before = Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
        await cdp('Profiler.start');
        const frames = await evaluate(`new Promise(resolve=>{const gaps=[];let last=performance.now(),start=last;function tick(now){gaps.push(now-last);last=now;if(now-start<4000)requestAnimationFrame(tick);else{gaps.sort((a,b)=>a-b);resolve({fps:gaps.length*1000/(now-start),p95:gaps[Math.floor(gaps.length*.95)],max:gaps.at(-1)});}}requestAnimationFrame(tick);})`);
        const { profile } = await cdp('Profiler.stop');
        const after = Object.fromEntries((await cdp('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
        const nodes = new Map(profile.nodes.map(node=>[node.id,node]));
        const hits = new Map();
        for (const id of profile.samples || []) { const node=nodes.get(id),name=node.callFrame.functionName||node.callFrame.url.split('/').at(-1)||'(anonymous)';hits.set(name,(hits.get(name)||0)+1); }
        measurements.push({mode,view,mainThreadMs:Math.round((after.TaskDuration-before.TaskDuration)*1000),scriptMs:Math.round((after.ScriptDuration-before.ScriptDuration)*1000),layoutMs:Math.round((after.LayoutDuration-before.LayoutDuration)*1000),layouts:after.LayoutCount-before.LayoutCount,frames,top:[...hits].sort((a,b)=>b[1]-a[1]).slice(0,12)});
      }
    }
    const report={measurements};
    await writeFile(process.env.PROFILE_OUTPUT || '/tmp/mission-performance.json', JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    throw PROFILE_DONE;
  }

  // Night is illumination only. Focus independently controls saved blanking.
  await evaluate(`[...document.querySelectorAll('.header-actions button')].find(button=>button.textContent.trim()==='Clear').click()`);
  await delay(350);
  await assertFlightOverlays(7);
  await until(`!document.querySelector('.estimation-panel').hasAttribute('data-alert')`);
  await evaluate(`window.scrollTo(0,0)`);
  assert.equal(await evaluate(`!document.querySelector('.mission-overview') && !document.querySelector('.grid-toolbar') && document.querySelector('.trajectory-panel').getBoundingClientRect().top<150`), true, 'The workspace should start with data, without redundant headings and counters');
  await evaluate(`document.querySelector('.estimation-panel').scrollIntoView({block:'start'})`);
  await until(`document.querySelector('.estimation-panel .js-plotly-plot')`);
  await evaluate(`window.scrollTo(0,0)`);
  const compactOverview = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-compact-workspace-desktop.png', Buffer.from(compactOverview.data, 'base64'));
  await delay(350);
  await evaluate(`window.__offscreenPlotData=document.querySelector('.estimation-panel .js-plotly-plot').data`);
  await delay(650);
  assert.equal(await evaluate(`document.querySelector('.estimation-panel .js-plotly-plot').data===window.__offscreenPlotData`), true, 'Off-screen charts must freeze while telemetry and alerts keep running');
  await evaluate(`delete window.__offscreenPlotData`);
  const dayLayout = await evaluate(`[...document.querySelectorAll('.grid-cell')].map(node=>[node.dataset.panelId,node.style.transform,node.style.width,node.style.height])`);
  const daySavedLayout = await evaluate(`localStorage.getItem('mission-control.grid-layout.v3')`);
  await evaluate(`document.querySelector('.night-toggle').click()`);
  await until(`document.documentElement.dataset.night==='on' && [...document.querySelectorAll('.panel')].every(panel=>panel.dataset.nightState==='active' && !panel.querySelector('.panel-body').inert)`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.grid-cell')].map(node=>[node.dataset.panelId,node.style.transform,node.style.width,node.style.height])`), dayLayout, 'Night lighting must preserve the full dashboard layout');
  await assertTopicColors();
  await evaluate(`window.scrollTo(0,0)`);
  await capturePanel('.flight-state-panel', '/tmp/mission-night-instruments-desktop.png');
  const nightOverview = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-night-workspace-desktop.png', Buffer.from(nightOverview.data, 'base64'));
  await evaluate(`(()=>{const slider=document.querySelector('[aria-label="Night brightness"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'60');slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`document.documentElement.style.getPropertyValue('--night-brightness')==='0.6' && localStorage.getItem('mission-control.night-brightness.v1')==='60'`);
  streaming = false;
  await until(`document.querySelector('.flight-state-panel .data-status summary').textContent.includes('stale')`, 8000);
  streaming = true;
  await until(`document.querySelector('.flight-state-panel .data-status summary').textContent.includes('live')`);
  await evaluate(`document.querySelector('.focus-toggle').click()`);
  await until(`document.querySelector('[data-panel-id="gps"] .panel').dataset.nightState==='standby' && document.querySelector('[data-panel-id="gps"] .panel-body').inert`);
  await evaluate(`document.querySelector('[aria-label="Show Navigation map in Focus mode"]').click()`);
  await until(`document.querySelector('[data-panel-id="gps"] .panel').dataset.nightState==='revealed'`);
  await evaluate(`document.querySelector('.flight-state-panel .night-panel-toggle').click()`);
  await until(`document.querySelector('.flight-state-panel[data-vehicle="drone_1"]').dataset.nightState==='standby'`);
  // Automatic alerts are disabled: high errors must not pop up or wake panels.
  await evaluate(`document.querySelector('[data-panel-id="error"] .panel-hide').click()`);
  await until(`!document.querySelector('.estimation-panel')`);
  const normalFusionOrientation = fixtures['/drone_1/fusion/odom'][1].pose.pose.orientation;
  fixtures['/drone_1/fusion/odom'][1].pose.pose.orientation = quaternion(0,0,180);
  await delay(500);
  assert.equal(await evaluate(`!document.querySelector('.workspace-alerts') && !document.querySelector('.estimation-panel')`), true, 'Errors must not pop up hidden panels or alert banners');
  await evaluate(`document.querySelector('[aria-label="Restore Estimation error panel"]').click()`);
  await until(`document.querySelector('.estimation-panel')?.dataset.nightState==='standby'`);
  assert.equal(await evaluate(`document.querySelector('.estimation-panel').hasAttribute('data-alert')`), false);
  await evaluate(`document.querySelector('[aria-label="Show Estimation error in Focus mode"]').click()`);
  await until(`document.querySelector('.estimation-panel').dataset.nightState==='revealed' && document.querySelector('.estimation-panel').clientHeight>200`);
  await evaluate(`document.querySelector('.estimation-panel').scrollIntoView({block:'start'});[...document.querySelectorAll('.estimation-panel [role="tab"]')].find(button=>button.textContent==='Orientation').click()`);
  await until(`document.querySelector('.estimation-panel .js-plotly-plot') && document.querySelector('.estimation-panel .stat-danger')`);
  assert.equal(await evaluate(`!document.querySelector('.workspace-alerts') && !document.querySelector('.night-alert-label')`), true, 'Manual inspection retains inline error bands without automatic alerts');
  await capturePanel('.estimation-panel', '/tmp/mission-night-alert.png');
  await evaluate(`document.querySelector('[aria-label="Blank Estimation error in Focus mode"]').click()`);
  fixtures['/drone_1/fusion/odom'][1].pose.pose.orientation = normalFusionOrientation;
  await evaluate(`[...document.querySelectorAll('.header-actions button')].find(button=>button.textContent.trim()==='Clear').click()`);
  await until(`document.querySelector('.estimation-panel').dataset.nightState==='standby'`);
  await evaluate(`document.querySelector('.night-toggle').click()`);
  await until(`document.documentElement.dataset.night==='off' && document.documentElement.dataset.focus==='on'`);
  assert.equal(await evaluate(`document.querySelector('[data-panel-id="gps"] .panel').dataset.nightState`), 'revealed', 'Focus choices must survive leaving Night');
  await evaluate(`document.querySelector('.focus-toggle').click()`);
  await until(`document.documentElement.dataset.focus==='off' && [...document.querySelectorAll('.panel')].every(panel=>panel.dataset.nightState==='active')`);
  await until(`JSON.stringify([...document.querySelectorAll('.grid-cell')].map(node=>[node.dataset.panelId,node.style.transform,node.style.width,node.style.height]))===${JSON.stringify(JSON.stringify(dayLayout))}`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.grid-cell')].map(node=>[node.dataset.panelId,node.style.transform,node.style.width,node.style.height])`), dayLayout, 'Leaving Focus must restore the normal layout');
  assert.equal(await evaluate(`localStorage.getItem('mission-control.grid-layout.v3')`), daySavedLayout, 'Focus must not overwrite saved panel positions');
  await evaluate(`document.querySelector('.night-toggle').click();document.querySelector('.focus-toggle').click()`);
  await until(`document.querySelector('[data-panel-id="gps"] .panel').dataset.nightState==='revealed' && document.querySelector('.flight-state-panel[data-vehicle="drone_1"]').dataset.nightState==='standby'`);
  const focusOverview = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-focus-workspace-desktop.png', Buffer.from(focusOverview.data, 'base64'));
  await evaluate(`document.querySelector('.focus-toggle').click()`);
  await cdp('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true });
  await delay(500);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, 'Night controls must fit a phone');
  assert.equal(await evaluate(`[...document.querySelectorAll('.panel-body')].every(body=>!body.inert)`), true, 'Phone Night mode must keep the whole dashboard visible');
  await capturePanel('.flight-state-panel', '/tmp/mission-night-instruments-mobile.png');
  await evaluate(`window.scrollTo(0,0)`);
  const nightMobile = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-night-workspace-mobile.png', Buffer.from(nightMobile.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width:1440,height:1200,deviceScaleFactor:1,mobile:false });
  await evaluate(`document.querySelector('.night-toggle').click()`);
  await until(`document.documentElement.dataset.night==='off'`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.flight-source-row')].every(row=>row.querySelector('.vehicle-tag')?.dataset.vehicle===row.dataset.topic.split('/')[1])`), true, 'Every overlay source needs a matching drone badge');
  const groupStyles = await evaluate(`[...document.querySelectorAll('.trajectory-legend-group')].map(group=>({name:group.getAttribute('aria-label'),color:getComputedStyle(group.querySelector('strong')).color,tracks:[...group.querySelectorAll('.trajectory-legend-item')].map(item=>({topic:item.dataset.topic,source:item.dataset.source,pattern:item.dataset.pattern,color:getComputedStyle(item.querySelector('svg')).color}))}))`);
  assert.notEqual(groupStyles[0].color, groupStyles[1].color, 'Vehicles must have different color families');
  for (const group of groupStyles) {
    for (const [source, pattern] of [['imu', 'dotted'], ['gps', 'dashed'], ['fusion', 'solid']]) {
      assert.equal(group.tracks.find(track => track.source === source).pattern, pattern);
    }
    assert.equal(new Set(group.tracks.map(track => track.color)).size, group.tracks.length, 'Sources within a vehicle must have distinct shades');
  }
  await delay(1200);
  await evaluate(`document.querySelector('.trajectory-panel').scrollIntoView({block:'start'});[...document.querySelectorAll('.trajectory-panel button')].find(button=>button.textContent==='Fit tracks').click()`);
  await delay(300);
  // Orbit/zoom and 2D projection changes must keep tags anchored and bounded.
  await evaluate(`[...document.querySelectorAll('.trajectory-panel button')].find(button=>button.textContent==='3D').click()`);
  await until(`document.querySelector('[aria-label="Orthographic 3D position tracks"]')`);
  await delay(300);
  await assertVehicleLabels(2);
  const stageBox = await evaluate(`(()=>{const r=document.querySelector('.trajectory-canvas').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: stageBox.x, y: stageBox.y, deltaX: 0, deltaY: -80 });
  await delay(400);
  await assertVehicleLabels(2);
  await evaluate(`[...document.querySelectorAll('.trajectory-panel button')].find(button=>button.textContent==='2D').click()`);
  await until(`document.querySelector('[aria-label="Top-down XY position tracks"]')`);
  await delay(300);
  await assertVehicleLabels(2);
  const groupedDesktop = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-trajectory-groups-desktop.png', Buffer.from(groupedDesktop.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(500);
  await evaluate(`document.querySelector('.trajectory-panel').scrollIntoView({block:'start'})`);
  await assertVehicleLabels(2);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Grouped legend must fit mobile width');
  assert.equal(await evaluate(`document.querySelector('.trajectory-stage').clientHeight > 150`), true, 'Grouped legend must leave room for the trajectory');
  const groupedMobile = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-trajectory-groups-mobile.png', Buffer.from(groupedMobile.data, 'base64'));
  await capturePanel('.flight-state-panel', '/tmp/mission-flight-overlay-mobile.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await delay(300);
  await evaluate(`document.querySelector('.header-actions .btn-primary').click()`);
  for (const name of groupedTracks) await evaluate(`document.querySelector('input[aria-label="Toggle ${name}"]').click()`);
  await evaluate(`document.querySelector('.offcanvas .btn-close').click()`);
  await until(`document.querySelectorAll('.trajectory-legend-item').length===2`);
  await assertVehicleLabels(1);
  const stableColor = groupStyles[0].tracks.find(track => track.topic === '/drone_1/fusion/odom').color;
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.trajectory-legend-item[data-topic="/drone_1/fusion/odom"] svg')).color`), stableColor, 'Removing sources must not recolor retained tracks');
  await assertTopicColors();
  streaming = false;
  await delay(500);
  const idleBefore = await evaluate('window.__drawCalls');
  await delay(500);
  assert.equal(await evaluate('window.__drawCalls'), idleBefore, 'Idle trajectory viewer must stop GPU drawing');
  streaming = true;
  await evaluate(`[...document.querySelectorAll('.trajectory-panel button')].find(button=>button.textContent==='3D').click()`);
  await until(`document.querySelector('[aria-label="Orthographic 3D position tracks"]')`);
  const chosenRoles = await evaluate(`({reference:document.querySelector('[aria-label="Reference topic"]').value,estimate:document.querySelector('[aria-label="Estimate topic"]').value})`);
  assert.equal(chosenRoles.reference, '/drone_1/odometry');
  assert.equal(chosenRoles.estimate, '/drone_1/fusion/odom');
  await evaluate(`document.querySelector('[aria-label="Swap reference and estimate"]').click()`);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Reference topic"]').value`), chosenRoles.estimate);
  await delay(350);
  await assertTopicColors();
  for (const metric of ['Orientation', 'Velocity', 'Position']) {
    await evaluate(`[...document.querySelectorAll('.estimation-panel [role="tab"]')].find(button=>button.textContent==='${metric}').click()`);
    await delay(300);
    await assertTopicColors();
  }
  await evaluate(`document.querySelector('[aria-label="Swap reference and estimate"]').click()`);
  assert.equal(await evaluate(`document.querySelector('.flight-state-panel').innerHTML.includes('#ffd060')`), false);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1900, height: 1200, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.flight-state-panel').scrollIntoView({block:'start'})`);
  await delay(700);
  const navigation = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-flight-state-desktop.png', Buffer.from(navigation.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await delay(500);
  await evaluate(`document.querySelector('.flight-state-panel').scrollIntoView({block:'start'})`);
  await delay(200);
  assert.equal(await evaluate(`(()=>{const el=document.querySelector('.flight-state-panel .panel-fill');return el.scrollHeight <= el.clientHeight + 2})()`), true, 'Shared overlay instruments should fit their panel');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  const narrowNavigation = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-flight-state-mobile.png', Buffer.from(narrowNavigation.data, 'base64'));
  // Hiding every panel must leave a usable recovery path and persist on reload.
  for (const id of ['trajectory', 'gps', 'attitude:drone_1', 'error']) {
    await evaluate(`document.querySelector('[data-panel-id="${id}"] .panel-hide').click()`);
    await until(`!document.querySelector('[data-panel-id="${id}"]')`);
  }
  await until(`document.querySelector('.workspace-panels-empty') && document.querySelectorAll('.hidden-panel-item').length===4`);
  assert.equal(await evaluate(`document.querySelector('.count-badge').textContent`), '2', 'Hiding all panels must retain subscriptions');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate(`document.querySelector('.hidden-panels-drawer').scrollIntoView({block:'start'})`);
  const hiddenShot = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-hidden-panels-mobile.png', Buffer.from(hiddenShot.data, 'base64'));
  await evaluate(`document.querySelector('.night-toggle').click()`);
  await until(`document.documentElement.dataset.night==='on'`);
  await evaluate(`document.querySelector('.focus-toggle').click();window.__workspaceBeforeReload=true`);
  await cdp('Page.reload');
  await until(`!window.__workspaceBeforeReload && document.querySelector('.header-actions .btn-primary')`);
  assert.equal(await evaluate(`document.documentElement.dataset.night`), 'on', 'Night preference should survive reload');
  assert.equal(await evaluate(`document.documentElement.dataset.focus`), 'on', 'Focus preference should survive reload independently');
  assert.equal(await evaluate(`document.querySelector('[aria-label="Night brightness"]').value`), '60', 'Night dimmer should survive reload');
  await evaluate(`document.querySelector('.header-actions .btn-primary').click()`);
  await until(`document.querySelector('[aria-label="Rosbridge WebSocket address"]')`);
  if (!lan) await evaluate(`(()=>{const input=document.querySelector('[aria-label="Rosbridge WebSocket address"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'ws://127.0.0.1:${server.address().port}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Connect').click()`);
  await until(`document.querySelectorAll('.topic-row').length===${Object.keys(fixtures).length}`);
  for (const name of ['/drone_1/fusion/odom', '/drone_1/odometry']) await evaluate(`document.querySelector('input[aria-label="Toggle ${name}"]').click()`);
  await evaluate(`document.querySelector('.offcanvas .btn-close').click()`);
  await until(`document.querySelector('.workspace-panels-empty') && !document.querySelector('.trajectory-panel')`);
  await evaluate(`document.querySelector('.hidden-panels-toggle').click()`);
  await until(`document.querySelectorAll('.hidden-panel-item').length===4`);
  await evaluate(`[...document.querySelectorAll('.hidden-panels-body button')].find(button=>button.textContent==='Restore all panels').click()`);
  await until(`document.querySelector('.trajectory-panel') && document.querySelector('.flight-state-panel') && document.querySelector('.estimation-panel')`);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('mission-control.hidden-panels.v1')).length`), 0);
  await until(`document.querySelector('[data-panel-id="gps"] .panel').dataset.nightState==='revealed' && document.querySelector('.flight-state-panel[data-vehicle="drone_1"]').dataset.nightState==='standby'`);
  await evaluate(`document.querySelector('.focus-toggle').click()`);
  await assertFlightOverlays(2);
  await evaluate(`document.querySelector('.night-toggle').click()`);
  await until(`document.documentElement.dataset.night==='off'`);
  // Exercise actual unmount/remount as well as the development-only mount cycle.
  await evaluate(`document.querySelector('.header-actions .btn-primary').click()`);
  await until(`document.querySelectorAll('.topic-row input:checked').length===2`);
  await evaluate(`document.querySelector('input[aria-label="Toggle /drone_1/fusion/odom"]').click()`);
  await assertFlightOverlays(1);
  assert.equal(await evaluate(`document.querySelector('.flight-source-row').dataset.topic`), '/drone_1/odometry');
  await evaluate(`document.querySelector('input[aria-label="Toggle /drone_1/fusion/odom"]').click()`);
  await assertFlightOverlays(2);
  await evaluate(`[...document.querySelectorAll('.topic-row input:checked')].forEach(input=>input.click())`);
  await until(`!document.querySelector('.trajectory-panel') && document.querySelector('.app-header')`);
  await evaluate(`document.querySelector('input[aria-label="Toggle /drone_1/fusion/odom"]').click()`);
  await until(`document.querySelectorAll('.flight-source-row').length===1 && document.querySelector('.trajectory-panel')`);
  await evaluate(`document.querySelector('input[aria-label="Toggle /drone_1/fusion/odom"]').click()`);
  await until(`!document.querySelector('.trajectory-panel') && document.querySelector('.app-header')`);
  // Mission is a separate workspace; Analysis stays mounted with its exact layout.
  for (const name of ['/drone_1/fusion/odom', '/drone_1/odometry', '/camera/compressed']) await evaluate(`document.querySelector('input[aria-label="Toggle ${name}"]').click()`);
  await evaluate(`document.querySelector('.offcanvas .btn-close').click()`);
  await cdp('Emulation.setDeviceMetricsOverride', { width:1440,height:1000,deviceScaleFactor:1,mobile:false });
  await delay(350);
  await until(`parseFloat(document.querySelector('#analysis-workspace .grid-cell').style.width)>600`);
  const analysisBeforeMission = await evaluate(`[...document.querySelectorAll('#analysis-workspace .grid-cell')].map(node=>[node.dataset.panelId,node.style.transform,node.style.width,node.style.height])`);
  const analysisLayoutStore = await evaluate(`localStorage.getItem('mission-control.grid-layout.v3')`);
  await evaluate(`document.querySelector('#mission-workspace-tab').click()`);
  await until(`document.querySelector('.mission-workspace') && document.querySelector('#analysis-workspace').hidden && document.querySelector('.mission-fleet-item')`);
  await until(`document.querySelectorAll('#mission-workspace .topic-map-trail').length===2`);
  await until(`window.__workers.alive===0`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#analysis-workspace')).display`), 'none', 'Inactive Analysis must not render underneath Mission');
  assert.equal(subscriptions.size, 3, 'Switching workspaces must reuse subscriptions');
  const inactiveRoll = await evaluate(`document.querySelector('#analysis-workspace [data-topic="/drone_1/fusion/odom"] [data-metric="roll"]').textContent`);
  const savedMissionOrientation = fixtures['/drone_1/fusion/odom'][1].pose.pose.orientation;
  fixtures['/drone_1/fusion/odom'][1].pose.pose.orientation = quaternion(15,0,45);
  await delay(500);
  assert.equal(await evaluate(`document.querySelector('#analysis-workspace [data-topic="/drone_1/fusion/odom"] [data-metric="roll"]').textContent`), inactiveRoll, 'Inactive Analysis instruments must stop high-rate updates');
  const setMissionField = async (label, value) => evaluate(`(()=>{const input=document.querySelector('#mission-workspace [aria-label="${label}"]');const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:input.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await evaluate(`[...document.querySelectorAll('#mission-workspace button')].find(button=>button.textContent==='Add control').click()`);
  await setMissionField('Control name', 'Check vehicle');
  await setMissionField('Control endpoint', '/{vehicle}/mission_test');
  await setMissionField('Control type', 'std_srvs/srv/Trigger');
  await evaluate(`document.querySelector('#mission-workspace .mission-control-editor').requestSubmit()`);
  await until(`document.querySelector('#mission-workspace .mission-control-action')`);
  assert.equal(controlPackets.length, 0, 'Saving a control must not send a command');
  await evaluate(`document.querySelector('#mission-workspace .mission-control-action').click()`);
  await until(`document.querySelector('.mission-command-review')?.textContent.includes('/drone_1/mission_test')`);
  assert.equal(controlPackets.length, 0, 'Reviewing must not execute a command');
  await evaluate(`document.querySelector('.mission-command-review .mission-primary').click()`);
  await until(`document.querySelector('.mission-command-result')?.textContent.includes('service replied')`);
  assert.equal(controlPackets.length, 1);
  assert.equal(controlPackets[0].service, '/drone_1/mission_test');
  assert.deepEqual(controlPackets[0].args, {});
  await evaluate(`(()=>{const input=document.querySelector('#mission-message');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'/status');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evaluate(`document.querySelector('#mission-workspace .chat-composer').requestSubmit()`);
  await until(`document.querySelector('#mission-workspace .chat-log').textContent.includes('Connection: connected')`);
  await evaluate(`window.scrollTo(0,0)`);
  const missionDesktop = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-operations-desktop.png', Buffer.from(missionDesktop.data, 'base64'));
  await evaluate(`[...document.querySelectorAll('#mission-workspace .mission-scene-tabs button')].find(button=>button.textContent==='Camera').click()`);
  await until(`document.querySelector('#mission-workspace .sensor-canvas') && window.__workers.alive===1`);
  await evaluate(`document.querySelector('#analysis-workspace-tab').click()`);
  await until(`!document.querySelector('#analysis-workspace').hidden && document.querySelector('#analysis-workspace [data-topic="/drone_1/fusion/odom"] [data-metric="roll"]').textContent==='15.0'`);
  await until(`JSON.stringify([...document.querySelectorAll('#analysis-workspace .grid-cell')].map(node=>[node.dataset.panelId,node.style.transform,node.style.width,node.style.height]))===${JSON.stringify(JSON.stringify(analysisBeforeMission))}`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#analysis-workspace .grid-cell')].map(node=>[node.dataset.panelId,node.style.transform,node.style.width,node.style.height])`), analysisBeforeMission, 'Mission must preserve Analysis panel geometry');
  assert.equal(await evaluate(`localStorage.getItem('mission-control.grid-layout.v3')`), analysisLayoutStore);
  await until(`document.querySelectorAll('#mission-workspace .sensor-canvas').length===0 && window.__workers.alive===1`);
  fixtures['/drone_1/fusion/odom'][1].pose.pose.orientation = savedMissionOrientation;
  await evaluate(`document.querySelector('#mission-workspace-tab').click()`);
  await until(`document.querySelector('#mission-workspace .sensor-canvas')`);
  await evaluate(`[...document.querySelectorAll('#mission-workspace .mission-scene-tabs button')].find(button=>button.textContent==='Map').click()`);
  await cdp('Emulation.setDeviceMetricsOverride', { width:390,height:844,deviceScaleFactor:1,mobile:true });
  await delay(500);
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, 'Mission must fit a phone');
  await evaluate(`window.scrollTo(0,0)`);
  const missionMobile = await cdp('Page.captureScreenshot', { format: 'png' });
  await writeFile('/tmp/mission-operations-mobile.png', Buffer.from(missionMobile.data, 'base64'));
  // No request is retried after a lost connection or a saved-workspace reload.
  for (const client of sockets) client.close();
  await until(`document.querySelector('#mission-workspace .mission-control-action').disabled`);
  assert.equal(controlPackets.length, 1);
  await evaluate(`document.querySelector('.mission-viewbar-status button').click()`);
  await until(`!document.querySelector('#mission-workspace .mission-control-action').disabled`);
  assert.equal(controlPackets.length, 1, 'Reconnect must never replay commands');
  await evaluate(`window.__missionBeforeReload=true`);
  await cdp('Page.reload');
  await until(`!window.__missionBeforeReload && document.querySelector('.mission-workspace')`);
  assert.equal(await evaluate(`document.querySelector('#mission-workspace-tab').getAttribute('aria-selected')`), 'true');
  assert.equal(await evaluate(`document.querySelectorAll('.mission-control-action').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.mission-control-action').disabled`), true);
  await until(`document.querySelector('#mission-workspace .chat-log').textContent.includes('Connection: connected')`);
  assert.equal(controlPackets.length, 1, 'Reload must not replay saved commands or console history');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', scenarios: ['persistent performance preference', 'terminal local history and reload', 'terminal plain-text messages', 'terminal mobile layout', 'terminal keyboard focus', ...(navigationOnly ? [] : ['automatic mobile budgets', 'off-screen sensor throttling', 'Night lighting preserves streams', 'camera-only dimming', 'Focus sensor suspension and wake', 'raw camera', 'compressed PNG/JPEG', 'malformed-frame recovery', '20-second heap/FPS check', 'LaserScan', '200k PointCloud2', 'source switching', 'pause/resume', 'clear', 'unsubscribe cleanup']), 'compact workspace', 'off-screen charts freeze', 'full Night dashboard and stable layout', 'saved Focus choices', 'automatic alert pop-ups disabled', 'idle stale-data detection', 'flight instruments', 'distinct comparison defaults', 'reference swap', 'navigation mobile layout', '2D/3D switching', 'idle GPU drawing stops', 'odometry unmount/remount', 'separate Mission workspace', 'Analysis geometry preserved', 'inactive workspace rendering sleeps', 'reviewed ROS controls', 'Mission console', 'no command replay', 'Mission mobile layout'], development, lan, stats, screenshot: '/tmp/mission-sensor-preview.png' }, null, 2));
} catch (error) {
  if (error !== PROFILE_DONE) throw error;
} finally {
  clearInterval(navigationTimer);
  socket?.close(); chrome.kill('SIGTERM'); vite?.kill('SIGTERM');
  await lanServer?.shutdown();
  for (const client of sockets) client.terminate();
  server.close();
  await delay(500);
  await rm(profile, { recursive: true, force: true });
}
