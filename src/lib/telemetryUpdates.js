// Independent clocks: instruments stay responsive without refreshing the grid.
export function createTelemetryUpdates() {
  let revision = 0;
  const groups = new Map();
  return {
    mark() { revision++; },
    channel(period) {
      if (!groups.has(period)) {
        const listeners = new Set();
        let published = revision;
        let last = -Infinity;
        groups.set(period, {
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          snapshot: () => published,
          flush(now) {
            if (now - last < period || published === revision) return;
            last = now;
            published = revision;
            listeners.forEach(listener => listener());
          },
        });
      }
      return groups.get(period);
    },
    flush(now) { groups.forEach(group => group.flush(now)); },
  };
}

// Keep the full time span and both endpoints when drawing long histories.
export function sampleIndices(length, limit = 600) {
  const count = Math.min(length, limit);
  return Array.from({ length: count }, (_, i) =>
    count < 2 ? 0 : Math.round(i * (length - 1) / (count - 1)));
}
