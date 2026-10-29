# Mission Control — ROS 2 telemetry dashboard

![Animated Mission Control dashboard showing trajectory, lidar, flight instruments, and estimation error](docs/assets/dashboard-preview.svg)

*Illustrative preview with simulated telemetry.*

Connect through **Topics**, enter a rosbridge WebSocket URL, and select the topics to display. Panels appear automatically; drag their handles or resize their lower-right corners. Camera and lidar each display one source at a time, chosen from their panel's source selector. Binary (CBOR) sensor transport is the default; use the panel's JSON compatibility option for older bridges. This shared transport setting applies to both sensor panels.

Read [Networking from the beginning](docs/NETWORKING.md) for the laptop-to-phone communication path and [Change history](CHANGELOG.md) for the full LAN/mobile update.

## Running and checks

```sh
npm install
npm run dev
npm run test
npm run lint
npm run build
npm run preview
```

Use the production preview when checking performance. `npm run test:browser` runs an isolated headless Chrome session against the built app and a mock rosbridge server; run `npm run build` first. It requires `google-chrome` on PATH, uses port 4189 for the preview and an ephemeral port for the bridge, and writes `/tmp/mission-sensor-preview.png`. It never connects to the robot. `npm run test:browser:dev` checks single-topic odometry selection, projection switches, and removal/reselection under the Vite development server and React StrictMode.

## Phone and local-network access

Start rosbridge on the PC or robot, then run:

```sh
npm run serve:lan
```

This builds the dashboard and starts a static HTTP server on port **4173**, listening on all network interfaces. Open the printed **Phone / LAN** address on a phone connected to the same reachable network. The PC must remain running; allow inbound TCP port 4173 in its firewall if needed. Guest Wi-Fi client isolation can prevent devices reaching each other.

The server forwards `/rosbridge/preview` to `ws://127.0.0.1:2019` by default. The dashboard fills in that same-origin proxy address automatically: open **Topics → Connect**. This endpoint prepares smaller camera images on the host when Mobile mode is active. The phone does not need direct access to the bridge port. Configure a different bridge machine, port, or path with:

```sh
npm run serve:lan -- --bridge ws://192.168.1.20:9090 --port 4173
```

`ROSBRIDGE_URL` also sets the upstream URL. Use `--host 192.168.1.10` to bind only a particular interface. To serve an existing build without rebuilding, run `node scripts/serve-lan.mjs` with the same options. The server supports binary CBOR and JSON and applies socket backpressure. The legacy `/rosbridge` endpoint remains an unchanged byte-stream proxy. The server does not launch ROS or rosbridge.

This HTTP service is intended for a trusted LAN and has no login. Keep it off the public internet. For encrypted access, place it behind an HTTPS reverse proxy that forwards WebSocket upgrades and preserves the original Host and Origin; the dashboard automatically uses WSS on HTTPS pages. On other static hosts, the default direct bridge URL uses the page hostname and port 2019; edit it in Topics as needed. Map tiles still require internet access.

### Mobile performance

**Topics → Performance** offers **Auto**, **Mobile**, and **Desktop**. Auto selects Mobile for screens at most 700 CSS pixels wide or devices with a coarse primary pointer. A manual choice is saved in that browser and takes effect immediately.

| Budget | Desktop | Mobile |
| --- | --- | --- |
| Camera output / requested rate | Up to 1280 × 720 / 20 FPS | Up to 640 × 360 / 10 FPS, further limited by payload size |
| LaserScan / PointCloud2 request rate | 5 Hz / 2 Hz | 2 Hz / 1 Hz |
| Lidar drawing | 12,000 points, 800 × 800 canvas | 3,000 points, 480 × 480 canvas |
| Instruments / trajectory updates | Up to 20 Hz | Up to 10 Hz |
| Position history | 120 seconds / 2,400 samples | 60 seconds / 600 samples |
| Trajectory rendering | 600 samples, pixel ratio ≤ 1.5 | 300 samples, pixel ratio ≤ 1, antialiasing off |

Mobile starts trajectories in top-down XY; both XY and 3D still use WebGL. Scalar history remains 20 seconds, with the selected preset's sample cap. Switching presets trims existing history immediately. Desktop requests off-screen, hidden-tab, paused and Night-mode sensor feeds at **1 Hz**. Mobile unsubscribes those sensor sources until they become visible/active again, preserving the selected topics and last frames. Decoding/drawing pauses in either mode; deselect a topic to release its retained frame entirely.

On the default `/rosbridge/preview` connection, **Mobile resizes camera images on the host before transmission**, preserving aspect ratio within 640 × 360. Color becomes JPEG (quality 72); monochrome/depth becomes PNG using the existing grayscale display scale. Depth PNG is a display visualization, not a depth measurement format. Original ROS topics and their data remain unchanged. Desktop forwards the original images. One host worker per connection processes at most one image at a time, skipping intermediate images; non-camera telemetry continues flowing during encoding. Source changes and disconnects discard obsolete work.

Mobile also shares an approximate **2 MiB/s payload budget** across active camera/lidar feeds, measured from what the browser actually receives (including base64 expansion in JSON mode). A new stream initially requests one frame every 3 seconds, then adjusts after measuring its payload. Host-compressed images can reach 10 FPS. With a direct bridge connection or the legacy `/rosbridge` proxy, raw images remain full-size on the wire: a raw 1920 × 1080 RGB image is about 6 MiB and therefore updates about once every 3 seconds with one sensor visible. This is an average subscription-rate guard, not a hard network shaper. Low rates are shown with fractional FPS and a rate-aware stall timeout.

The phone decodes and renders the smaller previews locally. Camera encoding uses the host CPU; raw image traffic still travels between rosbridge and the host, so prefer smaller/compressed publications when the robot-to-host link is constrained. Point clouds are not downsampled by the proxy; downsample them upstream to reduce their network and input-processing costs. Each open browser has its own subscriptions and settings. Mobile emulation tests verify budgets and layout, but real-device battery and thermal performance should be checked with your own telemetry.

`npm run test:browser:lan` runs the sensor/navigation browser checks through the actual LAN server and proxy against a mock rosbridge; build first. It also checks automatic mobile budgets and off-screen throttling.

## Agent terminal

Open **Agent terminal** in the lower-right corner to save notes and prompts. It starts in local mode; messages remain in this browser and are never automatically replayed when an agent is attached. History retains the latest 60 messages. If browser storage is unavailable, history lasts only for the current session. **Clear history** removes the saved conversation. Enter submits, Shift+Enter adds a line, and Escape closes the terminal and returns focus to its launcher.

To connect a backend, pass a stable transport object to `ChatTerminal` in `src/App.jsx`. `createHttpAgentTransport` from `src/lib/agentTransport.js` supplies a JSON adapter for a backend you provide:

```jsx
import { createHttpAgentTransport } from './lib/agentTransport';

// Create once outside the component, then pass to <ChatTerminal transport={agentTransport} />.
const agentTransport = createHttpAgentTransport('/api/agent/chat');
```

The endpoint receives `POST { messages: [{ role, content }], context }` and returns `{ content: string }`. Context contains only connection status and selected topic names/types. Keep model credentials and authentication on your backend. This project does not supply an agent endpoint.

Custom adapters implement `send({ messages, context, signal, onDelta })`, returning a response string, `{ content: string }`, or streaming text through `onDelta(text)` before resolving. **Stop**, clearing history, changing the adapter and unmounting abort the active request; adapters should honor the supplied `AbortSignal`. Late responses are ignored. Partial replies restored after a reload appear as stopped.

## Supported displays

| Messages | Display |
| --- | --- |
| Odometry, PoseStamped, PoseWithCovarianceStamped, custom GnssFix | Trajectory, map, flight instruments and estimation error |
| NavSatFix | Map |
| CompressedImage | JPEG/PNG camera preview |
| Image | rgb8, bgr8, rgba8, bgra8, mono8 / 8UC1, mono16, 16UC1, 32FC1 |
| LaserScan | Top-down lidar scan |
| PointCloud2 | Sampled XY projection; numeric x/y/z fields with offsets, row padding and byte order respected |
| Imu | Acceleration, angular velocity, quaternion readouts |
| Standard numeric / Bool, Vector3 / Vector3Stamped, numeric arrays | Current scalar/vector values |
| DiagnosticArray | Up to 20 named statuses with severity and messages |
| Other types | Bounded latest-message preview |

ROS 1-style `sensor_msgs/Image` and ROS 2-style `sensor_msgs/msg/Image` type names both work. Lidar views show the **message's own sensor frame**, with +X up and +Y left. They do not apply TF transforms, accumulate scans, deskew moving scans, or provide a 3D point-cloud view.

Raw depth uses a fixed grayscale display: 16UC1 is interpreted as millimetres and 32FC1 as metres, with 0–10 m mapped to black–white; verify those conventions for your publisher. Invalid depth is black. mono16 uses the full 0–65535 intensity range. `compressedDepth`, Bayer, YUV and compressed TIFF are not supported; an explanatory message appears instead of a broken image.

## Performance budgets

- Desktop bridge subscription requests: camera **20 Hz**, LaserScan **5 Hz**, PointCloud2 **2 Hz**, other topics **20 Hz**; Mobile uses the lower rates and payload budget above. Outgoing subscription queue length is **1**. Desktop limits selected camera/lidar sources that are not currently displayed, including paused previews, to **1 Hz**; Mobile stops those subscriptions until displayed again. These are display feeds, not lossless recordings.
- Camera, lidar, IMU, vector, diagnostics and raw-message topics retain **only their latest message**. Desktop trajectory/map buffers retain up to 120 seconds / 2,400 samples; scalar buffers retain up to 20 seconds / 2,400 samples. Mobile lowers these limits as listed above.
- One worker per visible sensor panel category, at most one decoding job in flight per worker. Intermediate frames are skipped; no pending frame queue accumulates. Workers terminate on source changes, pause and unmount; transferred image bitmaps are closed after drawing.
- Decode/render work pauses off-screen, in hidden browser tabs and in Night mode. **Pause lowers that source to 1 Hz on Desktop and stops its subscription on Mobile.** Deselect a topic in Topics to release its retained frame as well.
- Camera drawing is synchronized to browser paint, capped near 20 FPS on Desktop and 10 FPS on Mobile, with one frame in flight. The caption reports display FPS, worker decode time, incoming (RX) FPS and approximate decoded-payload MiB/s. The stall timeout is at least 1.5 seconds and increases for intentionally slow subscription rates; it is distinct from slow drawing.
- Camera output is capped at **1280 × 720**; sensor binary inputs at **16 MiB**; camera inputs at **16 megapixels**; LaserScan inputs at one million rays. Oversized messages are replaced with a small error record after receipt. JPEG/PNG dimensions are checked before browser image decoding.
- Lidar decoding samples at most **12,000 points**, rendered on an 800 × 800 canvas. Subsampling can omit small obstacles; this is a monitoring preview.
- Heavy frames stay outside React state. Readings update at 2 Hz; other panels use independent bounded update cadences. Chart-library loading is deferred until a plot is actually needed.

The binary transport avoids base64 expansion and conversion for sensor byte arrays; it does not JPEG-compress raw images. Incoming network traffic and transport decoding still occur before the input guard. For high-resolution cameras, prefer a compressed JPEG/PNG topic; downsample large clouds at the ROS publisher and subscribe only to sources you need. Browser-side sampling cannot reduce bytes already sent over the network. This dashboard is not a replacement for rosbag recording or full-resolution analysis.

## Message format references

Decoding follows the ROS definitions for [Image](https://github.com/ros2/common_interfaces/blob/rolling/sensor_msgs/msg/Image.msg), [CompressedImage](https://github.com/ros2/common_interfaces/blob/rolling/sensor_msgs/msg/CompressedImage.msg), [LaserScan](https://github.com/ros2/common_interfaces/blob/rolling/sensor_msgs/msg/LaserScan.msg), and [PointCloud2](https://github.com/ros2/common_interfaces/blob/rolling/sensor_msgs/msg/PointCloud2.msg).

## Workspace layout

Sensor panels share a source row, a compact Settings menu for transport, and four status readouts: Display, Incoming, Decode and Payload. The automatic layout adapts camera/lidar proportions to the viewport and stacks displays on narrower screens. Drag or resize a panel to save a custom arrangement; Auto layout restores the defaults. The refreshed layout uses a new storage key; earlier arrangements remain stored under the previous key.

Flight state groups each trajectory source into a card with attitude, heading, and digital ground/vertical speed readouts. Neutral scales use the shared topic color only for pointers and bars. The estimation panel requires distinct reference and estimate sources and provides an explicit swap control; display-band thresholds remain visual defaults.

The trajectory viewer shares a lightweight WebGL stage between orthographic 3D and top-down XY modes. Fit tracks frames the retained history; dragging or zooming retains manual camera control until you fit again. Thin lines show sampled histories, and fixed-size rings mark the newest positions. Grid spacing and its reference Z plane are listed beneath the view; moving the cursor over the stage reads X/Y at that grid plane. Coordinates remain in each topic's frame, without TF transforms. The renderer draws only when data, camera, size or visibility changes and disposes its graphics resources on mode changes/unmount.
