import { useState, useMemo, useContext, useEffect } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { pos, orientation, velocityEnu, plotLayout } from '../lib/plotHelpers.js';
import { topicStyle, TOPIC_PLOT_DASHES } from '../lib/topicStyles.js';
import TopicSwatch from './topicSwatch.jsx';
import VehicleTag from './vehicleTag.jsx';
import { PanelActionsContext, usePanelPreference } from '../context/panelActions.js';
import { useNightPanelMode } from '../lib/useNightMode.js';
import ResponsivePlot from './responsivePlot.jsx';
import { chooseComparison } from '../lib/comparisonRoles.js';
import Panel from './panel.jsx';
import { AUTO_ALERTS_ENABLED } from '../lib/alertPolicy.js';

const MAX_PAIR_GAP_S = 0.5; // longest truth interval we'll interpolate across before treating it as an outage

// Each metric describes how to read a value out of a message (`get`), how to
// blend two of those values for interpolation (`blend`), and how to turn an
// (estimate, truth) pair into a scalar error (`error`). Severity thresholds
// are rough defaults for small-vehicle state estimation — [good below,
// warning below, else bad].
const lerpVec = (a, b, s) => ({
  x: a.x + (b.x - a.x) * s,
  y: a.y + (b.y - a.y) * s,
  z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * s,
});

// Normalized lerp between unit quaternions, flipping b onto a's hemisphere
// first (q and -q are the same rotation). Over the tens-of-milliseconds
// gaps between consecutive samples this is indistinguishable from slerp.
const nlerp = (a, b, s) => {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const q = {
    x: a.x + (sign * b.x - a.x) * s, y: a.y + (sign * b.y - a.y) * s,
    z: a.z + (sign * b.z - a.z) * s, w: a.w + (sign * b.w - a.w) * s,
  };
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};

// Smallest rotation between two unit quaternions: 2*acos(|a·b|). The
// absolute value is what makes q and -q read as zero error.
const angleBetween = (a, b) => {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
};

const vecDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

const METRICS = {
  pos: {
    label: 'Position', unit: 'm', yTitle: 'position error (m)', thresholds: [0.5, 2],
    get: pos, blend: lerpVec, error: vecDist,
  },
  ori: {
    label: 'Orientation', unit: '°', yTitle: 'orientation error (°)', thresholds: [2, 5],
    get: orientation, blend: nlerp, error: angleBetween,
  },
  vel: {
    label: 'Velocity', unit: 'm/s', yTitle: 'velocity error (m/s)', thresholds: [0.2, 1],
    get: velocityEnu, blend: lerpVec, error: vecDist,
  },
};

// For each estimate sample, interpolates the ground truth to that exact
// timestamp and measures the error against it. Interpolating (rather than
// grabbing the nearest truth sample) removes a timing error that scales
// with vehicle speed — at 5 m/s, being 20 ms off is 10 cm of fake "error".
// Estimates outside the time span the truth buffer actually covers are
// skipped, never extrapolated: right after subscribing, the two topics
// start filling at slightly different instants, and pairing those first
// samples with a truth sample hundreds of ms away produced a spurious spike.
// Also skipped: any truth interval longer than MAX_PAIR_GAP_S (a stalled
// topic), since interpolating across a real outage would invent data.
// Both buffers are time-sorted ascending (telemetryContext's trim
// guarantees it), so a single forward pointer keeps this O(n+m). Each
// metric gets its own series, since a message can carry position but no
// orientation (e.g. a GNSS fix) and shouldn't drop out of the others.
function pairedErrors(truthBuf, estBuf) {
  const series = Object.fromEntries(Object.keys(METRICS).map((k) => [k, { t: [], v: [] }]));
  const n = truthBuf.t.length;
  if (n < 2) return series;

  let j = 0;
  for (let i = 0; i < estBuf.t.length; i++) {
    const et = estBuf.t[i];
    if (et < truthBuf.t[0] || et > truthBuf.t[n - 1]) continue;
    while (j < n - 2 && truthBuf.t[j + 1] < et) j++;
    const t0 = truthBuf.t[j], t1 = truthBuf.t[j + 1];
    if (t1 - t0 > MAX_PAIR_GAP_S) continue;
    const s = t1 === t0 ? 0 : (et - t0) / (t1 - t0);

    for (const [key, m] of Object.entries(METRICS)) {
      const e = m.get(estBuf.raw[i]);
      const a = m.get(truthBuf.raw[j]);
      const b = m.get(truthBuf.raw[j + 1]);
      if (!e || !a || !b) continue;
      const v = m.error(e, m.blend(a, b, s));
      if (Number.isFinite(v)) { series[key].t.push(et); series[key].v.push(v); }
    }
  }
  return series;
}

const severity = (v, [good, warn]) => (v == null ? 'dim' : v < good ? 'success' : v < warn ? 'warning' : 'danger');

// Night panel alert: the worst error on ANY metric (not just the selected
// tab) over the last ALERT_WINDOW_S seconds of data. Looking at a trailing
// window instead of the latest sample is deliberate — it means a panel that
// relights stays lit for a few seconds rather than flickering on and off
// as the error hovers around a threshold. Only 'danger' relights it; a
// warning that's always on would defeat the point of a dark panel.
const ALERT_WINDOW_S = 5;
function criticalRecently(all) {
  for (const [key, { t, v }] of Object.entries(all)) {
    if (!t.length) continue;
    const cutoff = t[t.length - 1] - ALERT_WINDOW_S;
    let recentMax = -Infinity;
    for (let i = t.length - 1; i >= 0 && t[i] >= cutoff; i--) recentMax = Math.max(recentMax, v[i]);
    if (severity(recentMax, METRICS[key].thresholds) === 'danger') return true;
  }
  return false;
}

const StatTile = ({ label, value, metric }) => (
  <div className="stat-tile">
    <div className="stat-tile-label">{label}</div>
    <div className={`stat-tile-value mono stat-${severity(value, metric.thresholds)}`}>
      <span className="stat-severity-dot" aria-label={value == null ? 'No data' : `${severity(value, metric.thresholds)} display band`} />
      {value == null ? '—' : value.toFixed(metric.unit === '°' ? 1 : 2)}<span className="stat-unit">{metric.unit}</span>
    </div>
  </div>
);

const ErrorPanel = ({ monitorOnly = false }) => {
  const night = useNightPanelMode() !== 'off';
  const actions = useContext(PanelActionsContext);
  const { selected, classify, getBuffer } = useTelemetry(250);
  const trajTopics = selected.filter((t) => classify(t.name) === 'trajectory');
  const names = trajTopics.map((t) => t.name);

  const [metricKey, setMetricKey] = usePanelPreference('metric', 'pos');
  const [truthName, setTruthName] = usePanelPreference('reference', null);
  const [estimateName, setEstimateName] = usePanelPreference('estimate', null);

  // Re-pick defaults whenever the current selection stops making sense — a
  // topic was deselected, or this is the first time two are available —
  // but never clobber a choice the user is still able to make (both names
  // still present in `names` means leave it alone). Adjusted directly
  // during render (React's documented pattern for "reset state when an
  // input changes") rather than in an effect, which would cost an extra
  // commit+paint before the correct selection ever reached the screen.
  const [namesKey, setNamesKey] = useState('');
  const nextNamesKey = names.join(',');
  if (nextNamesKey !== namesKey) {
    setNamesKey(nextNamesKey);
    const next = chooseComparison(names, truthName, estimateName);
    setTruthName(next.truth);
    setEstimateName(next.estimate);
  }

  const truthBuffer = getBuffer(truthName);
  const estimateBuffer = getBuffer(estimateName);
  const truthVersion = truthBuffer.version;
  const estimateVersion = estimateBuffer.version;
  const all = useMemo(() => {
    // Versions change when these mutable buffers receive samples.
    void truthVersion; void estimateVersion;
    return pairedErrors(truthBuffer, estimateBuffer);
  }, [truthBuffer, estimateBuffer, truthVersion, estimateVersion]);

  const critical = AUTO_ALERTS_ENABLED && trajTopics.length >= 2 && criticalRecently(all);
  useEffect(() => { actions?.reportAlert(critical ? 'danger' : undefined, 'Estimation error'); }, [actions, critical]);

  if (monitorOnly || trajTopics.length < 2 || !truthName || !estimateName) return null;

  const metric = METRICS[metricKey];
  const { t, v: err } = all[metricKey];
  const current = err.length ? err[err.length - 1] : null;
  const mean = err.length ? err.reduce((a, b) => a + b, 0) / err.length : null;
  const rmse = err.length ? Math.sqrt(err.reduce((a, b) => a + b * b, 0) / err.length) : null;
  const max = err.length ? Math.max(...err) : null;
  const truthStyle = topicStyle(truthName), estimateStyle = topicStyle(estimateName);

  const trace = [{
    x: t, y: err, mode: 'lines',
    line: { color: estimateStyle.color, width: 2, dash: TOPIC_PLOT_DASHES[estimateStyle.pattern] },
    fill: 'tozeroy', fillcolor: estimateStyle.fill,
  }];
  const layout = plotLayout({
    font: { color: night ? '#90ae8d' : '#a0b1c2', size: 11 },
    uirevision: `${truthName}:${estimateName}:${metricKey}`,
    margin: { l: 60, r: 22, t: 18, b: 48 },
    xaxis: { title: { text: 'Elapsed time (s)' }, gridcolor: night ? '#18251a' : '#2b3643', zeroline: false },
    yaxis: { title: { text: metric.yTitle }, gridcolor: night ? '#18251a' : '#2b3643', rangemode: 'tozero', zerolinecolor: night ? '#304633' : '#465362' },
  });

  return (
    <Panel
      className="estimation-panel"
      title="Estimation error"
      subtitle="Time-aligned reference and estimate comparison"
      icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4v16h16M7 14l4-5 4 3 5-7"/><path d="M7 17h13" strokeDasharray="2 2"/></svg>}
      padded
      alert={critical ? 'danger' : undefined}
      sources={[truthName, estimateName]}
      controls={
        <>
          <div className="segmented" role="tablist">
            {Object.entries(METRICS).map(([key, m]) => (
              <button
                key={key} role="tab" aria-selected={key === metricKey}
                className={key === metricKey ? 'active' : ''}
                onClick={() => setMetricKey(key)}
              >{m.label}</button>
            ))}
          </div>

        </>
      }
    >
      <div className="error-comparison">
        <label style={{ '--comparison-color': truthStyle.color }}><span className="comparison-role"><TopicSwatch name={truthName} />Reference <VehicleTag name={truthName} /></span>
          <select className="panel-select" aria-label="Reference topic" value={truthName} onChange={e => setTruthName(e.target.value)}>
            {names.map(n => <option key={n} value={n} disabled={n === estimateName}>{n}</option>)}
          </select>
        </label>
        <button className="chip-btn comparison-swap" title="Swap reference and estimate" aria-label="Swap reference and estimate" onClick={() => { setTruthName(estimateName); setEstimateName(truthName); }}>⇄</button>
        <label style={{ '--comparison-color': estimateStyle.color }}><span className="comparison-role"><TopicSwatch name={estimateName} />Estimate <VehicleTag name={estimateName} /></span>
          <select className="panel-select" aria-label="Estimate topic" value={estimateName} onChange={e => setEstimateName(e.target.value)}>
            {names.map(n => <option key={n} value={n} disabled={n === truthName}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="stat-tile-row">
        <StatTile label="Current" value={current} metric={metric} />
        <StatTile label="Mean error" value={mean} metric={metric} />
        <StatTile label="RMSE" value={rmse} metric={metric} />
        <StatTile label="Peak error" value={max} metric={metric} />
      </div>

      <div className="error-plot-stage" style={{ flex: 1, minHeight: 0 }}>
        <div className="error-plot-identity"><VehicleTag name={estimateName} /><span>{estimateStyle.sourceLabel} error</span></div>
        {err.length === 0 ? (
          <div className="emptyState">
            {metricKey === 'pos'
              ? 'No overlapping samples yet between these two topics.'
              : `No ${metric.label.toLowerCase()} data to compare — both topics need to publish ${metricKey === 'ori' ? 'an orientation' : 'a velocity'}.`}
          </div>
        ) : (
          <ResponsivePlot data={trace} layout={layout} />
        )}
      </div>
      <div className="error-chart-caption"><span>{err.length.toLocaleString()} paired samples · Line follows estimate color</span><span>Display bands: &lt;{metric.thresholds[0]} {metric.unit} / &lt;{metric.thresholds[1]} {metric.unit}</span></div>
    </Panel>
  );
};

export default ErrorPanel;
