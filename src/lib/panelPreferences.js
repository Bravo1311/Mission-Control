export const HIDDEN_PANELS_KEY = 'mission-control.hidden-panels.v1';
export const FOCUS_PANELS_KEY = 'mission-control.focus-panels.v1';
export const PANEL_CATALOG = {
  trajectory: { title: 'Trajectory', description: '2D and 3D position tracks' },
  gps: { title: 'Navigation map', description: 'Georeferenced trails and drone labels' },
  attitude: { title: 'Flight state', description: 'Attitude, heading and speed by drone' },
  error: { title: 'Estimation error', description: 'Time-aligned source comparison' },
  camera: { title: 'Camera feed', description: 'Color and depth images' },
  lidar: { title: 'Lidar scan', description: 'Scan and point-cloud previews' },
  readings: { title: 'Sensor readings & messages', description: 'IMU, scalar and message readouts' },
};

export const flightPanelId = key => `attitude:${encodeURIComponent(key)}`;

export function panelDefinition(id) {
  if (typeof id !== 'string') return null;
  if (Object.hasOwn(PANEL_CATALOG, id)) return PANEL_CATALOG[id];
  if (!id.startsWith('attitude:')) return null;
  try {
    const key = decodeURIComponent(id.slice('attitude:'.length));
    if (flightPanelId(key) !== id) return null;
    const label = key || 'Unnamespaced';
    return { title: `Flight state · ${label}`, description: `Overlaid estimates for ${label}` };
  } catch { return null; }
}

export function loadHiddenPanels(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(HIDDEN_PANELS_KEY) || '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter(id => panelDefinition(id)))] : [];
  } catch { return []; }
}

export function saveHiddenPanels(storage, ids) {
  try { storage?.setItem(HIDDEN_PANELS_KEY, JSON.stringify(ids)); } catch { /* session only */ }
}

export function loadFocusPanels(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(FOCUS_PANELS_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved)
      ? Object.fromEntries(Object.entries(saved).filter(([id, value]) => panelDefinition(id) && typeof value === 'boolean')) : {};
  } catch { return {}; }
}

export function saveFocusPanels(storage, choices) {
  try { storage?.setItem(FOCUS_PANELS_KEY, JSON.stringify(choices)); } catch { /* session only */ }
}
