import { memo, useSyncExternalStore } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { streamStatus } from '../lib/streamStatus.js';

// One shared low-rate clock. React rerenders only when the status string
// changes, rather than updating every panel's status DOM once a second.
const listeners = new Set();
let timer;
const subscribe = listener => {
  listeners.add(listener);
  timer ||= setInterval(() => { if (!document.hidden) listeners.forEach(notify => notify()); }, 1000);
  return () => { listeners.delete(listener); if (!listeners.size) { clearInterval(timer); timer = null; } };
};
function DataStatus({ names }) {
  const { getBuffer, status } = useTelemetry();
  const snapshot = () => names.map(name => streamStatus(getBuffer(name), status, performance.now())).join('|');
  const statuses = useSyncExternalStore(subscribe, snapshot, snapshot).split('|');
  const counts = {};
  for (const state of statuses) counts[state] = (counts[state] || 0) + 1;
  const label = Object.entries(counts).map(([state, count]) => `${count} ${state.toLowerCase()}`).join(' · ');
  return <details className="data-status" data-stale={!!(counts.Stale || counts.Disconnected)}>
    <summary aria-label={`Data status: ${label}`}>{label}</summary>
    <ul>{names.map((name, index) => <li key={name}><span>{name}</span><strong>{statuses[index]}</strong></li>)}</ul>
  </details>;
}
export default memo(DataStatus, (before, after) => before.names.length === after.names.length && before.names.every((name, index) => name === after.names[index]));
