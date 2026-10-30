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
    const box = candidates.sort((a, b) => score(a) - score(b))[0] || { x: pad, y: top };
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
  return {
    update(records, width, height) {
      const anchors = vehicleAnchors(records.filter(record => record.visible !== false));
      const keys = new Set(anchors.map(record => record.style.groupKey));
      for (const [key, node] of nodes) if (!keys.has(key)) { node.tag.remove(); node.line.remove(); nodes.delete(key); }
      const measured = anchors.map(record => {
        const key = record.style.groupKey;
        let node = nodes.get(key);
        if (!node) {
          const tag = document.createElement('div'); tag.className = 'vehicle-floating-tag'; tag.dataset.vehicle = key;
          const name = document.createElement('strong'), source = document.createElement('span'); tag.append(name, source); container.append(tag);
          const line = document.createElementNS(svg.namespaceURI, 'line'); svg.append(line);
          node = { tag, name, source, line }; nodes.set(key, node);
        }
        node.name.textContent = record.style.groupLabel; node.source.textContent = record.style.sourceLabel;
        node.tag.title = record.name; node.tag.dataset.topic = record.name;
        node.tag.style.setProperty('--vehicle-color', record.style.groupColor); node.line.style.stroke = record.style.groupColor;
        node.tag.style.maxWidth = `${Math.max(1, width - 16)}px`;
        return { ...record, width: node.tag.offsetWidth, height: node.tag.offsetHeight };
      });
      for (const record of placeVehicleLabels(measured, width, height)) {
        const { tag, line } = nodes.get(record.style.groupKey);
        tag.style.transform = `translate(${record.x}px, ${record.y}px)`;
        line.setAttribute('x1', record.anchorX); line.setAttribute('y1', record.anchorY);
        line.setAttribute('x2', Math.max(record.x, Math.min(record.x + record.width, record.anchorX)));
        line.setAttribute('y2', Math.max(record.y, Math.min(record.y + record.height, record.anchorY)));
      }
    },
    clear() { for (const node of nodes.values()) { node.tag.remove(); node.line.remove(); } nodes.clear(); svg.remove(); },
  };
}
