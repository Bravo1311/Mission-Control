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
import { groupFlightTopics } from './lib/flightState.js'
import { flightPanelId } from './lib/panelPreferences.js'
import { WorkspaceActivityContext } from './context/workspaceActivity.js'
import { AUTO_ALERTS_ENABLED } from './lib/alertPolicy.js'
import './App.css'
import './mission.css'
import './night.css'
import './missionWorkspace.css'

const MissionWorkspace = lazy(() => import('./components/missionWorkspace.jsx'))


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

  const trajectoryTopics = selected.filter((t) => classify(t.name) === 'trajectory')
  const trajCount = trajectoryTopics.length
  const hasGeo = selected.some((t) => ['geo', 'trajectory'].includes(classify(t.name)))

  const kinds = new Set(selected.map(t => classify(t.name)))
  const panels = [
    trajCount > 0 && { id: 'trajectory', node: <StateEstimatePanel /> },
    hasGeo && { id: 'gps', node: <GpsPanel /> },
    ...groupFlightTopics(trajectoryTopics).map(group => ({ id: flightPanelId(group.key), kind: 'attitude', title: `Flight state · ${group.label}`,
      sourceCount: group.topics.length, node: <AttitudeIndicatorPanel group={group} /> })),
    trajCount >= 2 && { id: 'error', node: <ErrorPanel />, monitor: AUTO_ALERTS_ENABLED ? <ErrorPanel monitorOnly /> : null },
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

const App = ({ bridgeUrl }) => {
  const [workspace, setWorkspace] = useState(() => {
    try { return localStorage.getItem('mission-control.workspace.v1') === 'mission' ? 'mission' : 'analysis' } catch { return 'analysis' }
  })
  const [missionLoaded, setMissionLoaded] = useState(workspace === 'mission')
  const changeWorkspace = next => {
    if (!['analysis', 'mission'].includes(next)) return
    setWorkspace(next)
    if (next === 'mission') setMissionLoaded(true)
    try { localStorage.setItem('mission-control.workspace.v1', next) } catch { /* session only */ }
  }
  return (
    <TelemetryProvider bridgeUrl={bridgeUrl}>
      <div className="app-shell">
        <Topics workspace={workspace} onWorkspaceChange={changeWorkspace} />
        <WorkspaceActivityContext.Provider value={workspace === 'analysis'}>
          <main className="app-main" id="analysis-workspace" role="tabpanel" aria-labelledby="analysis-workspace-tab" hidden={workspace !== 'analysis'} data-workspace-active={workspace === 'analysis'}>
            <DashboardBody />
            <ChatTerminal />
          </main>
        </WorkspaceActivityContext.Provider>
        {missionLoaded && <WorkspaceActivityContext.Provider value={workspace === 'mission'}>
          <main className="mission-main" id="mission-workspace" role="tabpanel" aria-labelledby="mission-workspace-tab" hidden={workspace !== 'mission'} data-workspace-active={workspace === 'mission'}>
            <Suspense fallback={<div className="mission-loading">Opening Mission control…</div>}><MissionWorkspace /></Suspense>
          </main>
        </WorkspaceActivityContext.Provider>}
      </div>
    </TelemetryProvider>
  )
}

export default App
import { lazy, Suspense, useState } from 'react'
