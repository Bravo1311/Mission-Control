import { useCallback, useState } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { PALETTE } from '../lib/plotHelpers.js';
import ThreeTrajectoryViewer from './threeTrajectoryViewer.jsx';
import Panel from './panel.jsx';

export default function StateEstimatePanel() {
  const { selected, classify, getBuffer } = useTelemetry();
  const [mode, setMode] = useState('3d');
  const [fitToken, setFitToken] = useState(0);
  const [viewInfo, setViewInfo] = useState(null);
  const updateInfo = useCallback(info => setViewInfo(previous => !info ? null : previous?.step === info.step && previous?.plane === info.plane ? previous : info), []);
  const topics = selected.filter(topic => classify(topic.name) === 'trajectory');
  if (!topics.length) return null;
  const number = value => Number(value.toPrecision(5)).toString();
  return <Panel className="trajectory-panel" title="Trajectory" subtitle="Position tracks in topic coordinates" icon={
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 17 6 3 10-6V7L14 4 4 10zM4 10l6 3 10-6M10 13v7"/><path d="m7 15 5-4 5 1"/></svg>
  } controls={<>
    <div className="segmented" role="tablist" aria-label="Trajectory projection">
      <button role="tab" aria-selected={mode === '3d'} className={mode === '3d' ? 'active' : ''} onClick={() => setMode('3d')}>3D</button>
      <button role="tab" aria-selected={mode === '2d'} className={mode === '2d' ? 'active' : ''} onClick={() => setMode('2d')}>2D</button>
    </div>
    <button className="chip-btn" onClick={() => setFitToken(n => n + 1)} title="Frame the origin and full retained history">Fit tracks</button>
  </>}>
    <div className="trajectory-content">
      <div className="trajectory-legend" aria-label="Trajectory sources">
        {topics.map((topic, i) => <span key={topic.name} className="trajectory-legend-item" title={topic.name}><i style={{ backgroundColor: PALETTE[i % PALETTE.length] }} /><span>{topic.name}</span></span>)}
        <span className="trajectory-marker-key"><i />Latest position</span>
      </div>
      <ThreeTrajectoryViewer topics={topics} getBuffer={getBuffer} mode={mode} fitToken={fitToken} onViewInfo={updateInfo} />
      <div className="trajectory-status">
        <span>{viewInfo ? `Grid ${number(viewInfo.step)} m · Plane Z ${number(viewInfo.plane)} m` : 'Local coordinates · metres'}</span>
        <span>{mode === '3d' ? 'Drag to orbit · Right-drag to pan' : 'Drag to pan'} · Scroll to zoom</span>
      </div>
    </div>
  </Panel>;
}
