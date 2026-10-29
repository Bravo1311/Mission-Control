import { useEffect, useState } from 'react';

const KEY = 'mission-control.night-panel';

const read = () => {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
};

// Night panel state lives on <html data-night="on|off"> so the whole
// look change is pure CSS (night.css) — no panel needs to know about it
// to go dark. Persisted, since you'd want it to survive a reload mid-session.
export function useNightMode() {
  const [night, setNight] = useState(read);

  useEffect(() => {
    document.documentElement.dataset.night = night ? 'on' : 'off';
    try { localStorage.setItem(KEY, night ? 'on' : 'off'); } catch { /* storage unavailable — just won't persist */ }
  }, [night]);

  return [night, () => setNight((n) => !n)];
}
