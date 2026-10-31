import { useContext, useEffect } from 'react';
import { PanelActionsContext } from '../context/panelActions.js';
import { useFocusMode } from '../lib/useNightMode.js';
import DataStatus from './dataStatus.jsx';

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
// Focus defaults may use keepLit, but saved per-panel choices take precedence.
// Active alerts override blanking until clear. Night lighting is independent.
//
// The drag handle is a small separate target on purpose: dashboardGrid.jsx
// restricts grid-dragging to `.panel-drag-handle`, so dragging a panel
// never fights with panning the map, orbiting the 3D view, or clicking a
// control in the header.
const Panel = ({ title, subtitle, icon, className = '', controls, padded = false, keepLit = false, alert, style, vehicle, sources, children }) => {
  const actions = useContext(PanelActionsContext);
  const hidePanel = actions?.hidePanel;
  const focus = useFocusMode() && !!actions;
  const illuminated = actions?.focusLit ?? keepLit;
  const state = alert ? 'alert' : !focus ? 'active' : illuminated ? 'revealed' : 'standby';
  const standby = state === 'standby';
  useEffect(() => { actions?.reportNightState(state); }, [actions, state]);
  return (
  <section className={`panel ${className}`} style={style} tabIndex={-1} data-vehicle={vehicle} data-night-state={state} data-keep-lit={keepLit ? '' : undefined} data-alert={alert}>
    <header className="panel-header">
      <div className="panel-heading">
        {icon && <span className="panel-icon" aria-hidden="true">{icon}</span>}
        <div><h2 className="panel-title">{title}</h2>{subtitle && <p className="panel-subtitle">{subtitle}</p>}{sources?.length > 0 && <DataStatus names={sources} />}</div>
      </div>
      <div className="panel-controls">
        {controls && <div className="panel-secondary-controls">{controls}</div>}
        {alert && <span className="night-alert-label" role="status">Alert</span>}
        {focus && <button type="button" className="chip-btn night-panel-toggle" aria-label={`${illuminated ? 'Blank' : 'Show'} ${title} in Focus mode`} aria-pressed={illuminated} disabled={!!alert} title={alert ? 'Active alerts remain visible until the condition clears' : 'Saved for future Focus sessions'} onClick={() => actions?.setFocusLit(!illuminated)}>{alert ? 'Alert awake' : illuminated ? 'Blank' : 'Show'}</button>}
        {hidePanel && <button type="button" className="panel-hide" onClick={hidePanel} aria-label={`Hide ${title} panel`} title="Move to Hidden panels">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg>
        </button>}
        <span className="panel-drag-handle" title="Drag to move this panel">⠿</span>
      </div>
    </header>
    <div className="panel-body" inert={standby ? true : undefined} aria-hidden={standby ? true : undefined}>
      <div className={`panel-fill${padded ? ' panel-fill-padded' : ''}`}>{children}</div>
    </div>
  </section>
  );
};

export default Panel;
