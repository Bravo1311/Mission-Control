# Change history

## 2026-10-29 — LAN access and mobile telemetry

This update builds on `d91c7d5`, which added the animated SVG to the README. It adds phone access over a local network and moves mobile camera preparation onto the host.

### LAN hosting

- Added `npm run serve:lan`: build the app and serve `dist` on port 4173, listening on all interfaces by default.
- Added `--host`, `--port`, `--bridge`, and `ROSBRIDGE_URL` configuration, plus printed local-network addresses. The default upstream remains `ws://127.0.0.1:2019`; pass port 9090 explicitly when that is where rosbridge runs.
- Added `/dashboard-config.json` so clients discover the same-origin `/rosbridge/preview` endpoint automatically. Generic static hosting falls back to the page hostname with bridge port 2019, including IPv6 formatting and WSS selection for HTTPS pages.
- Preserved `/rosbridge` as a byte-stream proxy for clients that need unchanged messages.
- Added correct static-file MIME types, immutable caching for built assets, uncached runtime configuration, GET/HEAD handling, path/symlink containment, and same-origin browser checks for WebSocket upgrades.
- Added connection timeouts, upstream failure responses, socket backpressure, and shutdown cleanup. The service hosts the dashboard and proxies an existing bridge; it does not start ROS or rosbridge.

### Mobile performance settings

- Added **Auto**, **Mobile**, and **Desktop** under Topics. Auto selects Mobile for a viewport at most 700 CSS pixels wide or a coarse primary pointer. Manual preferences persist in browser storage; unavailable or corrupt storage falls back to Auto.
- Mobile limits camera output to 640 × 360, nominal camera requests to 10 FPS, LaserScan requests to 2 Hz, and PointCloud2 requests to 1 Hz. Actual rates can be lower because of publisher rate, payload budgets, or processing load.
- Mobile caps lidar output at 3,000 points on a 480 × 480 canvas, instrument/trajectory updates at 10 Hz, and position history at 60 seconds / 600 samples. Scalar history retains its 20-second time window with the selected sample cap.
- Mobile trajectory drawing uses at most 300 samples, pixel ratio 1, and no antialiasing, with top-down XY as the initial projection. Both projections still use WebGL. Map trails use the same reduced sample budget.
- Switching presets trims retained histories immediately and updates subscriptions/render budgets. Desktop retains the previous larger limits.

### Bandwidth and visibility fixes

- Added an approximate 2 MiB/s aggregate payload budget shared across active Mobile camera/lidar feeds. Estimates account for JSON base64 expansion and round upward in 64 KiB buckets to reduce rate churn.
- New Mobile sensor subscriptions initially request a 3-second interval until a payload is measured. Subsequent intervals adapt to the observed payload and active sensor count, subject to the preset's nominal maximum rates.
- Mobile unsubscribes off-screen, hidden-tab, paused, and Night-mode sensor sources while retaining their selection and latest frame. Sources resume when visible/active again. Desktop retains the 1 Hz background subscription behavior.
- Visibility is established before activating a sensor subscription, avoiding unnecessary initial full-frame traffic for off-screen panels.
- Stabilized buffer access so unrelated context updates do not repeatedly recreate sensor workers.
- Added fractional display FPS and a stall timeout that scales with the requested interval, so intentionally slow previews are not immediately marked stalled.

### Host camera preparation

- Added a preview-aware WebSocket gateway at `/rosbridge/preview`. The app sends a private `mission_control_preview` profile message to this gateway; that message is consumed locally and never forwarded to rosbridge.
- In Mobile mode, raw and supported compressed camera images are resized on the host to fit within 640 × 360, preserving aspect ratio. Color is encoded as JPEG at quality 72; monochrome and depth display images become PNG. Desktop forwards original images.
- Depth previews retain the browser's existing fixed grayscale conventions: 16UC1 in millimetres and 32FC1 in metres mapped over 0–10 m, with invalid values black; mono16 uses its full intensity range. A PNG depth preview contains display intensities, not original depth measurements.
- Preserved original ROS topics, upstream message types, and frame headers. Only the browser's monitoring representation is changed. The camera panel continues to show one source at a time through its Source selector.
- Added one host encoding worker per preview connection, with one job in flight and no queued camera frames. Intermediate frames can be skipped. Source changes, profile changes, timeouts, and disconnects discard obsolete work.
- Preserved CBOR binary messages and JSON compatibility. Non-camera telemetry is forwarded while camera encoding runs. Late camera frames after unsubscribe are discarded instead of leaking full-resolution data to the phone.
- Added explicit runtime dependencies on `sharp`, `ws`, and `cbor2`, with the matching lockfile update. Image encoding is confined to the Node host; `sharp` is not shipped to the browser.

### Documentation and tests

- Expanded the README with hosting commands, bridge configuration, firewall/hotspot troubleshooting, mode budgets, camera preparation behavior, and limitations.
- Added [Networking from the beginning](docs/NETWORKING.md), a beginner guide to the implemented communication path and the camera bottleneck encountered during device testing.
- Added HTTP/proxy tests, performance/configuration tests, and color/depth preparation tests, including binary/JSON forwarding and dropping late full-resolution frames.
- Extended the real-browser harness with `--lan` / `npm run test:browser:lan`, saved preference checks, Mobile canvas/point budgets, visibility cleanup, and Night-mode throttling. It uses an isolated Chrome session and a mock bridge.

### Verification and observed behavior

- All 39 automated unit/integration tests passed; lint and production builds passed.
- The production LAN browser suite passed, retaining approximately 20 FPS Desktop camera throughput in its mock workload with bounded retained heap.
- Read-only checks against the live bridge showed both odometry streams advancing at approximately 10 Hz.
- Before host camera preparation, the live raw 1920 × 1080 RGB feed delivered roughly 56 MiB/s in a local browser test. The first Mobile guard reduced this to approximately 2 MiB/s and 0.3 FPS, which exposed the need to compress before Wi-Fi transmission.
- After host preparation, phone-sized browser checks using the LAN HTTP address showed color at approximately 9–10 FPS (640 × 360 JPEG, roughly 0.1 MiB/s in that scene) and depth at approximately 10 FPS (480 × 360 PNG), with no browser exceptions. These are observations from that setup, not guarantees for every scene, network, or phone.

### Limits to keep in mind

- The built-in host uses plain HTTP/WS and has no login. Use it on a trusted LAN. Public deployment needs authentication, access control, and HTTPS/WSS; an Origin check is not authentication.
- The payload budget is an average subscription-rate policy, not a hard traffic shaper. Startup/resubscription bursts and per-message overhead still exist.
- Host encoding reduces host-to-phone traffic. If rosbridge is on a separate robot, its raw camera traffic must still reach the host. The proxy does not downsample point clouds.
- Every browser has its own bridge connection, subscriptions, and optional encoding worker; additional viewers increase host/bridge load.
- The phone still decodes images and renders the dashboard. Real-device battery use, thermal behavior, and browser compatibility require device testing. Map tiles require internet access.
- This dashboard intentionally drops intermediate monitoring samples and does not replace lossless recording or full-resolution analysis.
