/** Transport for the Mission console's Snappy agent (the Python web API in
 * snappy/drone_agent_core/web.py, reached through the dashboard server's
 * /api/agent proxy). It sends only the newest message text: Snappy keeps its
 * own conversation, and no telemetry or topic list leaves the browser.
 * The access token is stored in this browser and sent as a Bearer header. */
export const SNAPPY_TOKEN_KEY = 'mission-control.snappy-token.v1';
export const SNAPPY_ENDPOINT = '/api/agent/chat';

export function loadSnappyToken(storage) {
  try { return storage?.getItem(SNAPPY_TOKEN_KEY) || ''; } catch { return ''; }
}

/** Takes `#snappy=<token>` from the page address, stores it, and removes it from the address bar. */
export function captureSnappyToken({ location = globalThis.location, history = globalThis.history, storage } = {}) {
  const hash = location?.hash || '';
  if (!hash.startsWith('#')) return '';
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get('snappy');
  if (!token) return '';
  try { storage?.setItem(SNAPPY_TOKEN_KEY, token); } catch { /* token lasts only until reload */ }
  params.delete('snappy');
  const rest = params.toString();
  try { history?.replaceState(null, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`); } catch { /* address bar keeps the fragment */ }
  return token;
}

const failure = (status, detail) => {
  if (status === 401) return 'Snappy rejected the access token. Open the dashboard with the link printed by the Snappy web server (…#snappy=TOKEN).';
  if (status === 403) return 'Snappy refused the request because it did not come from the dashboard\'s own address. Open the dashboard through its own server (npm run dev or npm run serve:lan).';
  if (status === 502 || status === 503 || status === 504) return 'Snappy is not reachable. Start it with: python3 -m drone_agent_core.web';
  return `Snappy request failed (HTTP ${status})${detail ? `: ${detail}` : ''}.`;
};

export function createSnappyTransport({ endpoint = SNAPPY_ENDPOINT, getToken, fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  return {
    async send({ messages, signal }) {
      const token = getToken?.();
      if (!token) throw new Error('No Snappy access token. Open the dashboard with the link printed by the Snappy web server (…#snappy=TOKEN).');
      const last = messages.at(-1);
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ messages: [{ role: 'user', content: last.content }] }),
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new Error(failure(503), { cause: error });
      }
      if (!response.ok) {
        let detail = '';
        try { detail = String((await response.json()).error || '').slice(0, 200); } catch { /* no JSON body */ }
        throw new Error(failure(response.status, detail));
      }
      const result = await response.json();
      if (typeof result.content !== 'string') throw new Error('Snappy response must contain a content string.');
      return result.content;
    },
  };
}
