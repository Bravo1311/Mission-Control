import { useEffect, useMemo, useState } from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const COLS = 12;
const ROW_HEIGHT = 24;
const MARGIN = [12, 12];
const STORAGE_KEY = 'mission-control.grid-layout.v3';

// Starting position/size for each known panel, the first time it ever
// appears — after that the user's own drag/resize takes over and is
// persisted. minW/minH are never overridden by a saved layout, so a panel
// a user shrank way down in a previous session can't end up literally
// un-resizable or clipped if its content requirements change later.
const DEFAULTS = {
  trajectory: { x: 0, y: 0, w: 6, h: 16, minW: 3, minH: 8 },
  gps: { x: 6, y: 0, w: 6, h: 16, minW: 3, minH: 8 },
  attitude: { x: 0, y: 16, w: 12, h: 12, minW: 4, minH: 8 },
  camera: { x: 0, y: 38, w: 6, h: 14, minW: 3, minH: 7 },
  lidar: { x: 6, y: 38, w: 6, h: 14, minW: 3, minH: 7 },
  readings: { x: 0, y: 52, w: 12, h: 10, minW: 4, minH: 6 },
  error: { x: 0, y: 28, w: 12, h: 15, minW: 4, minH: 10 },
};

function loadSavedLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {}; // corrupted or inaccessible storage — fall back to defaults rather than crash the dashboard
  }
}

// `panels` is [{ id, title, node }], already filtered down by the caller to
// only the panels that currently have data — see DashboardBody. This stays
// a pure function of (panels, customLayout) rather than owning RGL's
// `layout` prop as independent state, specifically so there's never a
// render where a visible panel is missing a matching layout entry (which
// is what happens if that reconciliation instead lived in a useEffect,
// always one render behind a panel appearing or disappearing).
const DashboardGrid = ({ panels }) => {
  const { width, containerRef, mounted } = useContainerWidth();
  const [customLayout, setCustomLayout] = useState(loadSavedLayout);

  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const narrow = width < 900;
  const trajectorySources = panels.find(panel => panel.id === 'attitude')?.sourceCount || 1;
  const defaults = useMemo(() => {
    const cameraWidth = width * (narrow ? 1 : 7 / 12);
    const preferred = Math.ceil((cameraWidth * 9 / 16 + 190) / 36);
    const sensorHeight = Math.max(13, Math.min(23, preferred, Math.floor((viewportHeight - 280) / 36)));
    const flightColumns = width >= 1256 ? 2 : 1;
    const flightCardWidth = (width - 44) / flightColumns;
    const flightRows = Math.ceil(trajectorySources / flightColumns);
    const flightHeight = Math.max(12, Math.ceil((flightRows * (flightCardWidth < 570 ? 430 : 310) + 100) / 36));
    return {
      ...DEFAULTS,
      attitude: { ...DEFAULTS.attitude, h: flightHeight },
      camera: { ...DEFAULTS.camera, w: narrow ? 12 : 7, h: sensorHeight },
      lidar: { ...DEFAULTS.lidar, x: narrow ? 0 : 7, w: narrow ? 12 : 5, h: sensorHeight },
    };
  }, [width, narrow, viewportHeight, trajectorySources]);
  const layout = useMemo(
    () => panels.map(({ id }) => ({
      i: id,
      ...defaults[id],
      ...customLayout[id],
      ...(narrow ? { x: 0, w: 12 } : {}),
      minW: DEFAULTS[id]?.minW,
      minH: DEFAULTS[id]?.minH,
    })),
    [panels, customLayout, defaults, narrow],
  );

  // Persist only completed user drags/resizes; compaction stays automatic.
  const handleLayoutChange = (newLayout) => {
    setCustomLayout((prev) => {
      const next = { ...prev };
      let changed = false;
      newLayout.forEach(({ i, x, y, w, h }) => {
        const d = defaults[i];
        const isDefault = d && d.x === x && d.y === y && d.w === w && d.h === h;
        if (isDefault) {
          if (next[i]) { delete next[i]; changed = true; }
        } else if (!next[i] || next[i].x !== x || next[i].y !== y || next[i].w !== w || next[i].h !== h) {
          next[i] = { x, y, w, h };
          changed = true;
        }
      });
      if (!changed) return prev;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* storage unavailable — layout just won't persist */ }
      return next;
    });
  };

  const resetLayout = () => {
    setCustomLayout({});
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clean up */ }
  };

  const hasCustomLayout = Object.keys(customLayout).length > 0;

  return (
    <div ref={containerRef} className="dashboard-grid-wrap">
      <div className="grid-toolbar">
        <span>{panels.length} {panels.length === 1 ? 'display' : 'displays'}<span className="grid-hint">Drag a handle to rearrange</span></span>
        <button className="chip-btn" disabled={!hasCustomLayout} onClick={resetLayout}>Auto layout</button>
      </div>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: MARGIN }}
          dragConfig={{ enabled: true, handle: '.panel-drag-handle' }}
          resizeConfig={{ enabled: true, handles: ['se'] }}
          onDragStop={handleLayoutChange}
          onResizeStop={handleLayoutChange}
        >
          {panels.map(({ id, node }) => (
            <div key={id} className="grid-cell">{node}</div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
};

export default DashboardGrid;
