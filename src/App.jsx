import Topics from './components/topics'
import { TelemetryProvider, useTelemetry } from './context/telemetryContext'
import StateEstimatePanel from './components/stateEstimatePanel'
import GpsPanel from './components/gpsPanel'
import AttitudeIndicatorPanel from './components/attitudeIndicatorPanel'
import ErrorPanel from './components/errorPanel'
import EmptyState from './components/emptyState'
import DashboardGrid from './components/dashboardGrid'
import SensorPanel from './components/sensorPanel'
import TopicDetailsPanel from './components/topicDetailsPanel'
import ChatTerminal from './components/chatTerminal'
import './App.css'
import './mission.css'
import './night.css'


// Which panels exist is still decided here, same as before the grid —
// DashboardGrid itself knows nothing about ROS topics, it just arranges
// whatever panel list it's handed. Each panel also still independently
// returns null if it ends up with nothing to show (e.g. a GPS-classified
// topic whose buffer was just cleared), as a defensive second layer; this
// is the first layer, which is what actually keeps the grid from ever
// reserving space for a panel that has nothing to draw.
const DashboardBody = () => {
  const { selected, classify } = useTelemetry()

  if (selected.length === 0) {
    return <EmptyState />
  }

  const trajCount = selected.filter((t) => classify(t.name) === 'trajectory').length
  const hasGeo = selected.some((t) => ['geo', 'trajectory'].includes(classify(t.name)))

  const kinds = new Set(selected.map(t => classify(t.name)))
  const panels = [
    trajCount > 0 && { id: 'trajectory', node: <StateEstimatePanel /> },
    hasGeo && { id: 'gps', node: <GpsPanel /> },
    trajCount > 0 && { id: 'attitude', sourceCount: trajCount, node: <AttitudeIndicatorPanel /> },
    trajCount >= 2 && { id: 'error', node: <ErrorPanel /> },
    kinds.has('camera') && { id: 'camera', node: <SensorPanel kind="camera" /> },
    kinds.has('lidar') && { id: 'lidar', node: <SensorPanel kind="lidar" /> },
    ['imu', 'scalar', 'vector', 'diagnostics', 'raw'].some(k => kinds.has(k)) && { id: 'readings', node: <TopicDetailsPanel /> },
  ].filter(Boolean)

  if (panels.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-card">
          <h2>No visual panels yet</h2>
          <p>
            The selected topic(s) don't have a trajectory or GPS
            visualization in this build — try a nav_msgs/Odometry,
            PoseStamped, or NavSatFix topic.
          </p>
        </div>
      </div>
    )
  }

  return <DashboardGrid panels={panels} />
}

const MissionOverview = () => {
  const { selected, available } = useTelemetry()
  return (
    <div className="mission-overview">
      <div className="mission-heading"><h1>Telemetry workspace</h1><p>ROS 2 sensor monitoring</p></div>
      <dl className="mission-summary">
        <div><dt>Selected sources</dt><dd>{String(selected.length).padStart(2, '0')}</dd></div>
        <div><dt>Available topics</dt><dd>{String(available.length).padStart(2, '0')}</dd></div>
      </dl>
    </div>
  )
}

const App = () => {
  return (
    <TelemetryProvider>
      <div className="app-shell">
        <Topics />
        <main className="app-main">
          <MissionOverview />
          <DashboardBody />
        </main>
        <ChatTerminal />
      </div>
    </TelemetryProvider>
  )
}

export default App
