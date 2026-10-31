export const CONTROLS_KEY = 'mission-control.ros-controls.v1';
export const COMMAND_LOG_KEY = 'mission-control.command-log.v1';
export const MAX_CONTROLS = 16;
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function validateControl(input) {
  if (!input || !['service', 'publish'].includes(input.kind)) throw new Error('Choose a service call or topic publication.');
  const label = String(input.label || '').trim();
  const endpoint = String(input.endpoint || '').trim();
  const type = String(input.type || '').trim();
  if (!label || label.length > 60) throw new Error('Enter a control name of up to 60 characters.');
  if (!/^\/[A-Za-z0-9_/{}]+$/.test(endpoint) || endpoint.length > 240 || /\{(?!vehicle\})/.test(endpoint) || endpoint.replaceAll('{vehicle}', '').includes('}')) throw new Error('Enter an absolute ROS endpoint; {vehicle} is the supported namespace placeholder.');
  if (!/^[A-Za-z][A-Za-z0-9_]*\/(?:(?:msg|srv)\/)?[A-Za-z][A-Za-z0-9_]*$/.test(type)) throw new Error('Enter a ROS type such as std_srvs/srv/Trigger or std_msgs/msg/Bool.');
  const text = typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? {});
  if (text.length > 16000) throw new Error('Keep the request below 16,000 characters.');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Request must be valid JSON.'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Request must be a JSON object.');
  return { id: typeof input.id === 'string' && input.id ? input.id.slice(0, 80) : uid(), label, kind: input.kind, endpoint, type, payload };
}

export function resolveControl(control, namespace) {
  const valid = validateControl(control);
  const target = String(namespace || '').replace(/^\/+|\/+$/g, '');
  if (target && !/^[A-Za-z_][A-Za-z0-9_/]*$/.test(target)) throw new Error('Target namespace is invalid.');
  const endpoint = valid.endpoint.replaceAll('{vehicle}', target).replace(/\/{2,}/g, '/');
  if (!/^\/[A-Za-z_][A-Za-z0-9_/]*$/.test(endpoint)) throw new Error('Resolved ROS endpoint is invalid.');
  return { ...valid, endpoint, target: target ? `/${target}` : '/' };
}

export function loadControls(storage) {
  try {
    const raw = storage?.getItem(CONTROLS_KEY) || '[]';
    if (raw.length > 300000) return [];
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    return saved.slice(0, MAX_CONTROLS).flatMap(item => { try { return [validateControl(item)]; } catch { return []; } });
  } catch { return []; }
}

export function loadCommandLog(storage) {
  try {
    const raw = storage?.getItem(COMMAND_LOG_KEY) || '[]';
    if (raw.length > 200000) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item.label === 'string' && typeof item.endpoint === 'string' && typeof item.message === 'string' && Number.isFinite(Date.parse(item.at))).slice(-40).map(item => ({
      id: String(item.id || item.at).slice(0, 100), at: item.at, label: item.label.slice(0, 60), endpoint: item.endpoint.slice(0, 240),
      state: item.state === 'pending' ? 'unknown' : item.state,
      message: item.state === 'pending' ? 'The page closed before a response was recorded. Outcome unknown; no retry was sent.' : item.message.slice(0, 2000),
    }));
  } catch { return []; }
}

function responseText(value, depth = 0) {
  const bound = (item, level) => {
    if (typeof item === 'string') return item.slice(0, 1000);
    if (!item || typeof item !== 'object') return item;
    if (level >= 3) return '[…]';
    if (Array.isArray(item)) return item.slice(0, 12).map(entry => bound(entry, level + 1));
    return Object.fromEntries(Object.entries(item).slice(0, 20).map(([key, entry]) => [key, bound(entry, level + 1)]));
  };
  return JSON.stringify(bound(value, depth)).slice(0, 2000);
}

// One explicit request only. Never queue or replay commands after reconnect.
export function executeRosControl(ros, command, timeoutMs = 6000) {
  if (!ros?.isConnected) return Promise.reject(new Error('Connect to rosbridge before sending a command.'));
  let valid;
  try {
    valid = resolveControl(command, command.target);
    if (command.endpoint.includes('{vehicle}')) throw new Error('Resolve the target before sending.');
  } catch (error) { return Promise.reject(error); }
  const id = `mission-control:${uid()}`;
  if (valid.kind === 'publish') {
    try {
      ros.callOnConnection({ op: 'advertise', id: `${id}:advertise`, topic: valid.endpoint, type: valid.type, queue_size: 1, latch: false });
      ros.callOnConnection({ op: 'publish', id, topic: valid.endpoint, msg: valid.payload });
      ros.callOnConnection({ op: 'unadvertise', id: `${id}:advertise`, topic: valid.endpoint });
      return Promise.resolve({ state: 'sent', message: 'Published once. Vehicle execution is not confirmed.' });
    } catch (error) { return Promise.reject(error); }
  }
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); ros.off(id, response); ros.off('close', closed); };
    const closed = () => { cleanup(); reject(new Error('Connection lost. Command outcome is unknown; it will not be retried.')); };
    const response = packet => {
      cleanup();
      if (!packet.result) { reject(new Error(String(packet.values || 'Service rejected the request.').slice(0, 500))); return; }
      resolve({ state: packet.values?.success === false ? 'rejected' : 'replied', message: responseText(packet.values ?? {}) });
    };
    ros.once(id, response); ros.once('close', closed);
    timer = setTimeout(() => { cleanup(); reject(new Error('No service response. Command outcome is unknown; it will not be retried.')); }, timeoutMs);
    try { ros.callOnConnection({ op: 'call_service', id, service: valid.endpoint, args: valid.payload, timeout: Math.max(1, timeoutMs / 1000 - 1) }); }
    catch (error) { cleanup(); reject(error); }
  });
}

export function missionConsoleReply(input, context) {
  const text = input.trim();
  if (text === '/help') return '/status — connection and selected target\n/topics — subscribed topic names\n/controls — configured ROS controls\nOther messages are saved as local mission notes. Vehicle commands are sent only from the command dock after review.';
  if (text === '/status') return `Connection: ${context.status}\nTarget: ${context.target || 'No vehicle selected'}\nSubscribed sources: ${context.topics.length}`;
  if (text === '/topics') return context.topics.map(topic => `${topic.name} (${topic.type})`).join('\n') || 'No topics selected. Open Topics to connect and subscribe.';
  if (text === '/controls') return context.controls.map(control => `${control.label}: ${control.kind} ${control.endpoint}`).join('\n') || 'No ROS controls configured. Choose Add control in the command dock.';
  if (text.startsWith('/')) return 'Unknown console command. Use /help for available commands.';
  return 'Recorded as a local mission note.';
}
