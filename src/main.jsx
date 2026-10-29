import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './index.css'
import App from './App.jsx'
import { loadBridgeUrl } from './lib/connectionConfig.js'

const bridgeUrl = await loadBridgeUrl(window.location)
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App bridgeUrl={bridgeUrl} />
  </StrictMode>,
)
