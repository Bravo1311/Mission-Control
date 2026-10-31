import { useMemo, useState } from 'react';
import { TelemetryScope, useTelemetry } from '../context/telemetryContext.jsx';
import { groupFlightTopics, flightReading } from '../lib/flightState.js';
import { pos } from '../lib/plotHelpers.js';
import { loadControls, CONTROLS_KEY, missionConsoleReply } from '../lib/missionControls.js';
import GpsPanel from './gpsPanel.jsx';
import StateEstimatePanel from './stateEstimatePanel.jsx';
import AttitudeIndicatorPanel from './attitudeIndicatorPanel.jsx';
import SensorPanel from './sensorPanel.jsx';
import ChatTerminal from './chatTerminal.jsx';
import DataStatus from './dataStatus.jsx';
import MissionCommandDock from './missionCommandDock.jsx';

const number = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
function preferredReading(group, getBuffer) {
  if (!group) return null;
  const source = group.topics.find(topic => getBuffer(topic.name).raw.length) || group.topics[0];
  return source ? { ...flightReading(source, getBuffer(source.name).raw.at(-1)), altitude: pos(getBuffer(source.name).raw.at(-1))?.z } : null;
}
function Fleet({ groups, chosen, onChoose }) {
  const { getBuffer } = useTelemetry(500);
  return <aside className="mission-fleet" aria-label="Mission fleet">
    <header className="mission-section-heading"><h2>Fleet</h2><span>{groups.length} {groups.length === 1 ? 'vehicle' : 'vehicles'}</span></header>
    {!groups.length && <p className="mission-empty-copy">Select vehicle topics from Topics to populate the fleet.</p>}
    <div className="mission-fleet-list">{groups.map(group => {
      const reading = preferredReading(group, getBuffer);
      return <div className={`mission-fleet-item${chosen === group.key ? ' is-selected' : ''}`} key={group.key} style={{ '--vehicle-ink': group.topics[0].style.groupColor }}>
        <button className="mission-fleet-select" aria-pressed={chosen === group.key} onClick={() => onChoose(group.key)}><span className="mission-vehicle-dot" /><strong>{group.label}</strong><span>{chosen === group.key ? 'Target' : 'Select'}</span></button>
        <DataStatus names={group.topics.map(topic => topic.name)} />
        <dl><div><dt>Speed</dt><dd>{number(reading?.ground)} <span>m/s</span></dd></div><div><dt>Altitude</dt><dd>{number(reading?.altitude)} <span>m</span></dd></div></dl>
      </div>;
    })}</div>
  </aside>;
}
function MissionReadout({ group }) {
  const { getBuffer } = useTelemetry(250);
  const reading = preferredReading(group, getBuffer);
  return <section className="mission-readout" aria-label="Target telemetry">
    <div className="mission-readout-source"><strong>{group?.label || 'No target'}</strong><span>{reading ? `${reading.style.sourceLabel} · ${reading.frame}` : 'Select vehicle telemetry'}</span>{reading && <DataStatus names={[reading.name]} />}</div>
    <dl>{[['Altitude', reading?.altitude, 'm'], ['Ground speed', reading?.ground, 'm/s'], ['Heading', reading?.heading, '°'], ['Vertical speed', reading?.vertical, 'm/s']].map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{number(value)} <span>{unit}</span></dd></div>)}</dl>
  </section>;
}
export default function MissionWorkspace() {
  const { selected, classify, status, bridgeUrl, connect } = useTelemetry();
  const groups = useMemo(() => groupFlightTopics(selected.filter(topic => ['trajectory', 'geo', 'imu'].includes(classify(topic.name)))), [selected, classify]);
  const [chosen, setChosen] = useState(null);
  const group = groups.find(item => item.key === chosen) || groups[0];
  const namespace = group?.key ? group.label : '';
  const [scene, setScene] = useState('map');
  const [fleetView, setFleetView] = useState(true);
  const [controls, setControls] = useState(() => { try { return loadControls(window.localStorage); } catch { return []; } });
  const updateControls = next => {
    setControls(next);
    try { localStorage.setItem(CONTROLS_KEY, JSON.stringify(next)); } catch { /* session only */ }
  };
  const transport = useMemo(() => ({ send: async ({ messages, context }) => missionConsoleReply(messages.at(-1).content, {
    status: context.connectionStatus, target: namespace ? `/${namespace}` : '', topics: context.topics, controls,
  }) }), [namespace, controls]);
  const hasPosition = selected.some(topic => ['trajectory', 'geo'].includes(classify(topic.name)));
  const hasTrajectory = selected.some(topic => classify(topic.name) === 'trajectory');
  const hasCamera = selected.some(topic => classify(topic.name) === 'camera');
  const hasLidar = selected.some(topic => classify(topic.name) === 'lidar');
  const scenes = [{ key: 'map', label: 'Map', enabled: hasPosition }, { key: 'trajectory', label: 'Trajectory', enabled: hasTrajectory },
    { key: 'flight', label: 'Flight state', enabled: !!group }, { key: 'camera', label: 'Camera', enabled: hasCamera }, { key: 'lidar', label: 'Lidar', enabled: hasLidar }];
  const activeScene = scenes.find(item => item.key === scene && item.enabled) || scenes.find(item => item.enabled);
  // Sensor choices stay available regardless of the map's fleet/target scope.
  const names = !fleetView && group && ['map', 'trajectory'].includes(activeScene?.key) ? group.topics.map(topic => topic.name) : null;
  const missingTargetPosition = activeScene?.key === 'map' && names && !selected.some(topic => names.includes(topic.name) && ['trajectory', 'geo'].includes(classify(topic.name)));
  return <div className="mission-workspace">
    <div className="mission-viewbar"><div><h1>Mission control</h1><button className="chip-btn mission-operator-jump" onClick={() => document.querySelector('#mission-workspace .mission-operator')?.scrollIntoView({ block: 'start' })}>Controls &amp; chat</button></div><div className="mission-viewbar-status"><span className={`mission-link-state link-${status}`}>{status === 'connected' ? 'Link connected' : status === 'connecting' ? 'Connecting…' : 'Link disconnected'}</span><button className="chip-btn" disabled={status === 'connecting'} onClick={() => connect(bridgeUrl)}>Reconnect</button></div></div>
    <div className="mission-layout">
      <Fleet groups={groups} chosen={group?.key} onChoose={setChosen} />
      <section className="mission-situation" aria-label="Mission situation">
        <header className="mission-scene-toolbar"><div className="mission-scene-tabs" role="tablist" aria-label="Mission visualization">{scenes.filter(item => item.enabled).map(item => <button key={item.key} role="tab" aria-selected={activeScene?.key === item.key} onClick={() => setScene(item.key)}>{item.label}</button>)}</div>
          {['map', 'trajectory'].includes(activeScene?.key) && <label className="mission-fleet-toggle"><input type="checkbox" checked={fleetView} onChange={event => setFleetView(event.target.checked)} />Whole fleet</label>}
        </header>
        <div className="mission-scene" data-scene={activeScene?.key || 'empty'}>
          <TelemetryScope names={names}>
            {missingTargetPosition ? <div className="mission-scene-empty"><h2>No position source for this target</h2><p>Enable Whole fleet to see other vehicles, or select this vehicle’s position topics.</p></div> : activeScene?.key === 'map' ? <GpsPanel /> : activeScene?.key === 'trajectory' ? <StateEstimatePanel /> : activeScene?.key === 'flight' ? <AttitudeIndicatorPanel group={group} /> : activeScene?.key === 'camera' ? <SensorPanel kind="camera" /> : activeScene?.key === 'lidar' ? <SensorPanel kind="lidar" /> : <div className="mission-scene-empty"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M40 10v60M10 40h60"/><circle cx="40" cy="40" r="22"/><circle cx="40" cy="40" r="4"/></svg><h2>Waiting for vehicle telemetry</h2><p>Use Topics to connect to rosbridge and select position or sensor topics. Controls and the console are available alongside the live view.</p></div>}
          </TelemetryScope>
        </div>
        <MissionReadout group={group} />
      </section>
      <aside className="mission-operator" aria-label="Mission operator workspace">
        <MissionCommandDock namespace={namespace} controls={controls} onControls={updateControls} />
        <ChatTerminal embedded consoleMode transport={transport} storageKey="mission-control.mission-chat.v1" />
      </aside>
    </div>
  </div>;
}
