export function streamStatus(buffer, connection, now, { paused = false, standby = false } = {}) {
  if (paused) return 'Paused';
  if (standby) return 'Standby';
  if (connection !== 'connected') return connection === 'connecting' ? 'Connecting' : 'Disconnected';
  if (!buffer?.raw?.length || !buffer.reception) return 'Waiting';
  const staleAfter = Math.max(3000, 3000 / (buffer.reception.fps || 1));
  return now - buffer.reception.last > staleAfter ? 'Stale' : 'Live';
}
