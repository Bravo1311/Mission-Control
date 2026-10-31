import { createContext, useContext, useEffect, useState } from 'react';

export const PanelActionsContext = createContext(null);

// The grid keeps small view settings while a hidden panel releases its
// renderers/workers. Telemetry buffers continue to belong to TelemetryProvider.
export function usePanelPreference(key, initial) {
  const context = useContext(PanelActionsContext);
  const [value, setValue] = useState(() => {
    const saved = context?.readState(key);
    return saved !== undefined ? saved : typeof initial === 'function' ? initial() : initial;
  });
  useEffect(() => { context?.writeState(key, value); }, [context, key, value]);
  return [value, setValue];
}
