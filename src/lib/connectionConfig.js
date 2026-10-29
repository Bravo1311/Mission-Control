export function defaultBridgeUrl(location, bridgePath) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (typeof bridgePath === 'string' && bridgePath.startsWith('/') && !bridgePath.startsWith('//')) {
    const url = new URL(bridgePath, location.href);
    if (url.origin === location.origin) return `${protocol}//${url.host}${url.pathname}${url.search}`;
  }
  const hostname = location.hostname.replace(/^\[|\]$/g, '');
  return `${protocol}//${hostname.includes(':') ? `[${hostname}]` : hostname}:2019`;
}

export async function loadBridgeUrl(location, fetcher = fetch) {
  try {
    const response = await fetcher('/dashboard-config.json', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const config = await response.json();
      return defaultBridgeUrl(location, config.bridgePath);
    }
  } catch { /* Vite and other static hosts work with a directly reachable bridge. */ }
  return defaultBridgeUrl(location);
}
