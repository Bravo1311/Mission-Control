import { useTelemetry } from '../context/telemetryContext.jsx';

// Shown instead of a blank page whenever nothing is selected yet — walks a
// first-time user through the two steps required before any panel below
// has anything to draw.
const EmptyState = () => {
  const { status, available } = useTelemetry();
  const connected = status === 'connected';

  return (
    <div className="empty-state">
      <div className="empty-state-card">
        <div className="empty-state-icon"><span /></div>
        <h2>Awaiting telemetry</h2>
        <p>
          Connect your ROS bridge and select a source to populate the
          navigation, camera, lidar and sensor displays.
        </p>
        <div className="empty-state-steps">
          <div className={`empty-state-step ${connected ? 'done' : ''}`}>
            <span className="empty-state-step-index">{connected ? '✓' : '1'}</span>
            <span>
              {connected
                ? 'Connected to rosbridge.'
                : 'Open Topics and connect to a rosbridge WebSocket.'}
            </span>
          </div>
          <div className="empty-state-step">
            <span className="empty-state-step-index">2</span>
            <span>
              {connected
                ? `Select one or more of the ${available.length} discovered topics.`
                : 'Select the topics you want to visualize.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmptyState;
