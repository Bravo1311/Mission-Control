import { useRef, useState } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { validateControl, resolveControl, MAX_CONTROLS, COMMAND_LOG_KEY, loadCommandLog } from '../lib/missionControls.js';

const EMPTY = { label: '', kind: 'service', endpoint: '/{vehicle}/', type: '', payload: '{}' };
export default function MissionCommandDock({ namespace, controls, onControls }) {
  const { status, executeControl } = useTelemetry();
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const [log, setLog] = useState(() => { try { return loadCommandLog(window.localStorage); } catch { return []; } });
  const latest = log.at(-1);
  const [reviewTarget, setReviewTarget] = useState(namespace);
  if (reviewTarget !== namespace) { setReviewTarget(namespace); setReview(null); }
  const save = event => {
    event.preventDefault();
    try {
      const control = validateControl(editing);
      if (!editing.id && controls.length >= MAX_CONTROLS) throw new Error(`Keep up to ${MAX_CONTROLS} controls.`);
      onControls(editing.id ? controls.map(item => item.id === control.id ? control : item) : [...controls, control]);
      setEditing(null); setError('');
    } catch (problem) { setError(problem.message); }
  };
  const prepare = control => {
    try { setReview(resolveControl(control, namespace)); setError(''); }
    catch (problem) { setError(problem.message); }
  };
  const record = item => setLog(previous => {
    const next = [...previous.filter(entry => entry.id !== item.id), item].slice(-40);
    try { localStorage.setItem(COMMAND_LOG_KEY, JSON.stringify(next)); } catch { /* session only */ }
    return next;
  });
  const send = async () => {
    if (!review || lock.current || status !== 'connected') return;
    lock.current = true; setSending(true);
    const command = review;
    const entry = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, at: new Date().toISOString(), label: command.label, endpoint: command.endpoint, state: 'pending', message: 'Request submitted; awaiting result.' };
    record(entry);
    try {
      const response = await executeControl(command);
      record({ ...entry, state: response.state, message: response.message });
      setReview(null);
    } catch (problem) {
      record({ ...entry, state: 'error', message: String(problem.message).slice(0, 2000) });
      setError(problem.message); setReview(null);
    } finally { lock.current = false; setSending(false); }
  };
  return <section className="mission-command-dock" aria-label="Vehicle controls">
    <header className="mission-section-heading"><div><h2>Command dock</h2><span>Target {namespace ? `/${namespace}` : '/'}</span></div>
      <button type="button" className="chip-btn" disabled={sending || !!editing} onClick={() => { setEditing({ ...EMPTY }); setError(''); }}>Add control</button>
    </header>
    {editing ? <form className="mission-control-editor" onSubmit={save}>
      <label>Control name<input required maxLength="60" aria-label="Control name" value={editing.label} onChange={event => setEditing({ ...editing, label: event.target.value })} placeholder="e.g. Pause simulation" /></label>
      <label>Operation<select aria-label="Control operation" value={editing.kind} onChange={event => setEditing({ ...editing, kind: event.target.value })}><option value="service">Call service</option><option value="publish">Publish once</option></select></label>
      <label>ROS endpoint<input required aria-label="Control endpoint" value={editing.endpoint} onChange={event => setEditing({ ...editing, endpoint: event.target.value })} placeholder="/{vehicle}/service_name" /></label>
      <label>ROS type<input required aria-label="Control type" value={editing.type} onChange={event => setEditing({ ...editing, type: event.target.value })} placeholder={editing.kind === 'service' ? 'std_srvs/srv/Trigger' : 'std_msgs/msg/Bool'} /></label>
      <label>JSON request<textarea required aria-label="Control request" value={editing.payload} onChange={event => setEditing({ ...editing, payload: event.target.value })} rows="3" spellCheck="false" /></label>
      <p>{'{vehicle}'} expands to the target namespace, preserving its case.</p>
      <div className="mission-form-actions"><button type="button" className="chip-btn" onClick={() => { setEditing(null); setError(''); }}>Cancel</button><button className="mission-primary" type="submit">Save control</button></div>
    </form> : <>
      {!controls.length && <div className="mission-controls-empty"><p>Connect your vehicle’s ROS controls.</p><span>Add its service or command topic and JSON request. No vehicle commands are preset.</span></div>}
      <div className="mission-control-list">{controls.map(control => <div className="mission-control-item" key={control.id}>
        <button className="mission-control-action" disabled={sending || status !== 'connected'} onClick={() => prepare(control)}><span>{control.label}</span><small>{control.kind === 'service' ? 'Service' : 'Publish once'}</small></button>
        <button className="mission-control-edit" aria-label={`Edit ${control.label}`} disabled={sending} onClick={() => { setReview(null); setEditing({ ...control, payload: JSON.stringify(control.payload, null, 2) }); setError(''); }}>Edit</button>
        <button className="mission-control-edit" aria-label={`Remove ${control.label}`} disabled={sending} onClick={() => { setReview(null); onControls(controls.filter(item => item.id !== control.id)); }}>×</button>
      </div>)}</div>
    </>}
    {review && <section className="mission-command-review" aria-label="Review ROS command">
      <h3>{review.label}</h3><p>{review.kind === 'service' ? 'Call service' : 'Publish once'} <code>{review.endpoint}</code></p><small>{review.type}</small>
      <pre>{JSON.stringify(review.payload, null, 2)}</pre>
      <div className="mission-form-actions"><button className="chip-btn" disabled={sending} onClick={() => setReview(null)}>Cancel</button><button className="mission-primary" disabled={sending || status !== 'connected'} onClick={send}>{sending ? 'Sending…' : 'Send request'}</button></div>
    </section>}
    {status !== 'connected' && <p className="mission-control-note">Controls are unavailable until rosbridge is connected.</p>}
    {error && <p className="mission-command-error" role="alert">{error}</p>}
    {latest && !error && <p className={`mission-command-result result-${latest.state}`} role="status">{latest.label}: {latest.state === 'replied' ? 'service replied' : latest.state === 'sent' ? 'published, unconfirmed' : latest.state === 'rejected' ? 'service reported failure' : latest.state === 'pending' ? 'awaiting result' : latest.state === 'unknown' ? 'outcome unknown' : 'request failed'}</p>}
    <details className="mission-command-log"><summary>Command log <span>{log.length}</span></summary>
      {!log.length ? <p>No commands sent.</p> : <ol>{[...log].reverse().map((item, index) => <li key={`${item.at}-${index}`}><div><strong>{item.label}</strong><time>{new Date(item.at).toLocaleTimeString()}</time></div><code>{item.endpoint}</code><pre>{item.message}</pre></li>)}</ol>}
    </details>
  </section>;
}
