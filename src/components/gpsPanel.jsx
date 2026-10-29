import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { PALETTE, latLon, orientation, quaternionToEuler } from '../lib/plotHelpers.js';
import { sampleIndices } from '../lib/telemetryUpdates.js';
import Panel from './panel.jsx';

// A position ring and short bearing tick keep the map aligned with the
// trajectory viewer's point markers without suggesting a vehicle model.
const droneSvg = (color) => `
  <svg width="24" height="24" viewBox="-12 -12 24 24">
    <path d="M0 -10 V-5 M-3 -7 L0 -10 L3 -7" fill="none" stroke="${color}" stroke-width="1.5" />
    <circle r="4" fill="#10141a" stroke="${color}" stroke-width="1.75" />
    <circle r="1" fill="${color}" />
  </svg>
`;

const droneIcon = (color) => L.divIcon({
  className: 'drone-marker-icon',
  html: `<div class="drone-marker-rotor" >${droneSvg(color)}</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// ROS yaw (REP-103, ENU) -> on-screen rotation for an icon whose nose
// points up/north at 0°. Same conversion the Heading instrument uses —
// kept in sync with it rather than reusing its component, since this one
// feeds a Leaflet DOM transform, not an SVG.
const headingDeg = (msg) => {
  const q = orientation(msg);
  if (!q) return null;
  const { yaw } = quaternionToEuler(q);
  const yawDeg = (yaw * 180) / Math.PI;
  return ((90 - yawDeg) % 360 + 360) % 360;
};

const GpsPanel = () => {
  const { selected, classify, getBuffer, performance: profile } = useTelemetry(100);

  // This component decides for itself which topics belong on the map —
  // it isn't told by a parent. Same classify() every other panel uses,
  // just asking a different question of it (does this topic have
  // position data I can place on a real-world map).
  const topics = selected.filter((s) => ['geo', 'trajectory'].includes(classify(s.name)));

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layers = useRef({}); // topicName -> { trail, marker }
  const centered = useRef(false);

  // create the map once
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;
    const map = L.map(mapRef.current, { renderer: L.svg() }).setView([50.781020, 6.047028], 18); // Aachen default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    mapInstance.current = map;

    // Leaflet measures its container once, at creation. If the surrounding
    // layout hasn't finished sizing this panel yet at that exact moment, it
    // loads tiles for a too-small area and never backfills the rest. A
    // ResizeObserver re-measures whenever the container's real size
    // actually changes, whatever that timing turns out to be — more
    // reliable than guessing a fixed delay.
    let active = true;
    const ro = new ResizeObserver(() => { if (active) map.invalidateSize(); });
    ro.observe(mapRef.current);

    // Layers and the one-time auto-center belong to *this* map instance. If
    // the map is torn down and rebuilt (React StrictMode does exactly that
    // on every dev mount) while these refs survive, the update effect sees
    // layers it thinks already exist and keeps moving ones attached to the
    // destroyed map — so whichever topics were present at mount never drew.
    return () => {
      active = false;
      ro.disconnect();
      mapInstance.current = null;
      // Remove owned paths before their renderer and map are destroyed.
      // Trails remain bounded to 600 samples per topic with the SVG renderer.
      Object.values(layers.current).forEach(({ trail, marker }) => {
        trail.remove();
        marker.remove();
      });
      layers.current = {};
      map.remove();
      centered.current = false;
    };
  }, []);

  // update marker + trail per topic as new fixes arrive
  useEffect(() => {
    if (!mapInstance.current) return;

    // remove map layers for any topic that's no longer selected — same
    // leak class as the Three.js viewer: without this, every add/remove
    // cycle leaves orphaned trail/marker layers on the map forever
    const currentNames = new Set(topics.map((t) => t.name));
    Object.keys(layers.current).forEach((name) => {
      if (currentNames.has(name)) return;
      const { trail, marker } = layers.current[name];
      mapInstance.current.removeLayer(trail);
      mapInstance.current.removeLayer(marker);
      delete layers.current[name];
    });

    topics.forEach((t, i) => {
      const buf = getBuffer(t.name);
      const existing = layers.current[t.name];
      if (existing?.buffer === buf && existing.version === buf.version && existing.colorIndex === i) return;
      const last = buf.raw[buf.raw.length - 1];
      const lastLL = last ? latLon(last) : null;
      if (!lastLL) {
        // buffer was cleared (or never had valid data) — remove any existing
        // layer instead of leaving a stale marker/trail on the map
        if (layers.current[t.name]) {
          mapInstance.current.removeLayer(layers.current[t.name].trail);
          mapInstance.current.removeLayer(layers.current[t.name].marker);
          delete layers.current[t.name];
        }
        return;
      }
      const color = PALETTE[i % PALETTE.length];

      if (!layers.current[t.name]) {
        layers.current[t.name] = {
          trail: L.polyline([], { color, weight: 2, opacity: 0.9 }).addTo(mapInstance.current),
          marker: L.marker([lastLL.lat, lastLL.lon], { icon: droneIcon(color) })
            .addTo(mapInstance.current)
            .bindTooltip(t.name),
        };
      }

      const layer = layers.current[t.name];
      layer.buffer = buf;
      layer.version = buf.version;
      layer.colorIndex = i;
      const { trail, marker } = layer;
      marker.setLatLng([lastLL.lat, lastLL.lon]);
      trail.setLatLngs(
        sampleIndices(buf.raw.length, profile.trajectoryPoints).map((k) => latLon(buf.raw[k])).filter(Boolean).map((ll) => [ll.lat, ll.lon])
      );

      // Rotate just the inner wrapper, never the marker's own DOM node —
      // Leaflet drives that node's transform for positioning, and
      // overwriting it here would fight that every frame.
      const deg = headingDeg(last);
      if (deg !== null) {
        const rotor = marker.getElement()?.querySelector('.drone-marker-rotor');
        if (rotor) rotor.style.transform = `rotate(${deg}deg)`;
      }

      if (!centered.current) {
        mapInstance.current.setView([lastLL.lat, lastLL.lon], 18);
        centered.current = true; // only auto-center once, then let the user pan/zoom freely
      }
    });
  });

  return (
    // display:none (not unmounting) on purpose — the Leaflet instance below
    // is created once and kept alive across topic toggles so pan/zoom state
    // and the drawn trail survive a GPS topic being removed and re-added.
    <Panel title="Navigation map" subtitle="Georeferenced position history" icon={
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15" /></svg>
    } style={topics.length === 0 ? { display: 'none' } : undefined}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
    </Panel>
  );
};

export default GpsPanel;
