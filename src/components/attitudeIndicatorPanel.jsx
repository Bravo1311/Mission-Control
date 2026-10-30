import { memo, useId } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { orientation, quaternionToEuler, horizontalSpeed, verticalSpeed } from '../lib/plotHelpers.js';
import { topicStyle } from '../lib/topicStyles.js';
import TopicSwatch from './topicSwatch.jsx';
import VehicleTag from './vehicleTag.jsx';
import { formatReadout } from '../lib/comparisonRoles.js';
import Panel from './panel.jsx';

// Attitude and heading share one 140-unit coordinate space and render as
// width:100% SVGs, so they scale to whatever room the panel gives them
// (capped at MAX_GAUGE_PX) instead of sitting at a fixed size with dead
// space around them.
const SIZE = 140;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 4;
const PX_PER_DEG = 1.8;
const MAX_SPEED = 20; // m/s — tune to your typical flight envelope
const MAX_VSPEED = 5; // m/s climb/descent — tune separately, vertical rates are usually much smaller than ground speed
const MAX_GAUGE_PX = 160;

const FACE = '#11171e';
const RING = '#3b4857';
const TICK = '#8292a5';
const LABEL = '#c6cfd9';

const svgProps = {
  viewBox: `0 0 ${SIZE} ${SIZE}`,
  width: '100%',
  style: { display: 'block', margin: '0 auto', maxWidth: MAX_GAUGE_PX },
};

// Shared wrapper: label above, instrument, numeric readout below.
const Gauge = ({ label, readout, children }) => (
  <div className="gauge">
    <div className="gauge-label">{label}</div>
    <svg {...svgProps} role="img" aria-label={`${label}: ${readout}`}>{children}</svg>
    <div className="gauge-readout mono">{readout}</div>
  </div>
);

// ---------- Attitude indicator (roll/pitch) ----------
// Flat two-tone ADI: cool slate above the horizon, warm graphite below —
// low saturation so it sits inside the dashboard's own palette, but still
// readable as up/down at a glance. Labeled pitch ladder, a fixed roll scale
// on the bezel with a pointer that tracks bank angle, and a dark-outlined
// wing reference that holds up against either half.
const ROLL_TICKS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
const PITCH_LADDER = [-50, -40, -30, -20, -10, 10, 20, 30, 40, 50];

const Horizon = ({ roll, pitch, color }) => {
  const clipId = `horizon-clip-${useId()}`;
  const pitchOffset = Math.max(-60, Math.min(60, pitch)) * PX_PER_DEG;

  return (
    <Gauge label="Attitude" readout={`${formatReadout(roll, 1)}° / ${formatReadout(pitch, 1)}°`}>
      <defs>
        <clipPath id={clipId}><circle cx={CENTER} cy={CENTER} r={RADIUS - 1} /></clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <g transform={`rotate(${-roll} ${CENTER} ${CENTER}) translate(0 ${pitchOffset})`}>
          <rect x={CENTER - SIZE} y={CENTER - SIZE * 2} width={SIZE * 2} height={SIZE * 2} fill="#273b4b" />
          <rect x={CENTER - SIZE} y={CENTER} width={SIZE * 2} height={SIZE * 2} fill="#18212b" />
          <line x1={CENTER - SIZE} y1={CENTER} x2={CENTER + SIZE} y2={CENTER} stroke="#bac8d7" strokeWidth="1.5" />
          {PITCH_LADDER.map((d) => {
            const major = d % 20 === 0;
            const half = major ? 22 : 13;
            const y = CENTER - d * PX_PER_DEG;
            return (
              <g key={d}>
                <line x1={CENTER - half} y1={y} x2={CENTER + half} y2={y}
                      stroke="#bac8d7" strokeWidth={major ? 1.4 : 1} opacity="0.85" />
                {major && (
                  <>
                    <text x={CENTER - half - 4} y={y} fill="#bac8d7" fontSize="8" fontFamily="var(--mono)"
                          textAnchor="end" dominantBaseline="middle" opacity="0.8">{Math.abs(d)}</text>
                    <text x={CENTER + half + 4} y={y} fill="#bac8d7" fontSize="8" fontFamily="var(--mono)"
                          textAnchor="start" dominantBaseline="middle" opacity="0.8">{Math.abs(d)}</text>
                  </>
                )}
              </g>
            );
          })}
        </g>
      </g>

      {ROLL_TICKS.map((deg) => {
        const major = deg === 0 || Math.abs(deg) === 30 || Math.abs(deg) === 60;
        const rad = (deg * Math.PI) / 180;
        const outer = RADIUS - 2;
        const inner = major ? RADIUS - 9 : RADIUS - 6;
        return (
          <line key={deg}
                x1={CENTER + outer * Math.sin(rad)} y1={CENTER - outer * Math.cos(rad)}
                x2={CENTER + inner * Math.sin(rad)} y2={CENTER - inner * Math.cos(rad)}
                stroke="#bac8d7" strokeWidth={major ? 1.5 : 1} opacity="0.9" />
        );
      })}
      <g transform={`rotate(${-roll} ${CENTER} ${CENTER})`}>
        <polygon points={`${CENTER - 4},${CENTER - RADIUS + 11} ${CENTER + 4},${CENTER - RADIUS + 11} ${CENTER},${CENTER - RADIUS + 3}`} fill={color} />
      </g>

      <g strokeLinecap="round">
        <g stroke="#000000" strokeWidth="5.5">
          <line x1={CENTER - 30} y1={CENTER} x2={CENTER - 9} y2={CENTER} />
          <line x1={CENTER + 9} y1={CENTER} x2={CENTER + 30} y2={CENTER} />
          <line x1={CENTER - 9} y1={CENTER} x2={CENTER - 9} y2={CENTER + 6} />
          <line x1={CENTER + 9} y1={CENTER} x2={CENTER + 9} y2={CENTER + 6} />
        </g>
        <g stroke={color} strokeWidth="3">
          <line x1={CENTER - 30} y1={CENTER} x2={CENTER - 9} y2={CENTER} />
          <line x1={CENTER + 9} y1={CENTER} x2={CENTER + 30} y2={CENTER} />
          <line x1={CENTER - 9} y1={CENTER} x2={CENTER - 9} y2={CENTER + 6} />
          <line x1={CENTER + 9} y1={CENTER} x2={CENTER + 9} y2={CENTER + 6} />
        </g>
        <circle cx={CENTER} cy={CENTER} r="2.5" fill={color} stroke="#000000" strokeWidth="1" />
      </g>

      <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={RING} strokeWidth="2" />
    </Gauge>
  );
};

// ---------- Heading indicator (yaw) — rotating compass card, fixed top index ----------
const HEADING_LABELS = [
  { deg: 0, text: 'N' }, { deg: 90, text: 'E' }, { deg: 180, text: 'S' }, { deg: 270, text: 'W' },
];

const Heading = ({ yawDeg, color }) => {
  // ROS yaw (REP-103, ENU): 0 = facing +X (East), increases counter-clockwise.
  // Compass heading: 0 = North, increases clockwise — genuinely different
  // conventions, requiring both an offset and a direction flip to convert.
  const norm = ((90 - yawDeg) % 360 + 360) % 360;

  return (
    <Gauge label="Heading" readout={`${formatReadout(norm, 1)}°`}>
      <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={FACE} stroke={RING} strokeWidth="2" />
      <g transform={`rotate(${-norm} ${CENTER} ${CENTER})`}>
        {Array.from({ length: 36 }, (_, i) => i * 10).map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const outer = RADIUS - 3;
          const inner = deg % 90 === 0 ? RADIUS - 13 : deg % 30 === 0 ? RADIUS - 9 : RADIUS - 6;
          return (
            <line key={deg}
                  x1={CENTER + outer * Math.cos(rad)} y1={CENTER + outer * Math.sin(rad)}
                  x2={CENTER + inner * Math.cos(rad)} y2={CENTER + inner * Math.sin(rad)}
                  stroke={TICK} strokeWidth={deg % 90 === 0 ? 1.8 : 1} />
          );
        })}
        {HEADING_LABELS.map(({ deg, text }) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const r = RADIUS - 24;
          return (
            <text key={text} x={CENTER + r * Math.cos(rad)} y={CENTER + r * Math.sin(rad)}
                  fill={text === 'N' ? color : LABEL} fontSize="12" fontWeight="700"
                  textAnchor="middle" dominantBaseline="middle"
                  transform={`rotate(${norm} ${CENTER + r * Math.cos(rad)} ${CENTER + r * Math.sin(rad)})`}>
              {text}
            </text>
          );
        })}
      </g>
      <polygon points={`${CENTER - 5},6 ${CENTER + 5},6 ${CENTER},15`} fill={color} />
      <circle cx={CENTER} cy={CENTER} r="2.5" fill={color} />
    </Gauge>
  );
};

// Two digital strips replace the redundant circular speed scales. The signed
// vertical-speed bar remains centered on zero; display limits never clip values.
const SpeedReadout = memo(function SpeedReadout({ label, value, limit, signed = false, color }) {
  const ratio = Number.isFinite(value) ? Math.max(signed ? -1 : 0, Math.min(1, value / limit)) : 0;
  const left = signed ? (ratio < 0 ? 50 + ratio * 50 : 50) : 0;
  const width = Math.abs(ratio) * (signed ? 50 : 100);
  return (
    <div className="flight-speed">
      <div className="flight-speed-label">{label}</div>
      <div className="flight-speed-value mono">{formatReadout(value)} <span>m/s</span></div>
      <div className={`flight-speed-track${signed ? ' is-signed' : ''}`} aria-hidden="true">
        <span style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }} />
      </div>
      <div className="flight-speed-scale" aria-hidden="true"><span>{signed ? `−${limit}` : '0'}</span>{signed && <span>0</span>}<span>{signed ? '+' : ''}{limit} m/s</span></div>
    </div>
  );
});

const AttitudeIndicatorPanel = () => {
  const { selected, classify, getBuffer } = useTelemetry(50);
  const trajTopics = selected.filter((t) => classify(t.name) === 'trajectory');

  const withData = trajTopics
    .map((t) => {
      const buf = getBuffer(t.name);
      const last = buf.raw[buf.raw.length - 1];
      if (!last) return null;
      const q = orientation(last);
      const hSpd = horizontalSpeed(last);
      const vSpd = verticalSpeed(last);
      if (!q && hSpd === null) return null; // nothing to show for this topic
      return { topic: t, frame: last.header?.frame_id, euler: q ? quaternionToEuler(q) : null, hSpd, vSpd };
    })
    .filter(Boolean);

  if (withData.length === 0) return null;

  const deg = (rad) => (rad * 180) / Math.PI;

  return (
    <Panel className="flight-state-panel" title="Flight state" subtitle="Attitude, heading & velocity by source" padded keepLit icon={
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h5l2 3h4l2-3h5M12 3v3m-3 2h6"/></svg>
    }>
      <div className="vehicle-grid">
        {withData.map(({ topic, frame, euler, hSpd, vSpd }) => {
          const { color } = topicStyle(topic.name);
          return (
            <section key={topic.name} className="flight-source-card" data-topic={topic.name} style={{ '--series-color': color }}>
              <header className="flight-source-header">
                <TopicSwatch name={topic.name} />
                <VehicleTag name={topic.name} />
                <span className="mono flight-source-name" title={topic.name}>{topicStyle(topic.name).sourceLabel}</span>
                {frame && <span className="flight-frame" title={`Coordinate frame: ${frame}`}>{frame}</span>}
              </header>
              <div className="flight-card-body" data-has-attitude={!!euler}>
                {euler && <Horizon roll={deg(euler.roll)} pitch={deg(euler.pitch)} color={color} />}
                {euler && <Heading yawDeg={deg(euler.yaw)} color={color} />}
                <div className="flight-readouts">
                  {hSpd !== null && <SpeedReadout label="Ground speed" value={hSpd} limit={MAX_SPEED} color={color} />}
                  {vSpd !== null && <SpeedReadout label="Vertical speed" value={vSpd} limit={MAX_VSPEED} signed color={color} />}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
};

export default AttitudeIndicatorPanel;
