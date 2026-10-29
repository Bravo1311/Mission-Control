export function finitePosition(p) {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0);
}

export function niceGridStep(span) {
  const target = Math.max(0.001, Number.isFinite(span) ? span / 10 : 1);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const fraction = target / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}

export function trajectoryFit(bounds, aspect = 1, mode = '3d') {
  if (!bounds || !bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) return null;
  const size = bounds.max.map((v, i) => Math.max(0, v - bounds.min[i]));
  const center = bounds.min.map((v, i) => v + size[i] / 2);
  const radius = Math.max(5, Math.hypot(size[0], size[1], mode === '2d' ? 0 : size[2]) / 2);
  const halfHeight = radius * 1.3 / Math.min(1, Math.max(0.1, aspect));
  const step = niceGridStep(Math.max(10, size[0], size[1], mode === '2d' ? 0 : size[2]));
  const distance = mode === '2d' ? Math.max(size[2], radius * 2) + radius * 2 : radius * 4;
  return { center, radius, halfHeight, step, distance, plane: Math.floor(bounds.min[2] / step) * step };
}

export function boundsWithOrigin(bounds) {
  if (!bounds || !bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) return bounds;
  return {
    min: bounds.min.map(value => Math.min(0, value)),
    max: bounds.max.map(value => Math.max(0, value)),
  };
}
