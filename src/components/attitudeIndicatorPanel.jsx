import { useId, useState } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { usePanelPreference } from '../context/panelActions.js';
import { flightReading, flightSpeedLimit } from '../lib/flightState.js';
import { TOPIC_DASHES } from '../lib/topicStyles.js';
import { formatReadout } from '../lib/comparisonRoles.js';
import TopicSwatch from './topicSwatch.jsx';
import VehicleTag from './vehicleTag.jsx';
import Panel from './panel.jsx';

const SIZE = 180, CENTER = 90, RADIUS = 80;
const RING = 'var(--dial-ring, #465361)', TICK = 'var(--dial-tick, #8292a5)', LABEL = 'var(--dial-label, #b8c5d3)';
const dash = track => TOPIC_DASHES[track.style.pattern]?.join(' ');
const opacity = (name, active) => !active || name === active ? 1 : 0.16;
const needleRadius = index => RADIUS - 9 - index % 4 * 4;
const ink = track => `var(--source-ink, ${track.style.color})`;
const nightInk = track => ({ '--source-night': track.style.nightColor });

function Marker({ track, x, y, size = 3 }) {
  const color = ink(track);
  if (track.style.sourceKind === 'imu') return <circle cx={x} cy={y} r={size} fill="var(--dial-face, #10141a)" stroke={color} strokeWidth="1.7" />;
  if (track.style.sourceKind === 'gps') return <rect x={x-size} y={y-size} width={size*2} height={size*2} fill="var(--dial-face, #10141a)" stroke={color} strokeWidth="1.7" />;
  if (track.style.sourceKind === 'odometry') return <path d={`M${x} ${y-size-1}L${x+size+1} ${y+size}H${x-size-1}Z`} fill="var(--dial-face, #10141a)" stroke={color} strokeWidth="1.7" />;
  return <path d={`M${x} ${y-size-1}l${size+1} ${size+1}-${size+1} ${size+1}-${size+1}-${size+1}Z`} fill={color} stroke="var(--dial-face, #10141a)" strokeWidth="0.7" />;
}

function Instrument({ label, count, children }) {
  return <section className="flight-overlay-instrument">
    <h3>{label}</h3>
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${label}: ${count} topic overlays`}>{children}</svg>
    <span className="flight-overlay-count">{count} {count === 1 ? 'source' : 'sources'}</span>
  </section>;
}

function AttitudeOverlay({ tracks, active }) {
  const clip = `flight-attitude-${useId()}`;
  const valid = tracks.filter(track => track.roll !== null && track.pitch !== null);
  return <Instrument label="Attitude" count={valid.length}>
    <defs><clipPath id={clip}><circle cx={CENTER} cy={CENTER} r={RADIUS-1} /></clipPath></defs>
    <g clipPath={`url(#${clip})`}>
      <path d={`M0 0H${SIZE}V${CENTER}H0Z`} fill="var(--dial-sky, #22313e)" />
      <path d={`M0 ${CENTER}H${SIZE}V${SIZE}H0Z`} fill="var(--dial-ground, #141c25)" />
      {[-30, -20, -10, 0, 10, 20, 30].map(degrees => <g key={degrees} opacity={degrees === 0 ? 0.7 : 0.4}>
        <line x1={CENTER-25} x2={CENTER+25} y1={CENTER-degrees*1.8} y2={CENTER-degrees*1.8} stroke={TICK} strokeWidth="0.8" />
        {degrees !== 0 && <text x={CENTER-29} y={CENTER-degrees*1.8+3} textAnchor="end" fill={LABEL} fontSize="8">{Math.abs(degrees)}</text>}
      </g>)}
      {valid.map((track, index) => <g className="flight-attitude-track" key={track.name} data-topic={track.name} style={nightInk(track)} opacity={opacity(track.name, active)}>
        <title>{`${track.name}: roll ${formatReadout(track.roll, 1)}°, pitch ${formatReadout(track.pitch, 1)}°`}</title>
        <g transform={`rotate(${-track.roll} ${CENTER} ${CENTER}) translate(0 ${track.pitch*1.8})`}>
          <line x1="-90" y1={CENTER} x2="270" y2={CENTER} stroke={ink(track)} strokeWidth={active === track.name ? 2.8 : 1.7} strokeDasharray={dash(track)} />
          <Marker track={track} x={CENTER+28+index%4*9} y={CENTER} />
        </g>
      </g>)}
    </g>
    {[-60, -30, 0, 30, 60].map(degrees => <g key={degrees} transform={`rotate(${degrees} ${CENTER} ${CENTER})`}>
      <line x1={CENTER} x2={CENTER} y1="10" y2="16" stroke={TICK} />
    </g>)}
    <g className="flight-night-markings" fill={LABEL} stroke={TICK}>
      {[-50, -40, -20, -10, 10, 20, 40, 50].map(degrees => <line key={degrees} x1={CENTER} x2={CENTER} y1="10" y2="13" transform={`rotate(${degrees} ${CENTER} ${CENTER})`} strokeWidth=".7" />)}
      {[-60, -30, 30, 60].map(degrees => <text key={degrees} x={CENTER + 69 * Math.sin(degrees * Math.PI / 180)} y={CENTER - 69 * Math.cos(degrees * Math.PI / 180) + 1} textAnchor="middle" fontSize="7" stroke="none">{Math.abs(degrees)}</text>)}
    </g>
    {valid.map((track, index) => <g key={track.name} className="flight-bank-marker" data-topic={track.name} style={nightInk(track)} transform={`rotate(${-track.roll} ${CENTER} ${CENTER})`} opacity={opacity(track.name, active)}>
      <Marker track={track} x={CENTER} y={CENTER-needleRadius(index)} />
    </g>)}
    <path d="M58 90h22l5 6h10l5-6h22" stroke="var(--dial-face, #10141a)" strokeWidth="5" fill="none" />
    <path d="M58 90h22l5 6h10l5-6h22" stroke="var(--dial-reference, #d3dce4)" strokeWidth="1.7" fill="none" />
    <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={RING} strokeWidth="1.5" />
  </Instrument>;
}

function HeadingOverlay({ tracks, active }) {
  const valid = tracks.filter(track => track.heading !== null);
  return <Instrument label="Heading" count={valid.length}>
    <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="var(--dial-face, #11171e)" stroke={RING} strokeWidth="1.5" />
    {Array.from({ length: 36 }, (_, index) => index * 10).map(degrees => <g key={degrees} transform={`rotate(${degrees} ${CENTER} ${CENTER})`}>
      <line x1={CENTER} x2={CENTER} y1="12" y2={degrees % 90 === 0 ? 24 : 17} stroke={TICK} strokeWidth={degrees % 90 === 0 ? 1.6 : 0.8} />
    </g>)}
    {[['N', 90, 37], ['E', 146, 94], ['S', 90, 150], ['W', 34, 94]].map(([label, x, y]) => <text key={label} x={x} y={y} textAnchor="middle" fill={LABEL} fontSize="12">{label}</text>)}
    <g className="flight-night-markings" fill={LABEL} stroke={TICK}>
      {Array.from({ length: 36 }, (_, index) => index * 10 + 5).map(degrees => <line key={degrees} x1={CENTER} x2={CENTER} y1="12" y2="15" transform={`rotate(${degrees} ${CENTER} ${CENTER})`} strokeWidth=".6" />)}
      {[30, 60, 120, 150, 210, 240, 300, 330].map(degrees => <text key={degrees} x={CENTER + 59 * Math.sin(degrees * Math.PI / 180)} y={CENTER - 59 * Math.cos(degrees * Math.PI / 180) + 3} textAnchor="middle" fontSize="8" stroke="none">{String(degrees).padStart(3, '0')}</text>)}
    </g>
    {valid.map((track, index) => <g key={track.name} className="flight-heading-track" data-topic={track.name} style={nightInk(track)} opacity={opacity(track.name, active)} transform={`rotate(${track.heading} ${CENTER} ${CENTER})`}>
      <title>{`${track.name}: ${formatReadout(track.heading, 1)}°`}</title>
      <line x1={CENTER} y1={CENTER+9} x2={CENTER} y2={CENTER-needleRadius(index)} stroke={ink(track)} strokeWidth={active === track.name ? 2.8 : 1.5} strokeDasharray={dash(track)} />
      <Marker track={track} x={CENTER} y={CENTER-needleRadius(index)} />
    </g>)}
    <circle cx={CENTER} cy={CENTER} r="3" fill="var(--dial-reference, #d3dce4)" stroke="var(--dial-face, #11171e)" />
  </Instrument>;
}

function SpeedOverlay({ tracks, active, metric, label, minimum, signed = false }) {
  const valid = tracks.filter(track => track[metric] !== null);
  const limit = flightSpeedLimit(valid.map(track => track[metric]), minimum);
  const position = value => 18 + (signed ? (value+limit)/(2*limit) : value/limit) * 324;
  return <section className="flight-overlay-speed">
    <h3>{label}<span>m/s</span></h3>
    <svg viewBox="0 0 360 86" role="img" aria-label={`${label}: ${valid.length} topic overlays, ${signed ? -limit : 0} to ${limit} metres per second`}>
      <line x1="18" x2="342" y1="37" y2="37" stroke={RING} strokeWidth="2" />
      {(signed ? [-limit, -limit/2, 0, limit/2, limit] : [0, limit/4, limit/2, limit*3/4, limit]).map(value => <g key={value}>
        <line x1={position(value)} x2={position(value)} y1="33" y2="42" stroke={TICK} />
        <text x={position(value)} y="70" textAnchor="middle" fill={LABEL} fontSize="10">{Number(value.toPrecision(4))}</text>
      </g>)}
      {valid.map((track, index) => <g key={track.name} className="flight-speed-marker" data-metric={metric} data-topic={track.name} style={nightInk(track)} opacity={opacity(track.name, active)}>
        <title>{`${track.name}: ${formatReadout(track[metric])} m/s`}</title>
        <line x1={position(track[metric])} x2={position(track[metric])} y1={13+index%4*5} y2="51" stroke={ink(track)} strokeWidth={active === track.name ? 2.8 : 1.5} strokeDasharray={dash(track)} />
        <Marker track={track} x={position(track[metric])} y={13+index%4*5} />
      </g>)}
    </svg>
  </section>;
}

export default function AttitudeIndicatorPanel({ group }) {
  const { getBuffer } = useTelemetry(50);
  const [pinned, setPinned] = usePanelPreference('highlightedTopic', null);
  const [hovered, setHovered] = useState(null);
  const tracks = group.topics.map(topic => flightReading(topic, getBuffer(topic.name).raw.at(-1)));
  if (!tracks.length) return null;
  const candidate = hovered || pinned;
  const active = tracks.some(track => track.name === candidate) ? candidate : null;
  return <Panel className="flight-state-panel" vehicle={group.key} sources={group.topics.map(topic => topic.name)} title={`Flight state · ${group.label}`} subtitle="This drone’s topics overlaid · latest received values" padded keepLit icon={
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h5l2 3h4l2-3h5M12 3v3m-3 2h6"/></svg>
  }>
    <div className="flight-overlay-gauges">
      <AttitudeOverlay tracks={tracks} active={active} />
      <HeadingOverlay tracks={tracks} active={active} />
      <div className="flight-overlay-speeds">
        <SpeedOverlay tracks={tracks} active={active} metric="ground" label="Ground speed" minimum={20} />
        <SpeedOverlay tracks={tracks} active={active} metric="vertical" label="Vertical speed" minimum={5} signed />
      </div>
    </div>
    <div className="flight-overlay-help"><span>{tracks.length} topics · Hover, focus or tap a source to highlight it</span><span>Line &amp; marker identify each source</span></div>
    <div className="flight-readout-scroll">
      <table className="flight-readout-table">
        <thead><tr><th scope="col">Source</th><th scope="col">Roll °</th><th scope="col">Pitch °</th><th scope="col">Heading °</th><th scope="col">Ground m/s</th><th scope="col">Vertical m/s</th><th scope="col">Frame</th></tr></thead>
        <tbody>{tracks.map(track => <tr className="flight-source-row" key={track.name} data-topic={track.name} data-vehicle={track.style.groupKey} style={nightInk(track)} data-highlighted={active === track.name ? 'true' : undefined}>
          <th scope="row"><button type="button" className="flight-source-highlight" aria-label={`Highlight ${track.name}`} aria-pressed={pinned === track.name} title={track.name}
            onMouseEnter={() => setHovered(track.name)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(track.name)} onBlur={() => setHovered(null)}
            onClick={() => setPinned(pinned === track.name ? null : track.name)} onKeyDown={event => { if (event.key === 'Escape') { setPinned(null); setHovered(null); } }}>
            <VehicleTag name={track.name} /><TopicSwatch name={track.name} /><span>{track.style.sourceLabel}</span>
          </button></th>
          {['roll', 'pitch', 'heading', 'ground', 'vertical'].map(metric => <td key={metric} data-metric={metric}>{formatReadout(track[metric], ['ground', 'vertical'].includes(metric) ? 2 : 1)}</td>)}
          <td className="flight-frame-cell" title={track.frame}>{track.waiting ? 'Waiting' : track.frame}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </Panel>;
}
