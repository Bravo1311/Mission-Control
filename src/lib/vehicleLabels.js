const PRIORITY = ['fusion', 'odometry', 'reference', 'imu', 'gps', 'other'];

// One label per vehicle, anchored to an available estimate. Including the
// source name avoids implying that this is ground truth or merging positions.
export function vehicleAnchors(records) {
  const groups = new Map();
  for (const record of [...records].sort((a, b) => a.name.localeCompare(b.name))) {
    const previous = groups.get(record.style.groupKey);
    if (!previous || PRIORITY.indexOf(record.style.sourceKind) < PRIORITY.indexOf(previous.style.sourceKind)) groups.set(record.style.groupKey, record);
  }
  return [...groups.values()].sort((a, b) => a.style.groupKey.localeCompare(b.style.groupKey, undefined, { numeric: true }));
}

// Labels are bounded by their own panel. Search nearby positions before
// accepting overlap; a leader always points back to the actual position.
export function placeVehicleLabels(anchors, width, height) {
  const placed = [];
  const pad = 8, top = Math.min(38, Math.max(pad, height - 44));
  for (const anchor of anchors) {
    const w = Math.min(anchor.width, Math.max(1, width - pad * 2));
    const h = anchor.height;
    const clampX = x => Math.max(pad, Math.min(width - w - pad, x));
    const clampY = y => Math.max(top, Math.min(height - h - pad, y));
    const candidates = [];
    for (let row = 0; row < Math.ceil(height / (h + 6)); row++) {
      for (const side of [1, -1]) for (const direction of [-1, 1]) {
        candidates.push({ x: clampX(anchor.x + (side > 0 ? 14 : -w - 14)), y: clampY(anchor.y - h / 2 + direction * row * (h + 6)) });
      }
    }
    const score = box => {
      const overlap = placed.reduce((sum, other) => sum + Math.max(0, Math.min(box.x + w + 5, other.x + other.width) - Math.max(box.x - 5, other.x))
        * Math.max(0, Math.min(box.y + h + 5, other.y + other.height) - Math.max(box.y - 5, other.y)), 0);
      return overlap * 10000 + Math.hypot(box.x + w / 2 - anchor.x, box.y + h / 2 - anchor.y);
    };
    let box = { x: pad, y: top }, bestScore = Infinity;
    for (const candidate of candidates) {
      const value = score(candidate);
      if (value < bestScore) { bestScore = value; box = candidate; }
    }
    placed.push({ ...anchor, ...box, width: w, height: h, anchorX: anchor.x, anchorY: anchor.y });
  }
  return placed;
}

// Shared by the Three.js and Leaflet overlays. No per-tick React state or
// continuously running animation is needed. All topic text uses textContent.
export function createVehicleLabels(container) {
  const nodes = new Map();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('vehicle-label-leaders'); svg.setAttribute('aria-hidden', 'true');
  container.append(svg);
  const sizes = new ResizeObserver(entries => {
    for (const entry of entries) {
      const node = nodes.get(entry.target.dataset.vehicle);
      if (!node || node.tag !== entry.target) continue;
      const size = entry.borderBoxSize?.[0];
      node.width = size?.inlineSize ?? entry.target.offsetWidth;
      node.height = size?.blockSize ?? entry.target.offsetHeight;
    }
  });
  return {
    update(records, width, height) {
      const anchors = vehicleAnchors(records.filter(record => record.visible !== false));
      const keys = new Set(anchors.map(record => record.style.groupKey));
      for (const [key, node] of nodes) if (!keys.has(key)) { sizes.unobserve(node.tag); node.tag.remove(); node.line.remove(); nodes.delete(key); }
      // Finish all DOM writes before measuring newly created/changed labels.
      // Existing labels need no synchronous size read during live movement.
      for (const record of anchors) {
        const key = record.style.groupKey;
        let node = nodes.get(key);
        if (!node) {
          const tag = document.createElement('div'); tag.className = 'vehicle-floating-tag'; tag.dataset.vehicle = key;
          const name = document.createElement('strong'), source = document.createElement('span'); tag.append(name, source); container.append(tag);
          const line = document.createElementNS(svg.namespaceURI, 'line'); svg.append(line);
          node = { tag, name, source, line }; nodes.set(key, node); sizes.observe(tag);
        }
        if (node.groupLabel !== record.style.groupLabel || node.sourceLabel !== record.style.sourceLabel) {
          node.groupLabel = record.style.groupLabel; node.sourceLabel = record.style.sourceLabel;
          node.name.textContent = node.groupLabel; node.source.textContent = node.sourceLabel;
          node.width = node.height = null;
        }
        if (node.topic !== record.name) { node.topic = record.name; node.tag.title = record.name; node.tag.dataset.topic = record.name; }
        if (node.color !== record.style.groupColor) {
          node.color = record.style.groupColor;
          node.tag.style.setProperty('--vehicle-color', node.color); node.line.style.stroke = node.color;
        }
        const maxWidth = `${Math.max(1, width - 16)}px`;
        if (node.maxWidth !== maxWidth) { node.maxWidth = maxWidth; node.tag.style.maxWidth = maxWidth; node.width = node.height = null; }
      }
      const measured = anchors.map(record => {
        const node = nodes.get(record.style.groupKey);
        node.width ??= node.tag.offsetWidth; node.height ??= node.tag.offsetHeight;
        return { ...record, width: node.width, height: node.height };
      });
      for (const record of placeVehicleLabels(measured, width, height)) {
        const node = nodes.get(record.style.groupKey);
        const transform = `translate(${record.x}px, ${record.y}px)`;
        if (node.transform !== transform) { node.tag.style.transform = transform; node.transform = transform; }
        const points = { x1: record.anchorX, y1: record.anchorY,
          x2: Math.max(record.x, Math.min(record.x + record.width, record.anchorX)),
          y2: Math.max(record.y, Math.min(record.y + record.height, record.anchorY)) };
        for (const [key, value] of Object.entries(points)) if (node[key] !== value) { node.line.setAttribute(key, value); node[key] = value; }
      }
    },
    clear() { sizes.disconnect(); for (const node of nodes.values()) { node.tag.remove(); node.line.remove(); } nodes.clear(); svg.remove(); },
  };
}
