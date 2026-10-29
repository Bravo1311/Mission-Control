import { lazy, Suspense, useEffect, useRef, useState } from 'react';

// Camera/lidar-only sessions never need to download or initialize Plotly.
const Plot = lazy(() => import('./plotlyView.jsx'));

// react-plotly's `useResizeHandler` only listens for *window* resizes, so a
// chart inside a resizable grid cell stayed at its old size when the cell
// changed (the "chart doesn't fill its panel" bug). This measures the
// container itself and hands Plotly an explicit width/height instead.
const ResponsivePlot = ({ data, layout, ...rest }) => {
  const ref = useRef(null);
  const [size, setSize] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const w = Math.floor(width), h = Math.floor(height);
      setSize(previous => previous?.width === w && previous?.height === h ? previous : { width: w, height: h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 0 }}>
      {size && size.width > 0 && size.height > 0 && (
        <Suspense fallback={<div className="emptyState">Loading chart…</div>}>
        <Plot
          data={data}
          layout={{ ...layout, width: size.width, height: size.height, autosize: false }}
          config={{ displayModeBar: false }}
          {...rest}
        />
        </Suspense>
      )}
    </div>
  );
};

export default ResponsivePlot;
