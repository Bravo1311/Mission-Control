export const PERFORMANCE_STORAGE_KEY = 'mission-control.performance.v1';
export const MOBILE_QUERY = '(max-width: 700px), (pointer: coarse)';

const profiles = {
  desktop: Object.freeze({ mode: 'desktop', cameraMs: 50, scanMs: 200, cloudMs: 500,
    maxWidth: 1280, maxHeight: 720, maxPoints: 12000, lidarSize: 800,
    historySeconds: 120, historySamples: 2400, instrumentMs: 50,
    trajectoryPoints: 600, pixelRatio: 1.5, sensorBytesPerSecond: 0 }),
  mobile: Object.freeze({ mode: 'mobile', cameraMs: 100, scanMs: 500, cloudMs: 1000,
    maxWidth: 640, maxHeight: 360, maxPoints: 3000, lidarSize: 480,
    historySeconds: 60, historySamples: 600, instrumentMs: 100,
    trajectoryPoints: 300, pixelRatio: 1, sensorBytesPerSecond: 2 * 1024 * 1024 }),
};

export const performanceProfile = mode => profiles[mode] || profiles.desktop;
export const validPerformancePreference = value => ['auto', 'mobile', 'desktop'].includes(value);

export function loadPerformancePreference(storage) {
  try {
    const saved = storage?.getItem(PERFORMANCE_STORAGE_KEY);
    return validPerformancePreference(saved) ? saved : 'auto';
  } catch { return 'auto'; }
}
