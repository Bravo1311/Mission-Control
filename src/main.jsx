import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './index.css'
import App from './App.jsx'
import { loadBridgeUrl } from './lib/connectionConfig.js'
import { loadNightPreferences, applyNightPreferences } from './lib/nightPanel.js'

let nightPreferences
try { nightPreferences = loadNightPreferences(window.localStorage) } catch { nightPreferences = loadNightPreferences() }
applyNightPreferences(document.documentElement, nightPreferences)
const bridgeUrl = await loadBridgeUrl(window.location)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App bridgeUrl={bridgeUrl} />
  </StrictMode>,
)
