import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './index.css'
import App from './App.jsx'
import { loadBridgeUrl } from './lib/connectionConfig.js'
import { loadNightPreferences, applyNightPreferences } from './lib/nightPanel.js'
import { captureSnappyToken } from './lib/snappyTransport.js'

let nightPreferences
try { nightPreferences = loadNightPreferences(window.localStorage) } catch { nightPreferences = loadNightPreferences() }
applyNightPreferences(document.documentElement, nightPreferences)
// Also on hashchange: pasting the #snappy= link into a tab that is already open
// only changes the fragment and does not reload the page.
const takeSnappyToken = () => { try { captureSnappyToken({ storage: window.localStorage }) } catch { /* no stored token */ } }
takeSnappyToken()
window.addEventListener('hashchange', takeSnappyToken)
const bridgeUrl = await loadBridgeUrl(window.location)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App bridgeUrl={bridgeUrl} />
  </StrictMode>,
)
