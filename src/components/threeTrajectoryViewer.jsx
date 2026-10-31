import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sampleIndices } from '../lib/telemetryUpdates.js';
import { pos } from '../lib/plotHelpers.js';
import { TOPIC_DASHES } from '../lib/topicStyles.js';
import { finitePosition, trajectoryFit, boundsWithOrigin } from '../lib/trajectoryView.js';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { createVehicleLabels } from '../lib/vehicleLabels.js';
import { panelIsAwake } from '../lib/nightPanel.js';

const CAPACITY = 600;
const dispose = object => object.traverse(item => {
  item.geometry?.dispose();
  (Array.isArray(item.material) ? item.material : [item.material]).forEach(material => material?.dispose());
});

function positionTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(32, 32, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(32, 32, 5, 0, Math.PI * 2); ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

function referenceGrid(fit) {
  const group = new THREE.Group();
  const minor = [], major = [];
  const centerX = Math.round(fit.center[0] / fit.step) * fit.step;
  const centerY = Math.round(fit.center[1] / fit.step) * fit.step;
  const extent = fit.step * 10;
  const z = fit.plane - fit.step * 0.002;
  for (let i = -10; i <= 10; i++) {
    const target = i % 5 === 0 ? major : minor;
    const x = centerX + i * fit.step, y = centerY + i * fit.step;
    target.push(x, centerY - extent, z, x, centerY + extent, z);
    target.push(centerX - extent, y, z, centerX + extent, y, z);
  }
  for (const [points, opacity] of [[minor, 0.25], [major, 0.55]]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.LineBasicMaterial({ color: document.documentElement.dataset.night === 'on' ? '#29402c' : '#465361', transparent: true, opacity, depthWrite: false });
    group.add(new THREE.LineSegments(geometry, material));
  }
  return group;
}

// Both projections share one renderer and resource budget. No lights, shaded
// meshes, per-message React state, or perpetual animation loop are required.
export default function ThreeTrajectoryViewer({ topics, getBuffer, mode = '3d', fitToken = 0, onViewInfo }) {
  const { performance: profile } = useTelemetry();
  const mountRef = useRef(null);
  const guideRef = useRef(null);
  const emptyRef = useRef(null);
  const cursorRef = useRef(null);
  const originRef = useRef(null);
  const labelsRef = useRef(null);
  const apiRef = useRef(null);
  const inputRef = useRef({ topics, getBuffer, onViewInfo });
  useEffect(() => { inputRef.current = { topics, getBuffer, onViewInfo }; }, [topics, getBuffer, onViewInfo]);

  useEffect(() => {
    const el = mountRef.current;
    const empty = emptyRef.current;
    // React may detach refs before passive-effect cleanup (including StrictMode).
    // Keep the nodes owned by this setup instead of dereferencing refs on teardown.
    const cursor = cursorRef.current;
    const origin = originRef.current;
    empty.textContent = 'Waiting for position data';
    empty.hidden = false;
    origin.hidden = true;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: profile.mode !== 'mobile', alpha: false }); }
    catch {
      empty.hidden = false;
      empty.textContent = 'WebGL is unavailable. Enable browser hardware acceleration to view trajectories.';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
    renderer.setSize(Math.max(1, el.clientWidth), Math.max(1, el.clientHeight));
    renderer.domElement.setAttribute('aria-label', mode === '3d' ? 'Orthographic 3D position tracks' : 'Top-down XY position tracks');
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(document.documentElement.dataset.night === 'on' ? '#000' : '#10141a');
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.01, 10000);
    camera.up.set(...(mode === '2d' ? [0, 1, 0] : [0, 0, 1]));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    controls.enableRotate = mode === '3d';
    controls.screenSpacePanning = true;
    controls.minZoom = 0.02; controls.maxZoom = 500;
    if (mode === '2d') {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.touches.ONE = THREE.TOUCH.PAN;
    }
    const texture = positionTexture();
    const labels = createVehicleLabels(labelsRef.current);
    const entries = new Map();
    const positions = new Float32Array(CAPACITY * 3);
    let grid;
    let halfHeight = 10;
    let fitted = false;
    let gridPlaneZ = 0;
    let visible = true;
    let frame = null;
    let disposed = false;
    const axisNodes = [...guideRef.current.querySelectorAll('[data-axis]')];
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const inverse = new THREE.Quaternion();
    const direction = new THREE.Vector3();
    const originProjection = new THREE.Vector3();
    const labelProjection = new THREE.Vector3();
    const projection = () => {
      const aspect = Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight);
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
      camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
    };
    const render = () => {
      frame = null;
      if (disposed || !visible || document.hidden || !panelIsAwake(el)) return;
      const moved = controls.update();
      const unitsPerPixel = (camera.top - camera.bottom) / camera.zoom / Math.max(1, el.clientHeight);
      for (const entry of entries.values()) {
        const dash = TOPIC_DASHES[entry.pattern];
        if (dash) {
          entry.line.material.dashSize = dash[0] * unitsPerPixel;
          entry.line.material.gapSize = dash[1] * unitsPerPixel;
        }
      }
      renderer.render(scene, camera);
      const anchors = [];
      for (const entry of entries.values()) {
        labelProjection.fromBufferAttribute(entry.marker.geometry.attributes.position, 0).project(camera);
        anchors.push({ name: entry.name, style: entry.style,
          x: (labelProjection.x + 1) * el.clientWidth / 2, y: (1 - labelProjection.y) * el.clientHeight / 2,
          visible: Math.abs(labelProjection.x) <= 1 && Math.abs(labelProjection.y) <= 1 && Math.abs(labelProjection.z) <= 1 });
      }
      labels.update(anchors, el.clientWidth, el.clientHeight);
      originProjection.set(0, 0, 0).project(camera);
      const originVisible = fitted && Math.abs(originProjection.x) <= 1 && Math.abs(originProjection.y) <= 1 && Math.abs(originProjection.z) <= 1;
      origin.hidden = !originVisible;
      if (originVisible) {
        const x = (originProjection.x + 1) * el.clientWidth / 2;
        const y = (1 - originProjection.y) * el.clientHeight / 2;
        origin.style.left = `${x}px`;
        origin.style.top = `${y}px`;
        origin.dataset.align = x > el.clientWidth - 145 ? 'left' : 'right';
      }
      inverse.copy(camera.quaternion).invert();
      axisNodes.forEach((node, i) => {
        direction.copy(axes[i]).applyQuaternion(inverse);
        const length = Math.hypot(direction.x, direction.y);
        node.style.display = length < 0.1 ? 'none' : '';
        const x = 42 + direction.x * 25, y = 42 - direction.y * 25;
        const line = node.firstElementChild, label = node.lastElementChild;
        line.setAttribute('x2', x); line.setAttribute('y2', y);
        label.setAttribute('x', 42 + direction.x * 35); label.setAttribute('y', 42 - direction.y * 35);
      });
      if (moved) invalidate();
    };
    const invalidate = () => { if (!disposed && frame === null && visible && !document.hidden) frame = requestAnimationFrame(render); };
    controls.addEventListener('change', invalidate);
    const allBounds = () => {
      const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const entry of entries.values()) for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], entry.bounds.min[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], entry.bounds.max[axis]);
      }
      return bounds;
    };
    const fit = () => {
      if (disposed || !entries.size) return;
      const result = trajectoryFit(boundsWithOrigin(allBounds()), Math.max(1, el.clientWidth) / Math.max(1, el.clientHeight), mode);
      if (!result) return;
      const damping = controls.enableDamping;
      controls.enableDamping = false; controls.update();
      gridPlaneZ = result.plane;
      halfHeight = result.halfHeight;
      projection();
      const target = new THREE.Vector3(...result.center);
      const direction = mode === '2d' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, -1, 0.85).normalize();
      camera.position.copy(target).addScaledVector(direction, result.distance);
      camera.near = Math.max(0.001, result.radius / 1000);
      camera.far = Math.max(result.radius * 100, result.distance * 4);
      camera.zoom = 1; camera.updateProjectionMatrix();
      controls.target.copy(target); controls.update();
      controls.saveState(); controls.enableDamping = damping;
      if (grid) { scene.remove(grid); dispose(grid); }
      grid = referenceGrid(result); scene.add(grid);
      fitted = true;
      inputRef.current.onViewInfo?.({ step: result.step, plane: result.plane });
      invalidate();
    };
    apiRef.current = { fit };
    const ray = new THREE.Raycaster();
    const cursorPoint = new THREE.Vector3();
    const cursorNdc = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hideCursor = () => { cursor.hidden = true; };
    const locateCursor = event => {
      if (disposed || !fitted || event.buttons) { hideCursor(); return; }
      const rect = renderer.domElement.getBoundingClientRect();
      cursorNdc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      ray.setFromCamera(cursorNdc, camera); plane.constant = -gridPlaneZ;
      if (!ray.ray.intersectPlane(plane, cursorPoint)) { hideCursor(); return; }
      cursor.textContent = `Grid X ${cursorPoint.x.toFixed(2)} m · Y ${cursorPoint.y.toFixed(2)} m`;
      cursor.hidden = false;
    };
    renderer.domElement.addEventListener('pointermove', locateCursor);
    renderer.domElement.addEventListener('pointerleave', hideCursor);
    const update = () => {
      if (disposed || !visible || document.hidden || !panelIsAwake(el)) return;
      const { topics, getBuffer } = inputRef.current;
      const currentNames = new Set(topics.map(topic => topic.name));
      let changed = false;
      for (const [name, entry] of entries) if (!currentNames.has(name)) {
        scene.remove(entry.line, entry.marker); dispose(entry.line); dispose(entry.marker); entries.delete(name); changed = true;
      }
      topics.forEach(topic => {
        const buffer = getBuffer(topic.name);
        let entry = entries.get(topic.name);
        if (entry?.buffer === buffer && entry.version === buffer.version) return;
        const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        let count = 0;
        for (const i of sampleIndices(buffer.raw.length, profile.trajectoryPoints)) {
          const point = pos(buffer.raw[i]);
          if (!finitePosition(point)) continue;
          const values = [point.x, point.y, point.z ?? 0];
          values.forEach((value, axis) => {
            positions[count * 3 + axis] = value;
            bounds.min[axis] = Math.min(bounds.min[axis], value);
            bounds.max[axis] = Math.max(bounds.max[axis], value);
          });
          count++;
        }
        if (!count) {
          if (entry) { scene.remove(entry.line, entry.marker); dispose(entry.line); dispose(entry.marker); entries.delete(topic.name); changed = true; }
          return;
        }
        const { color, pattern } = topic.style;
        if (!entry) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage));
          if (pattern !== 'solid') geometry.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(CAPACITY), 1).setUsage(THREE.DynamicDrawUsage));
          const Material = pattern === 'solid' ? THREE.LineBasicMaterial : THREE.LineDashedMaterial;
          const line = new THREE.Line(geometry, new Material({ color }));
          line.frustumCulled = false;
          const markerGeometry = new THREE.BufferGeometry();
          markerGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3).setUsage(THREE.DynamicDrawUsage));
          const marker = new THREE.Points(markerGeometry, new THREE.PointsMaterial({ color, map: texture, size: 11, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false }));
          marker.frustumCulled = false;
          marker.renderOrder = 2;
          entry = { line, marker, pattern, name: topic.name, style: topic.style }; entries.set(topic.name, entry); scene.add(line, marker);
        }
        const attribute = entry.line.geometry.attributes.position;
        attribute.array.set(positions.subarray(0, count * 3));
        attribute.clearUpdateRanges(); attribute.addUpdateRange(0, count * 3); attribute.needsUpdate = true;
        entry.line.geometry.setDrawRange(0, count);
        if (pattern !== 'solid') {
          // Reuse the bounded GPU buffer rather than allocate a new attribute
          // on every telemetry tick (Line.computeLineDistances does the latter).
          const distances = entry.line.geometry.attributes.lineDistance;
          distances.array[0] = 0;
          for (let i = 1; i < count; i++) {
            const offset = i * 3;
            distances.array[i] = distances.array[i - 1] + Math.hypot(positions[offset] - positions[offset - 3], positions[offset + 1] - positions[offset - 2], positions[offset + 2] - positions[offset - 1]);
          }
          distances.clearUpdateRanges(); distances.addUpdateRange(0, count); distances.needsUpdate = true;
        }
        entry.line.material.color.set(color); entry.marker.material.color.set(color);
        entry.marker.geometry.attributes.position.array.set(positions.subarray((count - 1) * 3, count * 3));
        entry.marker.geometry.attributes.position.needsUpdate = true;
        Object.assign(entry, { bounds, buffer, version: buffer.version });
        changed = true;
      });
      empty.hidden = entries.size > 0;
      if (!entries.size) {
        if (fitted) inputRef.current.onViewInfo?.(null);
        fitted = false;
        if (grid) { scene.remove(grid); dispose(grid); grid = null; }
      }
      if (!fitted && entries.size) fit();
      else if (changed) invalidate();
    };
    // A neutral empty stage; the first actual position sample determines framing.
    camera.position.set(15, -15, 15); camera.lookAt(0, 0, 0); projection();
    const resize = new ResizeObserver(() => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h); projection(); invalidate();
    });
    resize.observe(el);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) { update(); invalidate(); }
    });
    intersection.observe(el);
    const wake = () => {
      const night = document.documentElement.dataset.night === 'on';
      scene.background.set(night ? '#000' : '#10141a');
      grid?.children.forEach(line => line.material.color.set(night ? '#29402c' : '#465361'));
      if (!document.hidden) { update(); invalidate(); }
    };
    document.addEventListener('visibilitychange', wake);
    const nightObserver = new MutationObserver(wake);
    nightObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-night', 'data-focus'] });
    if (el.closest('.panel')) nightObserver.observe(el.closest('.panel'), { attributes: true, attributeFilter: ['data-night-state'] });
    const timer = setInterval(update, profile.instrumentMs);
    update(); invalidate();
    return () => {
      disposed = true; apiRef.current = null;
      clearInterval(timer); cancelAnimationFrame(frame);
      resize.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', wake);
      nightObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', locateCursor);
      renderer.domElement.removeEventListener('pointerleave', hideCursor); hideCursor();
      controls.removeEventListener('change', invalidate); controls.dispose();
      labels.clear();
      dispose(scene); texture.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [mode, profile]);

  useEffect(() => { apiRef.current?.fit(); }, [fitToken]);

  return <div className="trajectory-stage">
    <div ref={mountRef} className="trajectory-canvas" />
    <div ref={labelsRef} className="vehicle-label-layer" aria-label="Drone position labels" />
    <div ref={emptyRef} className="trajectory-empty">Waiting for position data</div>
    <div ref={cursorRef} className="trajectory-coordinates" hidden />
    <div ref={originRef} className="trajectory-origin" aria-label="Coordinate origin (0, 0, 0)" hidden>
      <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1v5m0 6v5M1 9h5m6 0h5"/><rect x="7" y="7" width="4" height="4"/></svg>
      <span className="trajectory-origin-label">Origin <span>(0, 0, 0)</span></span>
    </div>
    <div className="trajectory-projection">{mode === '3d' ? 'Orthographic 3D' : 'Top-down XY'}</div>
    <svg ref={guideRef} className="trajectory-axis-guide" viewBox="0 0 84 84" aria-label="View orientation axes">
      {['X', 'Y', 'Z'].map(axis => <g key={axis} data-axis={axis}><line x1="42" y1="42" x2="42" y2="42" /><text textAnchor="middle" dominantBaseline="central">{axis}</text></g>)}
      <circle cx="42" cy="42" r="2" />
    </svg>
  </div>;
}
