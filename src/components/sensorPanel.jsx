import { WorkspaceActivityContext } from '../context/workspaceActivity.js';
import { useContext, useEffect, useRef, useState } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { createLatestFramePump } from '../lib/latestFrame.js';
import Panel from './panel.jsx';
import { useNightMode } from '../lib/useNightMode.js';
import { topicStyle } from '../lib/topicStyles.js';
import TopicSwatch from './topicSwatch.jsx';
import VehicleTag from './vehicleTag.jsx';
import { usePanelPreference } from '../context/panelActions.js';
import { panelIsAwake } from '../lib/nightPanel.js';

function SensorCanvas({ kind, topic, getBuffer, paused, range, status, profile, registerPreview, requestedInterval }) {
  const canvasRef = useRef(null);
  const hostRef = useRef(null);
  const [info, setInfo] = useState({ note: 'Waiting for a frame', error: '' });
  const [metrics, setMetrics] = useState(null);
  const [frameName, setFrameName] = useState('');
  const intervalRef = useRef(requestedInterval);
  useEffect(() => { intervalRef.current = requestedInterval; }, [requestedInterval]);

  useEffect(() => {
    if (paused) return;
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const ctx = canvas.getContext('2d');
    let visible = false;
    let stopped = false;
    let watchdog;
    let animation;
    let lastDispatch = -Infinity;
    let reportTime = performance.now();
    let rendered = 0;
    let baseNote = '';
    const period = kind === 'camera' ? profile.cameraMs : /PointCloud2/.test(topic.type) ? profile.cloudMs : profile.scanMs;
    let lastDecode = 0;
    const report = next => setInfo(previous =>
      previous.note === next.note && previous.error === next.error ? previous : next);
    let worker;
    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    clear();
    try {
      worker = new Worker(new URL('../workers/sensor.worker.js', import.meta.url), { type: 'module' });
    } catch {
      const id = setTimeout(() => report({ note: '', error: 'Sensor previews require browser Web Worker support.' }), 0);
      return () => clearTimeout(id);
    }
    const fail = (error) => {
      stopped = true;
      clearTimeout(watchdog);
      worker.terminate();
      syncActivity();
      clear();
      report({ note: '', error });
    };
    const read = () => getBuffer(topic.name);
    const pump = createLatestFramePump(read, msg => {
      if (msg.previewError) {
        baseNote = '';
        clear();
        report({ note: '', error: msg.previewError });
        pump.complete();
        return;
      }
      lastDispatch = performance.now();
      watchdog = setTimeout(() => fail('Frame decoding timed out. Pause and resume to retry, or use a smaller sensor stream.'), 5000);
      try { worker.postMessage({ kind, msg, range, mode: profile.mode, topicName: topic.name }); }
      catch (error) { fail(error.message); }
    });
    worker.onmessage = ({ data }) => {
      clearTimeout(watchdog);
      const valid = pump.complete();
      try {
        if (stopped || !valid || !visible || document.hidden || !panelIsAwake(host)) { pump.retry(); return; }
        if (data.error) {
          baseNote = '';
          clear(); report({ note: '', error: data.error }); return;
        }
        if (canvas.width !== data.bitmap.width) canvas.width = data.bitmap.width;
        if (canvas.height !== data.bitmap.height) canvas.height = data.bitmap.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(data.bitmap, 0, 0);
        rendered++;
        lastDecode = data.decodeMs;
        setFrameName(read().raw.at(-1)?.header?.frame_id || 'Unspecified');
        baseNote = data.note;
        report({ note: baseNote, error: '' });
      } finally { data.bitmap?.close(); }
    };
    worker.onerror = () => fail('Sensor worker failed. Pause and resume to retry.');
    let unregister;
    const syncActivity = () => {
      const active = visible && !document.hidden && panelIsAwake(host) && !stopped;
      if (active && !unregister) unregister = registerPreview(topic.name);
      else if (!active && unregister) { unregister(); unregister = null; }
    };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; syncActivity(); });
    observer.observe(hostRef.current);
    document.addEventListener('visibilitychange', syncActivity);
    const nightObserver = new MutationObserver(syncActivity);
    nightObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-night', 'data-focus'] });
    if (host.closest('.panel')) nightObserver.observe(host.closest('.panel'), { attributes: true, attributeFilter: ['data-night-state'] });
    syncActivity();
    let empty = false;
    const update = () => {
      if (stopped || document.hidden || !visible || !panelIsAwake(host)) return;
      if (!read().raw.length) {
        if (!empty) { clear(); report({ note: 'Waiting for a frame', error: '' }); empty = true; }
        return;
      }
      empty = false;
      const now = performance.now();
      if (now - reportTime >= Math.max(1000, intervalRef.current)) {
        const reception = read().reception;
        const stalled = reception && now - reception.last > Math.max(1500, intervalRef.current * 2.5);
        const displayFps = rendered * 1000 / (now - reportTime);
        setMetrics({
          display: displayFps.toFixed(displayFps < 1 ? 1 : 0),
          decode: Math.round(lastDecode),
          incoming: stalled ? 'Stalled' : reception ? reception.fps.toFixed(1) : '—',
          bandwidth: reception && !stalled ? reception.mib.toFixed(1) : '0.0',
        });
        rendered = 0; reportTime = now;
      }
      if (performance.now() - lastDispatch >= period - 5) pump.pull();
    };
    // Align camera presentation with browser paint, independently of lidar.
    const animate = () => {
      update();
      animation = requestAnimationFrame(animate);
    };
    const id = kind === 'camera' ? null : setInterval(update, period);
    if (kind === 'camera') animation = requestAnimationFrame(animate);
    return () => {
      stopped = true;
      clearInterval(id); clearTimeout(watchdog);
      cancelAnimationFrame(animation);
      observer.disconnect(); worker.terminate();
      nightObserver.disconnect();
      document.removeEventListener('visibilitychange', syncActivity);
      unregister?.();
    };
  }, [kind, topic.name, topic.type, getBuffer, paused, range, profile, registerPreview]);

  return (
    <div ref={hostRef} className="sensor-display">
      <div className="sensor-vehicle-label"><VehicleTag name={topic.name} /><span>{topicStyle(topic.name).sourceLabel}</span></div>
      <canvas ref={canvasRef} className="sensor-canvas" width="800" height="450" aria-label={`${kind === 'camera' ? 'Camera image' : 'Lidar XY preview'} from ${topic.name}`} />
      {info.error && <div className="sensor-message" role="status">{info.error}</div>}
      <div className="sensor-caption">
        <div className="sensor-frame-info">
          <span className="sensor-state">{paused ? 'Display paused' : status !== 'connected' ? 'Disconnected' : info.error ? 'Unavailable' : metrics?.incoming === 'Stalled' ? 'Stale · retained frame' : info.note === 'Waiting for a frame' ? 'Waiting' : 'Live preview'}</span>
          <span className="sensor-format" title={info.note}>{info.note}</span>
          {frameName && <span className="sensor-frame-name" title={`Coordinate frame: ${frameName}`}>{frameName}</span>}
        </div>
        <dl className="sensor-metrics">
          <div><dt>Display</dt><dd>{metrics?.display ?? '—'} <span>FPS</span></dd></div>
          <div><dt>Incoming</dt><dd>{metrics?.incoming ?? '—'} <span>{metrics?.incoming === 'Stalled' ? '' : 'FPS'}</span></dd></div>
          <div><dt>Decode</dt><dd>{metrics?.decode ?? '—'} <span>ms</span></dd></div>
          <div><dt>Payload</dt><dd>{metrics?.bandwidth ?? '—'} <span>MiB/s</span></dd></div>
        </dl>
      </div>
    </div>
  );
}

export default function SensorPanel({ kind }) {
  const workspaceActive = useContext(WorkspaceActivityContext);
  const [night, , , , , , cameraBrightness, setCameraBrightness] = useNightMode();
  const { selected, classify, getBuffer, status, sensorTransport, setSensorTransport, registerPreview, requestedSensorInterval, hostCameraPreview, performance: profile } = useTelemetry();
  const topics = selected.filter(t => classify(t.name) === kind);
  const [chosen, setChosen] = usePanelPreference('source', '');
  const [paused, setPaused] = usePanelPreference('paused', false);
  const [range, setRange] = usePanelPreference('range', 30);
  const topic = topics.find(t => t.name === chosen) || topics[0];
  if (!topic) return null;
  const icon = kind === 'camera' ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 3v9l6-6M3 12h3m6 6v3m6-9h3"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>
  );
  return (
    <Panel className="sensor-panel" title={kind === 'camera' ? 'Camera feed' : 'Lidar scan'} subtitle={kind === 'camera' ? 'Color & depth imaging' : 'Sensor-frame XY projection'} icon={icon} controls={
      <>
        <button className="chip-btn sensor-pause" aria-pressed={paused} onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</button>
        <details className="sensor-settings">
          <summary aria-label={`${kind} settings`}>Settings</summary>
          <div className="sensor-settings-popover">
            {kind === 'camera' && night && <label>Night image brightness
              <input type="range" min="20" max="100" step="1" value={cameraBrightness} aria-label="Night camera brightness" onChange={event => setCameraBrightness(event.target.value)} />
              <output>{cameraBrightness}%</output>
            </label>}
            <label>Transport
              <select className="panel-select" aria-label={`${kind} transport`} value={sensorTransport} onChange={e => setSensorTransport(e.target.value)}>
                <option value="cbor">Binary</option><option value="none">JSON compatibility</option>
              </select>
            </label>
            <p>Shared by camera and lidar.</p>
          </div>
        </details>
      </>
    }>
      <div className="sensor-content" data-topic={topic.name} style={{ '--topic-color': topicStyle(topic.name).color }}>
        <div className="sensor-sourcebar">
          <label className="sensor-source"><TopicSwatch name={topic.name} />Source
            <select className="panel-select" aria-label={`${kind} source`} value={topic.name} onChange={e => setChosen(e.target.value)}>
              {topics.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
          {kind === 'lidar' && <label className="sensor-range">Range
            <select className="panel-select" aria-label="Lidar radius" value={range} onChange={e => setRange(Number(e.target.value))}>
              {[5, 10, 30, 50, 100].map(r => <option key={r} value={r}>{r} m</option>)}
            </select>
          </label>}
        </div>
        {profile.mode === 'mobile' && <p className="sensor-bandwidth-note">{kind === 'camera' && hostCameraPreview ? 'Mobile preview · images resized on host before transfer.' : 'Mobile link budget · large frames update more slowly.'}</p>}
        {workspaceActive && <SensorCanvas key={topic.name} kind={kind} topic={topic} getBuffer={getBuffer} paused={paused} range={range} status={status} profile={profile} registerPreview={registerPreview} requestedInterval={requestedSensorInterval(topic.name, topic.type)} />}
      </div>
    </Panel>
  );
}
