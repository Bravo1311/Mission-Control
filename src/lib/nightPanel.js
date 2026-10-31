export const NIGHT_MODE_KEY = 'mission-control.night-panel';
export const NIGHT_BRIGHTNESS_KEY = 'mission-control.night-brightness.v1';
export const FOCUS_MODE_KEY = 'mission-control.focus-mode.v1';
export const NIGHT_CAMERA_KEY = 'mission-control.night-camera-brightness.v1';
export const DEFAULT_NIGHT_BRIGHTNESS = 75;

export function nightBrightness(value) {
  const number = Number(value);
  return value === null || value === '' || !Number.isFinite(number) ? DEFAULT_NIGHT_BRIGHTNESS : Math.max(40, Math.min(100, number));
}

export function loadNightPreferences(storage) {
  try { return { enabled: storage?.getItem(NIGHT_MODE_KEY) === 'on', brightness: nightBrightness(storage?.getItem(NIGHT_BRIGHTNESS_KEY)),
    focus: storage?.getItem(FOCUS_MODE_KEY) === 'on', cameraBrightness: cameraBrightness(storage?.getItem(NIGHT_CAMERA_KEY)) }; }
  catch { return { enabled: false, brightness: DEFAULT_NIGHT_BRIGHTNESS, focus: false, cameraBrightness: 80 }; }
}

export function cameraBrightness(value) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? 80 : Math.max(20, Math.min(100, number));
}

export function applyNightPreferences(root, preferences) {
  const enabled = preferences.enabled ? 'on' : 'off';
  root.dataset.night = enabled;
  root.dataset.focus = preferences.focus ? 'on' : 'off';
  root.style.setProperty('--night-brightness', String(nightBrightness(preferences.brightness) / 100));
  root.style.setProperty('--night-camera-brightness', String(cameraBrightness(preferences.cameraBrightness) / 100));
}

export function panelIsAwake(element) {
  if (element?.closest('[data-workspace-active="false"]')) return false;
  if (document.documentElement.dataset.focus !== 'on') return true;
  return ['active', 'essential', 'revealed', 'alert'].includes(element?.closest('.panel')?.dataset.nightState);
}

// Derive a separate focus layout; never mutate/persist the user's day layout.
export function focusPanelLayout(dayLayout, panels, states) {
  const byId = new Map(dayLayout.map(item => [item.i, item]));
  const state = panel => states[panel.id] || 'active';
  const priority = { alert: 0, active: 1, essential: 1, revealed: 1, standby: 2 };
  const ordered = panels.map((panel, index) => ({ panel, index })).sort((a, b) => priority[state(a.panel)] - priority[state(b.panel)] || a.index - b.index);
  let x = 0, y = 0, rowHeight = 0;
  return ordered.map(({ panel }) => {
    const original = byId.get(panel.id);
    const standby = state(panel) === 'standby';
    const w = standby ? 12 : original.w;
    const h = standby ? 2 : original.h;
    if (x + w > 12 || standby && x) { y += rowHeight; x = 0; rowHeight = 0; }
    const result = { ...original, x, y, w, h, minH: standby ? 2 : original.minH };
    x += w; rowHeight = Math.max(rowHeight, h);
    if (x === 12) { y += rowHeight; x = 0; rowHeight = 0; }
    return result;
  });
}
