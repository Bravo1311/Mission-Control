# Change history

## 2026-10-31 — Separate Mission Control workspace

- Refreshed the animated README SVG with alternating Mission and Analysis views, fleet colors, floating drone labels, overlaid instruments, configurable controls, and the local console. The preview uses illustrative simulated telemetry.
- Added a persistent Analysis/Mission control switch. Preserved the mounted Analysis grid, layout storage, panel visibility, and view settings. Shared the existing ROS connection, selected topics, and buffers; suspended high-rate subscriptions and sensor workers in inactive views.
- Added a dedicated responsive Mission layout with fleet/target selection, map/trajectory/flight/camera/lidar views, source-labelled target telemetry, a command dock, and an embedded console.
- Added locally configured ROS service calls and one-shot publications with exact namespace expansion, JSON validation, inline request review, one explicit send, bounded result logs, and no automatic retries or replay. Kept publications unconfirmed and timeout/disconnect outcomes unknown.
- Added local console commands and operational notes with separate Mission chat history. Reused the existing chat-session implementation without claiming an AI backend.
- Disabled automatic alert banners, panel wake-up, and hidden-panel alert monitoring at the operator's request. Manual comparison data and inline severity colors remain available.
- Added unit/browser coverage for command validation, exact target case, disconnection/timeout cleanup, review-before-send, no replay, separate histories, preserved Analysis geometry, inactive rendering, sensor cleanup, and phone layout.

## 2026-10-31 — Compact workspace and rendering performance

- Removed the redundant workspace title, source counters, display-count toolbar, and permanent trajectory-style explanation. Combined panel recovery and layout reset in one compact row and reduced the desktop header height.
- Cached floating drone-label dimensions, batched writes before initial measurements, avoided unchanged text/style/attribute writes, and replaced repeated placement sorting with a minimum-score scan. Resize/font/source changes still refresh label measurements.
- Deferred Plotly loading until a chart is viewed and froze chart redraws off screen, in Focus standby, or while the browser tab is hidden. Comparison calculations and alert monitoring continue.
- Replaced per-panel status timers with one shared clock and status-change subscriptions. Removed Night glow filters and used opacity for master/camera illumination.
- Added a repeatable synthetic browser performance profile (`npm run test:performance`) and retained source-color, label-boundary, camera, alert, and layout regression coverage.

## 2026-10-31 — Independent Night illumination and Focus

- Separated low-light styling from panel visibility. Night preserves the complete normal dashboard and layout, keeps streams active, and retains drone/source hues, line patterns, and labels across panels. Updated the map tiles, 3D scene, chart grid/text, and menus for low light.
- Added an independent Focus switch, with persistent per-panel Show/Blank choices in day or Night. Drone flight panels can also be blanked. Focus uses a temporary compact layout; exiting restores normal geometry. Normal layout editing remains available in Night.
- Added fine master dimming and a separately saved camera-image brightness control. Dimming does not affect transport or data.
- Added an always-accessible active-alert summary, Inspect, and acknowledgement that leaves ongoing faults active. Permanently hidden estimation panels retain a lightweight comparison monitor, and critical alerts override Focus standby.
- Added per-topic live/stale/waiting/connection indicators that continue to update during reception outages, and clearer camera paused/unavailable/stale captions.
- Added regression coverage for legacy preference migration, independent modes, saved Focus choices, exact layout/source-color preservation, idle stale-data detection, hidden-panel alert monitoring/acknowledgement, camera dimming, sensor suspension/wake, and reload persistence.

## 2026-10-31 — Focused night panel

- Reworked Night instruments around larger illuminated dials, fine bank/heading graduations, compact source readouts, and minimal panel chrome. Rebalanced contrast so markings remain readable against black faces; Night panel heights now follow the instrument footprint and source count rather than inheriting day sizing.
- Replaced stacked opacity/grayscale/sepia filters with almost-black surfaces and green instrument illumination, following the supplied dashboard reference. Green source shades, patterns, and marker shapes preserve overlay identity; amber/red remain alert colors. Added an adjustable 40–100% dimmer. The orange day theme and source palette are unchanged.
- Added a separate Night layout: essential flight panels first, automatic alert expansion, manually revealed panels, then compact standby headers. Day positions and sizes are preserved, and layout editing is disabled in Night mode.
- Added Show/Blank controls for nonessential panels. Standby bodies are inert and rendering sleeps; explicitly revealed sensor previews resume normally. Critical estimation alerts wake their panel automatically and return it to standby when clear.
- Saved mode and dimmer settings, applied them before app startup to avoid a day-theme flash, and reset manual reveals at the start of each Night session.
- Added tests for preference recovery, session resets, non-destructive Night layout, sensor wake/blank, essential visibility, alert wake-up, color preservation, phone layout, and reload persistence.

## 2026-10-31 — Simultaneous flight-state overlays

- Created an independent Flight state panel per drone namespace. Each panel overlays all selected sources for that drone on shared attitude/heading dials and speed scales, retaining source colors, patterns, marker shapes, and a readout-table legend.
- Made plain odometry long-dashed with hollow triangular markers, while fusion remains solid with filled diamonds. Added an explicit browser check and preview for `/drone_1/odometry` and `/drone_1/fusion/odom` sharing the same attitude and heading SVGs simultaneously.
- Added stable per-drone panel IDs and separate drag/resize, hidden-panel preferences, highlights, and speed ranges. Desktop defaults place drone panels side by side when space permits. Existing global flight-panel hide preferences are honored.
- Added hover, focus, and tap highlighting, preserved across panel hide/restore. Readouts include exact values and frame names for each source; missing fields remain blank and speed scales expand to contain valid values.
- Normalized valid orientation quaternions and rejected invalid/zero quaternions. Overlays use each topic's latest received values without averaging or applying frame/time alignment.
- Added checks for every source appearing on shared dials, missing fields, expanded scales, matching colors, highlighting, and selection/removal lifecycle. Hidden-panel controls remain available.

## 2026-10-30 — Consolidated instruments and hidden panels

- Consolidated flight instruments into one compact card per drone, with a source selector instead of repeating complete dials for every odometry topic. Fusion is the default; manual choices persist in the browser and removed sources fall back to an available topic. Missing fields remain explicitly unavailable.
- Added a hide control to each dashboard panel and a collapsible Hidden panels drawer with individual restore and Restore all actions. Visibility preferences persist across reloads and topic changes, with a recovery view when all panels are hidden.
- Hiding preserves topic selections, telemetry history, saved layout sizes, and key view settings while unmounting the visualization and releasing workers/renderers. Flight layout height now follows drone count instead of source count.
- Added preference/grouping tests and browser coverage for selecting sources, restoring view settings, sensor-worker cleanup, all-panels-hidden recovery, and saved visibility after reload.

## 2026-10-30 — Vehicle families in the trajectory viewer

- Retained the original orange interface accent and status colors. Vehicle data uses cyan, magenta, lime, gold, and further families, with a tighter source-shade range to preserve each group's identity and matching source patterns.
- Added floating vehicle/source tags to the 2D/3D trajectory stage and navigation map, with leader lines to actual positions, stable selection of an available source, panel bounds, and overlap reduction. Matching vehicle badges identify flight cards, sensor feeds, comparison roles/charts, readout cards, and legend groups.
- Centralized topic identity in `topicStyles.js` and applied exact colors across trajectories, map trails/markers, flight pointers/bars, comparison selectors, topic selection, readout cards, sensor labels, and lidar points. Map dashes and reusable source swatches follow the same source convention. Camera pixels are unchanged.
- Error traces follow the estimate's style across metrics and role swaps; removed the old per-panel indexed palette. Browser checks compare rendered colors and patterns across panels after selection changes and role swaps.
- Grouped trajectory legend entries by vehicle prefix, including nested `/fleet/drone_1/...` namespaces and case-insensitive visual grouping.
- Replaced selection-index colors with stable vehicle hues and source-specific shades. IMU / INS estimates use dots, GPS / GNSS / RTK estimates use dashes, fusion estimates use solid lines, and reference tracks use long dashes. Source conventions match across vehicles.
- Sorted vehicles naturally and sources consistently to make comparisons easier. Full topic names remain available on hover; subscriptions and coordinate frames are unchanged.
- Applied the same styles to the legend, latest-position markers, and both projections. Dash lengths follow zoom; position and distance buffers remain bounded and reused. The grouped legend scrolls within a capped height on small screens.
- Added focused grouping/style checks and desktop/mobile browser coverage with two vehicles, three source types, and selection changes.

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
