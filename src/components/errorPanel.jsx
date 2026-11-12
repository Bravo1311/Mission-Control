import { memo, useState, useContext, useEffect } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { plotLayout } from '../lib/plotHelpers.js';
import { topicStyle, TOPIC_PLOT_DASHES } from '../lib/topicStyles.js';
import TopicSwatch from './topicSwatch.jsx';
import VehicleTag from './vehicleTag.jsx';
import { PanelActionsContext, usePanelPreference } from '../context/panelActions.js';
import { useNightPanelMode } from '../lib/useNightMode.js';
import ResponsivePlot from './responsivePlot.jsx';
import { ERROR_METRICS, chooseGroundTruth, createErrorCalculator } from '../lib/estimationError.js';
import Panel from './panel.jsx';
import { AUTO_ALERTS_ENABLED } from '../lib/alertPolicy.js';

// Keep idle charts independent of unrelated telemetry refreshes. Cache entries
// and the comparisons array retain identity until one of their buffers changes.
const ErrorPlot = memo(function ErrorPlot({ comparisons, metricKey, night, groupKey, truthName }) {
  const metric = ERROR_METRICS[metricKey];
  const traces = comparisons.filter(item => item.stats[metricKey].count).map(item => {
    const style = topicStyle(item.name), series = item.plots[metricKey];
    return { name: style.sourceLabel, meta: { topic: item.name }, x: series.t, y: series.v, mode: 'lines',
      line: { color: style.color, width: 2, dash: TOPIC_PLOT_DASHES[style.pattern] },
      hovertemplate: `%{x:.2f} s · %{y:.${metric.unit === '°' ? 1 : 2}f} ${metric.unit}<extra>%{fullData.name}</extra>` };
  });
  const layout = plotLayout({
    font: { color: night ? '#90ae8d' : '#a0b1c2', size: 11 },
    uirevision: `${groupKey}:${truthName}:${metricKey}`,
    margin: { l: 58, r: 18, t: 16, b: 44 }, hovermode: 'x unified',
    xaxis: { title: { text: 'Elapsed time (s)' }, gridcolor: night ? '#18251a' : '#2b3643', zeroline: false },
    yaxis: { title: { text: metric.yTitle }, gridcolor: night ? '#18251a' : '#2b3643', rangemode: 'tozero', zerolinecolor: night ? '#304633' : '#465362' },
  });
  return traces.length ? <ResponsivePlot data={traces} layout={layout} /> : <div className="emptyState">
    {!comparisons.length ? 'Select another position topic for this drone in Topics to compare it with ground truth.'
      : metricKey === 'pos' ? 'Waiting for overlapping position samples. Sources must use the same coordinate frame.'
        : `No overlapping ${metric.label.toLowerCase()} samples. Sources without this field show — in the table.`}
  </div>;
});
const severity = (value, [good, warn]) => value == null ? 'dim' : value < good ? 'success' : value < warn ? 'warning' : 'danger';
function criticalRecently(comparisons) {
  return comparisons.some(({ all }) => Object.entries(all).some(([key, { t, v }]) => {
    const cutoff = t.at(-1) - 5;
    for (let i = t.length - 1; i >= 0 && t[i] >= cutoff; i--) {
      if (severity(v[i], ERROR_METRICS[key].thresholds) === 'danger') return true;
    }
    return false;
  }));
}

function ErrorValue({ value, metric, label }) {
  return <td className={`error-value stat-${severity(value, metric.thresholds)}`} data-stat={label}>
    <span className="stat-severity-dot" aria-label={value == null ? 'No data' : `${severity(value, metric.thresholds)} display band`} />
    {value == null ? '—' : value.toFixed(metric.unit === '°' ? 1 : 2)}
  </td>;
}

export default function ErrorPanel({ group, monitorOnly = false }) {
  const night = useNightPanelMode() !== 'off';
  const actions = useContext(PanelActionsContext);
  const { getBuffer } = useTelemetry(250);
  const [metricKey, setMetricKey] = usePanelPreference('metric', 'pos');
  const [preferredTruth, setPreferredTruth] = usePanelPreference('reference', null);
  const names = group.topics.map(topic => topic.name);
  const truthName = chooseGroundTruth(names, preferredTruth);
  // Remember a fallback so re-adding a removed topic cannot silently replace
  // a still-valid reference. Each grid panel owns its own preferences.
  useEffect(() => { if (truthName !== preferredTruth) setPreferredTruth(truthName); }, [truthName, preferredTruth, setPreferredTruth]);
  const [calculate] = useState(createErrorCalculator);
  const estimates = names.filter(name => name !== truthName);
  const comparisons = calculate(getBuffer(truthName), estimates.map(name => ({ name, buffer: getBuffer(name) })));
  const critical = AUTO_ALERTS_ENABLED && criticalRecently(comparisons);
  const title = `Estimation error · ${group.label}`;
  useEffect(() => { actions?.reportAlert(critical ? 'danger' : undefined, title); }, [actions, critical, title]);
  const metric = ERROR_METRICS[metricKey];
  const truthStyle = topicStyle(truthName);
  if (monitorOnly) return null;

  return <Panel className="estimation-panel" vehicle={group.key} title={title}
    subtitle="All selected estimates against one ground truth" padded alert={critical ? 'danger' : undefined} sources={names}
    controls={<div className="segmented" role="tablist" aria-label={`Error metric for ${group.label}`}>
      {Object.entries(ERROR_METRICS).map(([key, item]) => <button key={key} role="tab" aria-selected={key === metricKey}
        className={key === metricKey ? 'active' : ''} onClick={() => setMetricKey(key)}>{item.label}</button>)}
    </div>}>
    <div className="error-comparison">
      <label style={{ '--comparison-color': truthStyle.color }}><span className="comparison-role"><TopicSwatch name={truthName} />Ground truth <VehicleTag name={truthName} /></span>
        <select className="panel-select" aria-label={`Ground truth topic for ${group.label}`} value={truthName} onChange={event => setPreferredTruth(event.target.value)}>
          {names.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <p className="error-source-summary">{estimates.length} {estimates.length === 1 ? 'estimate' : 'estimates'}<span>Add sources in Topics to compare them here.</span></p>
    </div>
    {comparisons.length > 0 && <div className="error-readout-scroll" tabIndex={0} role="region" aria-label={`Error statistics for ${group.label}`}>
      <table className="error-readout-table" aria-label={`${metric.label} errors for ${group.label}`}>
        <thead><tr><th scope="col">Estimate</th>{['Current', 'Mean', 'RMSE', 'Peak'].map(label => <th scope="col" key={label}>{label} <span>({metric.unit})</span></th>)}<th scope="col">Pairs</th></tr></thead>
        <tbody>{comparisons.map(item => <tr className="error-source-row" key={item.name} data-topic={item.name} data-reference={truthName} data-vehicle={group.key}>
          <th scope="row"><span className="error-source-name" title={item.name}><TopicSwatch name={item.name} /><span>{topicStyle(item.name).sourceLabel}</span></span></th>
          {['current', 'mean', 'rmse', 'max'].map(key => <ErrorValue key={key} label={key} value={item.stats[metricKey][key]} metric={metric} />)}
          <td className="error-pair-count">{item.stats[metricKey].count.toLocaleString()}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <div className="error-plot-stage">
      <ErrorPlot comparisons={comparisons} metricKey={metricKey} night={night} groupKey={group.key} truthName={truthName} />
    </div>
    <div className="error-chart-caption"><span>Each line matches its source swatch. — means no paired data.</span><span>Aligned by reception time · same coordinate frame required</span></div>
  </Panel>;
}
