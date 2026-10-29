// The one container every dashboard panel uses: a fixed-height title bar
// (title left, optional controls + drag handle right) over a body that
// fills whatever size the grid gives it. Maps, 3D canvases and charts run
// edge-to-edge in the body; instrument-style content opts into padding with
// `padded`. Keeping this in one place is what makes every panel line up —
// same header height, same divider, same border, same radius.
//
// The body wraps children in an absolutely-positioned fill box so that
// `height: 100%` inside it always resolves against a definite size (maps,
// canvases and charts all depend on that).
//
// `keepLit` / `alert` only matter in night mode (night.css): a keepLit panel
// stays visible when everything else goes dark, and an alert panel
// ('warning' | 'danger') relights itself until the condition clears.
//
// The drag handle is a small separate target on purpose: dashboardGrid.jsx
// restricts grid-dragging to `.panel-drag-handle`, so dragging a panel
// never fights with panning the map, orbiting the 3D view, or clicking a
// control in the header.
const Panel = ({ title, subtitle, icon, className = '', controls, padded = false, keepLit = false, alert, style, children }) => (
  <section className={`panel ${className}`} style={style} data-keep-lit={keepLit ? '' : undefined} data-alert={alert}>
    <header className="panel-header">
      <div className="panel-heading">
        {icon && <span className="panel-icon" aria-hidden="true">{icon}</span>}
        <div><h2 className="panel-title">{title}</h2>{subtitle && <p className="panel-subtitle">{subtitle}</p>}</div>
      </div>
      <div className="panel-controls">
        {controls}
        <span className="panel-drag-handle" title="Drag to move this panel">⠿</span>
      </div>
    </header>
    <div className="panel-body">
      <div className={`panel-fill${padded ? ' panel-fill-padded' : ''}`}>{children}</div>
    </div>
  </section>
);

export default Panel;
