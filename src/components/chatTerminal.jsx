import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTelemetry } from '../context/telemetryContext.jsx';
import { createAgentSession, MAX_CHAT_INPUT } from '../lib/agentSession.js';

const clock = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ChatTerminal({ transport = null, embedded = false, consoleMode = false, storageKey }) {
  // Metadata-only subscription: raw ROS messages never enter chat history.
  const { status, selected } = useTelemetry();
  const [session] = useState(() => {
    let storage;
    try { storage = window.localStorage; } catch { /* session-only history */ }
    return createAgentSession({ storage, transport, storageKey });
  });
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [open, setOpen] = useState(embedded);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const launcherRef = useRef(null);
  const logRef = useRef(null);
  const followRef = useRef(true);
  const wasOpen = useRef(false);

  useEffect(() => {
    session.setTransport(transport);
    return () => session.cancel();
  }, [session, transport]);
  useEffect(() => {
    if (open && !embedded) inputRef.current?.focus();
    else if (!embedded && wasOpen.current) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open, embedded]);
  useEffect(() => {
    const log = logRef.current;
    if (open && log && followRef.current) log.scrollTop = log.scrollHeight;
  }, [state.messages, open]);

  const submit = event => {
    event?.preventDefault();
    const context = {
      connectionStatus: status,
      topics: selected.map(({ name, type }) => ({ name, type })),
    };
    if (session.submit(draft, context)) { setDraft(''); followRef.current = true; }
  };

  return <>
    {!embedded && <button ref={launcherRef} type="button" className={`chat-launcher${open ? ' is-open' : ''}`} aria-expanded={open} aria-controls="agent-terminal" onClick={() => setOpen(value => !value)}>
      <span className="chat-terminal-mark" aria-hidden="true">›_</span>
      Agent terminal
      {state.pending && <span className="chat-busy-label">Working</span>}
    </button>}
    {open && <section id={embedded ? 'mission-console' : 'agent-terminal'} className={`agent-terminal${embedded ? ' embedded-terminal' : ''}`} aria-label={consoleMode ? 'Mission console' : 'Agent chat terminal'} onKeyDown={event => {
      if (!embedded && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    }}>
      <header className="chat-header">
        <span className="chat-terminal-mark" aria-hidden="true">›_</span>
        <div><h2>{consoleMode ? 'Mission console' : 'Agent terminal'}</h2><p>{consoleMode ? 'Local commands and operational notes' : state.configured ? 'Agent adapter configured' : 'Local workspace · agent not connected'}</p></div>
        {!embedded && <button type="button" className="chat-close" aria-label="Close agent terminal" onClick={() => setOpen(false)}>×</button>}
      </header>
      <div className="chat-toolbar">
        <span>{consoleMode ? '/help for commands' : state.configured ? 'Agent mode' : 'Local mode'}</span>
        <button type="button" disabled={!state.messages.length} onClick={() => session.clear()}>Clear history</button>
      </div>
      <div ref={logRef} className="chat-log" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text" onScroll={event => {
        const el = event.currentTarget;
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}>
        {!state.messages.length && <div className="chat-empty">
          <span className="chat-empty-prompt" aria-hidden="true">›_</span>
          <h3>{consoleMode ? 'Mission notes' : 'Agent workspace'}</h3>
          <p>{consoleMode ? 'Use /status, /topics or /help. Other messages become local mission notes.' : state.configured ? 'Send a message to your configured agent.' : 'Save notes and prompts here. Attach an agent later to enable replies.'}</p>
          <span>{consoleMode ? 'Console commands do not send vehicle commands.' : state.configured ? 'Only topic names, types and connection status accompany your message.' : 'Local messages are not sent or automatically replayed.'}</span>
        </div>}
        {state.messages.map(message => <article className={`chat-message chat-message-${message.role}`} key={message.id}>
          <header><strong>{message.role === 'user' ? 'You' : consoleMode ? 'Console' : 'Agent'}</strong><span>{message.status === 'local' ? 'Local only' : message.status === 'cancelled' ? 'Stopped' : message.status === 'error' ? 'Failed' : ''}</span><time dateTime={message.createdAt}>{clock(message.createdAt)}</time></header>
          <p>{message.content || (message.status === 'pending' ? 'Waiting for agent…' : message.status === 'cancelled' ? 'Response stopped.' : '')}</p>
          {message.error && <p className="chat-error" role="alert">{message.error}</p>}
        </article>)}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <label htmlFor={embedded ? 'mission-message' : 'agent-message'}>Message</label>
        <textarea id={embedded ? 'mission-message' : 'agent-message'} ref={inputRef} value={draft} maxLength={MAX_CHAT_INPUT} rows="3" placeholder={consoleMode ? '/status or write a mission note…' : state.configured ? 'Message your agent…' : 'Write a note or a prompt…'} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
        }} />
        <div className="chat-composer-actions">
          <span>{draft.length}/{MAX_CHAT_INPUT}<span className="chat-keyboard-hint"> · Shift+Enter for a new line</span></span>
          {state.pending ? <button type="button" className="chat-send" onClick={() => session.cancel()}>Stop</button> : <button type="submit" className="chat-send" disabled={!draft.trim()}>{state.configured ? 'Send' : 'Save message'}</button>}
        </div>
        <p className="chat-storage-note">{state.historySaved ? 'History saved in this browser' : 'History available for this session only'}{consoleMode ? ' · Local console' : state.configured ? ' · Topic metadata included' : ' · No agent requests'}</p>
      </form>
    </section>}
  </>;
}
