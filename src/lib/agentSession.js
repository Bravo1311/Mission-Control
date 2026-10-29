export const CHAT_STORAGE_KEY = 'mission-control.agent-chat.v1';
export const MAX_CHAT_MESSAGES = 60;
export const MAX_CHAT_CONTENT = 16000;
export const MAX_CHAT_INPUT = 4000;

function loadMessages(storage) {
  try {
    const raw = storage?.getItem(CHAT_STORAGE_KEY);
    if (!raw || raw.length > 2 * 1024 * 1024) return [];
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.messages)) return [];
    return saved.messages.slice(-MAX_CHAT_MESSAGES).filter(message =>
      message && typeof message.id === 'string' && ['user', 'assistant'].includes(message.role) &&
      typeof message.content === 'string' && typeof message.createdAt === 'string' &&
      Number.isFinite(Date.parse(message.createdAt))
    ).map(message => ({
      id: message.id.slice(0, 100), role: message.role,
      content: message.content.slice(0, MAX_CHAT_CONTENT), createdAt: message.createdAt,
      status: message.status === 'pending' ? 'cancelled' : ['local', 'sent', 'complete', 'cancelled', 'error'].includes(message.status) ? message.status : 'local',
      ...(typeof message.error === 'string' ? { error: message.error.slice(0, 500) } : {}),
    }));
  } catch { return []; }
}

/**
 * Transport contract:
 * send({ messages: [{role, content}], context, signal, onDelta })
 *   -> Promise<string | {content: string} | void>
 * A streaming adapter calls onDelta(text), then resolves. No transport is
 * installed by default; offline messages are local drafts, never auto-replayed.
 */
export function createAgentSession({ storage = null, transport = null } = {}) {
  const listeners = new Set();
  let adapter = transport;
  let active = null;
  let snapshot = { messages: loadMessages(storage), pending: false, configured: !!adapter?.send, historySaved: !!storage };
  const notify = (messages = snapshot.messages, pending = snapshot.pending, persist = true) => {
    let historySaved = snapshot.historySaved;
    messages = messages.slice(-MAX_CHAT_MESSAGES);
    if (persist) {
      try {
        if (!storage) throw new Error('No storage');
        storage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ version: 1, messages }));
        historySaved = true;
      } catch { historySaved = false; }
    }
    snapshot = { messages, pending, configured: typeof adapter?.send === 'function', historySaved };
    listeners.forEach(listener => listener());
  };
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const patch = (request, fields, pending = true, persist = false) => {
    if (active !== request) return;
    notify(snapshot.messages.map(message => message.id === request.id ? { ...message, ...fields } : message), pending, persist);
  };
  const cancel = () => {
    if (!active) return;
    const request = active;
    clearTimeout(request.timer);
    request.controller.abort();
    patch(request, { content: request.text, status: 'cancelled' }, false, true);
    active = null;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    cancel,
    setTransport(next) {
      if (adapter === next) return;
      cancel(); adapter = next; notify(undefined, false, false);
    },
    clear() { cancel(); notify([], false); },
    submit(content, context = {}) {
      if (active || typeof content !== 'string' || !content.trim() || content.trim().length > MAX_CHAT_INPUT) return false;
      const user = { id: id(), role: 'user', content: content.trim(), createdAt: new Date().toISOString(), status: adapter?.send ? 'sent' : 'local' };
      if (!adapter?.send) { notify([...snapshot.messages, user], false); return true; }
      // Only explicitly submitted turns form the request. Local drafts, partial
      // replies, cancelled responses and error records stay in the local log.
      const messages = [...snapshot.messages, user].filter(message =>
        message.status === 'sent' || message.status === 'complete'
      ).slice(-MAX_CHAT_MESSAGES).map(({ role, content }) => ({ role, content }));
      const reply = { id: id(), role: 'assistant', content: '', createdAt: new Date().toISOString(), status: 'pending' };
      const request = { id: reply.id, controller: new AbortController(), text: '', timer: null };
      active = request;
      const send = adapter.send.bind(adapter);
      notify([...snapshot.messages, user, reply], true);
      const onDelta = delta => {
        if (active !== request || typeof delta !== 'string') return;
        request.text = (request.text + delta).slice(0, MAX_CHAT_CONTENT);
        if (request.timer !== null) return;
        request.timer = setTimeout(() => {
          request.timer = null;
          patch(request, { content: request.text });
        }, 50);
      };
      Promise.resolve().then(() => {
        if (active !== request) return;
        return send({ messages, context, signal: request.controller.signal, onDelta });
      }).then(result => {
        if (active !== request) return;
        clearTimeout(request.timer);
        const content = typeof result === 'string' ? result : result?.content ?? request.text;
        if (typeof content !== 'string' || !content.trim()) throw new Error('Agent returned an empty response.');
        patch(request, { content: content.slice(0, MAX_CHAT_CONTENT), status: 'complete' }, false, true);
        active = null;
      }).catch(error => {
        if (active !== request) return;
        clearTimeout(request.timer);
        patch(request, { content: request.text, status: 'error', error: String(error?.message || 'Agent request failed.').slice(0, 500) }, false, true);
        active = null;
      });
      return true;
    },
  };
}
