import { useSyncExternalStore } from 'react';
import { loadNightPreferences, applyNightPreferences, nightBrightness, cameraBrightness, NIGHT_MODE_KEY, NIGHT_BRIGHTNESS_KEY, FOCUS_MODE_KEY, NIGHT_CAMERA_KEY } from './nightPanel.js';

const read = () => {
  try { return loadNightPreferences(window.localStorage); } catch { return loadNightPreferences(); }
};
let preferences;
const listeners = new Set();
const getPreferences = () => preferences ||= read();
const subscribePreferences = listener => {
  listeners.add(listener);
  const changed = event => {
    if (event.key && ![NIGHT_MODE_KEY, NIGHT_BRIGHTNESS_KEY, FOCUS_MODE_KEY, NIGHT_CAMERA_KEY].includes(event.key)) return;
    preferences = read();
    applyNightPreferences(document.documentElement, preferences);
    listeners.forEach(notify => notify());
  };
  window.addEventListener('storage', changed);
  return () => { listeners.delete(listener); window.removeEventListener('storage', changed); };
};
function updatePreferences(patch) {
  preferences = { ...getPreferences(), ...patch };
  applyNightPreferences(document.documentElement, preferences);
  try {
    localStorage.setItem(NIGHT_MODE_KEY, preferences.enabled ? 'on' : 'off');
    localStorage.setItem(NIGHT_BRIGHTNESS_KEY, String(preferences.brightness));
    localStorage.setItem(FOCUS_MODE_KEY, preferences.focus ? 'on' : 'off');
    localStorage.setItem(NIGHT_CAMERA_KEY, String(preferences.cameraBrightness));
  } catch { /* session only */ }
  listeners.forEach(listener => listener());
}
const subscribeMode = listener => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-night', 'data-focus'] });
  return () => observer.disconnect();
};
const nightSnapshot = () => document.documentElement.dataset.night === 'on' ? 'on' : 'off';
const focusSnapshot = () => document.documentElement.dataset.focus === 'on';
export const useNightPanelMode = () => useSyncExternalStore(subscribeMode, nightSnapshot, () => 'off');
export const useFocusMode = () => useSyncExternalStore(subscribeMode, focusSnapshot, () => false);

export function useNightMode() {
  const value = useSyncExternalStore(subscribePreferences, getPreferences, getPreferences);
  return [value.enabled, () => updatePreferences({ enabled: !getPreferences().enabled }), value.brightness,
    brightness => updatePreferences({ brightness: nightBrightness(brightness) }),
    value.focus, () => updatePreferences({ focus: !getPreferences().focus }), value.cameraBrightness,
    brightness => updatePreferences({ cameraBrightness: cameraBrightness(brightness) })];
}
