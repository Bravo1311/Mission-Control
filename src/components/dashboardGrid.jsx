import { useEffect, useId, useMemo, useRef, useState } from 'react';
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { PanelActionsContext } from '../context/panelActions.js';
import { panelDefinition, loadHiddenPanels, saveHiddenPanels, loadFocusPanels, saveFocusPanels } from '../lib/panelPreferences.js';
import { useFocusMode } from '../lib/useNightMode.js';
import { focusPanelLayout } from '../lib/nightPanel.js';
import { AUTO_ALERTS_ENABLED } from '../lib/alertPolicy.js';

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
  const [hiddenPanels, setHiddenPanels] = useState(() => {
    try { return loadHiddenPanels(window.localStorage); } catch { return []; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerId = useId();
  const drawerButton = useRef(null);
  const [panelViews] = useState(() => new Map());
  const focus = useFocusMode();
  const [focusPanels, setFocusPanels] = useState(() => {
    try { return loadFocusPanels(window.localStorage); } catch { return {}; }
  });
  const [nightStates, setNightStates] = useState({});
  const [alerts, setAlerts] = useState({});
  // An older saved global Flight state preference still hides its successors.
  const visiblePanels = panels.filter(panel => !hiddenPanels.includes(panel.id) && !(panel.kind === 'attitude' && hiddenPanels.includes('attitude')));
  const updateHidden = next => {
    setHiddenPanels(next);
    try { saveHiddenPanels(window.localStorage, next); } catch { /* session only */ }
  };
  const hidePanel = id => {
    updateHidden([...new Set([...hiddenPanels, id])]);
    setDrawerOpen(true);
    requestAnimationFrame(() => drawerButton.current?.focus());
  };
  const restorePanel = id => {
    updateHidden(hiddenPanels.filter(name => name !== id));
    requestAnimationFrame(() => drawerButton.current?.focus());
  };

  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const narrow = width < 900;
  const flightPanels = panels.filter(panel => panel.kind === 'attitude');
  const defaults = useMemo(() => {
    const cameraWidth = width * (narrow ? 1 : 7 / 12);
    const preferred = Math.ceil((cameraWidth * 9 / 16 + 190) / 36);
    const sensorHeight = Math.max(13, Math.min(23, preferred, Math.floor((viewportHeight - 340) / 36)));
    const flightColumns = width >= 1200 && flightPanels.length > 1 ? 2 : 1;
    const flightWidth = (width - (flightColumns - 1) * 12) / flightColumns;
    const flightHeights = flightPanels.map(panel => Math.max(15, Math.ceil(((flightWidth < 780 ? 500 : 310) + Math.min(panel.sourceCount, 8) * 38 + 160) / 36)));
    const flightRowHeight = Math.max(15, ...flightHeights);
    const flightDefaults = Object.fromEntries(flightPanels.map((panel, index) => [panel.id, { ...DEFAULTS.attitude,
      x: index % flightColumns * (12 / flightColumns), y: 16 + Math.floor(index / flightColumns) * flightRowHeight,
      w: 12 / flightColumns, h: flightHeights[index] }]));
    return {
      ...DEFAULTS,
      ...flightDefaults,
      camera: { ...DEFAULTS.camera, w: narrow ? 12 : 7, h: sensorHeight },
      lidar: { ...DEFAULTS.lidar, x: narrow ? 0 : 7, w: narrow ? 12 : 5, h: sensorHeight },
    };
  }, [width, narrow, viewportHeight, flightPanels]);
  const layout = useMemo(
    () => visiblePanels.map(({ id }) => ({
      i: id,
      ...defaults[id],
      ...customLayout[id],
      ...(narrow ? { x: 0, w: 12 } : {}),
      minW: defaults[id]?.minW,
      minH: defaults[id]?.minH,
    })),
    [visiblePanels, customLayout, defaults, narrow],
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
  const activeLayout = focus ? focusPanelLayout(layout, visiblePanels, nightStates) : layout;
  const orderedPanels = focus ? activeLayout.map(item => visiblePanels.find(panel => panel.id === item.i)) : visiblePanels;
  const activeAlerts = panels.filter(panel => alerts[panel.id]?.severity);
  const inspectAlert = id => {
    updateHidden(hiddenPanels.filter(name => name !== id && !(name === 'attitude' && id.startsWith('attitude:'))));
    // A restored panel reports its alert state after mounting; let the Focus
    // layout apply that expansion before choosing the scroll destination.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = [...(containerRef.current?.querySelectorAll('.grid-cell') || [])].find(node => node.dataset.panelId === id)?.querySelector('.panel');
      element?.scrollIntoView({ block: 'center', behavior: 'instant' });
      element?.focus({ preventScroll: true });
    }));
  };
  const actionsFor = id => ({ hidePanel: () => hidePanel(id),
    focusLit: focusPanels[id] ?? panels.find(panel => panel.id === id)?.kind === 'attitude',
    setFocusLit: lit => setFocusPanels(previous => {
      const next = { ...previous, [id]: lit };
      try { saveFocusPanels(window.localStorage, next); } catch { /* session only */ }
      return next;
    }),
    reportNightState: state => setNightStates(previous => previous[id] === state ? previous : { ...previous, [id]: state }),
    reportAlert: (severity, title) => setAlerts(previous => previous[id]?.severity === severity ? previous : { ...previous, [id]: { severity, title, acknowledged: false } }),
    readState: key => panelViews.get(id)?.get(key),
    writeState: (key, value) => {
      if (!panelViews.has(id)) panelViews.set(id, new Map());
      panelViews.get(id).set(key, value);
    },
  });

  return (
    <div ref={containerRef} className="dashboard-grid-wrap">
      {AUTO_ALERTS_ENABLED && activeAlerts.length > 0 && <aside className="workspace-alerts" aria-label="Active alerts">
        <strong role="status">{activeAlerts.length} active {activeAlerts.length === 1 ? 'alert' : 'alerts'}</strong>
        {activeAlerts.map(panel => <div className="workspace-alert" key={panel.id} data-acknowledged={alerts[panel.id].acknowledged}>
          <span>{alerts[panel.id].title} · {alerts[panel.id].acknowledged ? 'Acknowledged — still active' : 'Needs attention'}</span>
          <button className="chip-btn" onClick={() => inspectAlert(panel.id)}>Inspect</button>
          {!alerts[panel.id].acknowledged && <button className="chip-btn" aria-label={`Acknowledge ${alerts[panel.id].title} alert`} onClick={() => setAlerts(previous => ({ ...previous, [panel.id]: { ...previous[panel.id], acknowledged: true } }))}>Acknowledge</button>}
        </div>)}
      </aside>}
      <div className="hidden-panels-drawer">
        <div className="workspace-toolbar-actions">
        <button ref={drawerButton} className="hidden-panels-toggle" type="button" aria-expanded={drawerOpen} aria-controls={drawerId} onClick={() => setDrawerOpen(open => !open)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6" /></svg>
          Hidden panels {hiddenPanels.length > 0 && <span className="hidden-panel-count">{hiddenPanels.length}</span>}
        </button>
        {focus && <span className="workspace-focus-hint">Focus · choose panels with Show / Blank</span>}
        {!focus && hasCustomLayout && <button className="chip-btn workspace-reset" onClick={resetLayout}>Auto layout</button>}
        </div>
        <div id={drawerId} className="hidden-panels-body" hidden={!drawerOpen}>
          {hiddenPanels.length ? <>
            <div className="hidden-panel-list">
              {hiddenPanels.map(id => {
                const available = panels.find(panel => panel.id === id);
                const definition = panelDefinition(id);
                const title = available?.title || definition.title;
                return <div className="hidden-panel-item" key={id}>
                  <div><strong>{title}</strong><span>{available ? definition.description : 'Select a matching topic to display this panel.'}</span></div>
                  <button type="button" className="chip-btn" aria-label={`Restore ${title} panel`} onClick={() => restorePanel(id)}>Add back</button>
                </div>;
              })}
            </div>
            {hiddenPanels.length > 1 && <button type="button" className="chip-btn hidden-panels-restore" onClick={() => updateHidden([])}>Restore all panels</button>}
          </> : <p>No hidden panels. Use the minus button in a panel header to move it here.</p>}
        </div>
      </div>
      {!visiblePanels.length && <div className="workspace-panels-empty"><strong>Your panels are hidden</strong><p>Open Hidden panels above to add them back.</p></div>}
      {mounted && visiblePanels.length > 0 && (
        <ReactGridLayout
          width={width}
          layout={activeLayout}
          gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: MARGIN }}
          dragConfig={{ enabled: !focus, handle: '.panel-drag-handle' }}
          resizeConfig={{ enabled: !focus, handles: ['se'] }}
          onDragStop={handleLayoutChange}
          onResizeStop={handleLayoutChange}
        >
          {orderedPanels.map(({ id, node }) => (
            <div key={id} className="grid-cell" data-panel-id={id}>
              <PanelActionsContext.Provider value={actionsFor(id)}>{node}</PanelActionsContext.Provider>
            </div>
          ))}
        </ReactGridLayout>
      )}
      {panels.filter(panel => panel.monitor && !visiblePanels.includes(panel)).map(panel => <PanelActionsContext.Provider key={panel.id} value={actionsFor(panel.id)}>{panel.monitor}</PanelActionsContext.Provider>)}
    </div>
  );
};

export default DashboardGrid;
