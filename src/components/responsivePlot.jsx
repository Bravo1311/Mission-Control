import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { panelIsAwake } from '../lib/nightPanel.js';

const Plot = lazy(() => import('./plotlyView.jsx'));
const CONFIG = { displayModeBar: false };

// Freeze an already-mounted chart while off screen. Keep zoom/pan state, and
// defer downloading/initializing Plotly until the chart is actually viewed.
const VisiblePlot = memo(function VisiblePlot({ visible, data, layout, size, ...rest }) {
  const [seen, setSeen] = useState(visible);
  if (visible && !seen) setSeen(true);
  if (!seen || !size || size.width <= 0 || size.height <= 0) return null;
  return <Suspense fallback={<div className="emptyState">Loading chart…</div>}>
    <Plot data={data} layout={{ ...layout, ...size, autosize: false }} config={CONFIG} {...rest} />
  </Suspense>;
}, (before, after) => !before.visible && !after.visible);

export default function ResponsivePlot({ data, layout, ...rest }) {
  const ref = useRef(null);
  const [size, setSize] = useState(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    let intersects = false;
    const update = () => setVisible(intersects && !document.hidden && panelIsAwake(el));
    const intersection = new IntersectionObserver(([entry]) => { intersects = entry.isIntersecting; update(); });
    intersection.observe(el);
    const resize = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width), height = Math.floor(entry.contentRect.height);
      setSize(previous => previous?.width === width && previous?.height === height ? previous : { width, height });
    });
    resize.observe(el);
    const mode = new MutationObserver(update);
    mode.observe(document.documentElement, { attributes: true, attributeFilter: ['data-focus'] });
    if (el.closest('.panel')) mode.observe(el.closest('.panel'), { attributes: true, attributeFilter: ['data-night-state'] });
    document.addEventListener('visibilitychange', update);
    return () => { intersection.disconnect(); resize.disconnect(); mode.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return <div ref={ref} className="responsive-plot" style={{ width: '100%', height: '100%', minHeight: 0 }}>
    <VisiblePlot visible={visible} data={data} layout={layout} size={size} {...rest} />
  </div>;
}
