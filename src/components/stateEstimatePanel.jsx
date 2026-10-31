import { useCallback, useState } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { topicStyle } from '../lib/topicStyles.js';
import TopicSwatch from './topicSwatch.jsx';
import ThreeTrajectoryViewer from './threeTrajectoryViewer.jsx';
import Panel from './panel.jsx';
import VehicleTag from './vehicleTag.jsx';
import { usePanelPreference } from '../context/panelActions.js';

const SOURCE_ORDER = ['imu', 'gps', 'fusion', 'odometry', 'reference', 'other'];

export default function StateEstimatePanel() {
  const { selected, classify, getBuffer, performance: profile } = useTelemetry();
  const [chosenMode, setMode] = usePanelPreference('projection', null);
  const mode = chosenMode || (profile.mode === 'mobile' ? '2d' : '3d');
  const [fitToken, setFitToken] = useState(0);
  const [viewInfo, setViewInfo] = useState(null);
  const updateInfo = useCallback(info => setViewInfo(previous => !info ? null : previous?.step === info.step && previous?.plane === info.plane ? previous : info), []);
  const topics = selected.filter(topic => classify(topic.name) === 'trajectory').map(topic => ({ ...topic, style: topicStyle(topic.name) }));
  if (!topics.length) return null;
  const groups = new Map();
  for (const topic of topics) {
    if (!groups.has(topic.style.groupKey)) groups.set(topic.style.groupKey, []);
    groups.get(topic.style.groupKey).push(topic);
  }
  for (const tracks of groups.values()) tracks.sort((a, b) => SOURCE_ORDER.indexOf(a.style.sourceKind) - SOURCE_ORDER.indexOf(b.style.sourceKind)
    || a.style.sourceLabel.localeCompare(b.style.sourceLabel, undefined, { numeric: true }));
  const number = value => Number(value.toPrecision(5)).toString();
  return <Panel className="trajectory-panel" sources={topics.map(topic => topic.name)} title="Trajectory" subtitle="Position tracks in topic coordinates" icon={
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 17 6 3 10-6V7L14 4 4 10zM4 10l6 3 10-6M10 13v7"/><path d="m7 15 5-4 5 1"/></svg>
  } controls={<>
    <div className="segmented" role="tablist" aria-label="Trajectory projection">
      <button role="tab" aria-selected={mode === '3d'} className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>3D</button>
      <button role="tab" aria-selected={mode === '2d'} className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>2D</button>
    </div>
    <button className="chip-btn" onClick={() => setFitToken(n => n + 1)} title="Frame the origin and full retained history">Fit tracks</button>
  </>}>
    <div className="trajectory-content">
      <div className="trajectory-legend" aria-label="Trajectory sources grouped by vehicle">
        {[...groups].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([key, tracks]) => <div key={key} className="trajectory-legend-group" role="group" aria-label={tracks[0].style.groupLabel}>
          <strong className="trajectory-group-name" style={{ color: tracks[0].style.groupColor }} title={tracks[0].style.groupLabel}><VehicleTag name={tracks[0].name} /></strong>
          <div className="trajectory-group-sources">
            {tracks.map(({ name, style }) => <span key={name} className="trajectory-legend-item" title={`${name} · ${style.sourceTitle} · ${style.pattern}`} data-topic={name} data-source={style.sourceKind} data-pattern={style.pattern}>
              <TopicSwatch name={name} />
              <span>{style.sourceLabel}</span>
            </span>)}
          </div>
        </div>)}
      </div>
      <ThreeTrajectoryViewer topics={topics} getBuffer={getBuffer} mode={mode} fitToken={fitToken} onViewInfo={updateInfo} />
      <div className="trajectory-status">
        <span>{viewInfo ? `Grid ${number(viewInfo.step)} m · Plane Z ${number(viewInfo.plane)} m` : 'Local coordinates · metres'}</span>
        <span>{mode === '3d' ? 'Drag to orbit · Right-drag to pan' : 'Drag to pan'} · Scroll to zoom</span>
      </div>
    </div>
  </Panel>;
}
