import { useTelemetry } from '../context/telemetryContext.jsx';
import { PANEL_LABEL } from '../lib/inferPanelType.js';
import Panel from './panel.jsx';
import { topicStyle } from '../lib/topicStyles.js';
import TopicSwatch from './topicSwatch.jsx';
import VehicleTag from './vehicleTag.jsx';

const DISPLAY_TYPES = new Set(['imu', 'scalar', 'vector', 'diagnostics', 'raw']);
const fmt = value => typeof value === 'number' ? (Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : String(value)) : String(value);
const xyz = vector => ['x', 'y', 'z'].map(axis => `${axis}: ${fmt(vector?.[axis] ?? '—')}`).join('  ');

// Bounded traversal: never stringify a camera-sized array or arbitrary whole message.
function preview(value, depth = 0) {
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 2) return '[…]';
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const head = Array.from(value.slice(0, 8), item => preview(item, depth + 1));
    if (value.length > 8) head.push(`… ${value.length - 8} more`);
    return head;
  }
  return Object.fromEntries(Object.keys(value).slice(0, 12).map(key => [key, preview(value[key], depth + 1)]));
}

function MessageSummary({ msg, kind }) {
  if (!msg) return <span className="text-dim">Waiting for data</span>;
  if (kind === 'imu') return <dl className="topic-values">
    <div><dt>Acceleration · m/s²</dt><dd>{xyz(msg.linear_acceleration)}</dd></div>
    <div><dt>Angular velocity · rad/s</dt><dd>{xyz(msg.angular_velocity)}</dd></div>
    <div><dt>Quaternion · x y z w</dt><dd>{msg.orientation_covariance?.[0] === -1 ? 'Not provided' : ['x', 'y', 'z', 'w'].map(k => fmt(msg.orientation?.[k] ?? '—')).join('  ')}</dd></div>
  </dl>;
  if (kind === 'scalar') return <div className="topic-scalar mono">{fmt(msg.data)}</div>;
  if (kind === 'vector') return <pre>{JSON.stringify(preview(msg.data ?? msg.vector ?? msg), null, 2)}</pre>;
  if (kind === 'diagnostics') return <div className="diagnostic-list">
    {(msg.status || []).slice(0, 20).map((item, index) => <div key={index} className={`diagnostic-level-${item.level}`}>
      <strong>{['OK', 'Warning', 'Error', 'Stale'][item.level] || 'Unknown'}</strong> {String(item.name).slice(0, 160)}<br />{String(item.message || '').slice(0, 240)}
    </div>)}
    {msg.status?.length > 20 && <span>{msg.status.length - 20} additional entries omitted</span>}
  </div>;
  return <pre>{JSON.stringify(preview(msg), null, 2)}</pre>;
}

export default function TopicDetailsPanel() {
  const { selected, classify, getBuffer } = useTelemetry(500);
  const topics = selected.filter(t => DISPLAY_TYPES.has(classify(t.name)));
  return <Panel title="Sensor readings & messages" padded>
    <div className="topic-details">
      {topics.map(topic => {
        const kind = classify(topic.name);
        return <article key={topic.name} className="topic-detail" data-topic={topic.name} style={{ '--topic-color': topicStyle(topic.name).color }}>
          <div className="topic-detail-heading"><strong className="mono" title={topic.name}><VehicleTag name={topic.name} /><TopicSwatch name={topic.name} />{topicStyle(topic.name).sourceLabel}</strong><span>{PANEL_LABEL[kind]}</span></div>
          <MessageSummary kind={kind} msg={getBuffer(topic.name).raw.at(-1)} />
        </article>;
      })}
    </div>
  </Panel>;
}
