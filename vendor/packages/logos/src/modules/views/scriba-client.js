// Explicit browser client for the transport acceptance gate. The automatic
// useState compiler integration remains experimental and is not enabled here.
export function createScribaClient({ url, id, channel = 'scriba:state', onPresence = () => {}, WebSocket: Socket = globalThis.WebSocket, onChange = () => {}, reconnectMs = 1000 }) {
  let socket, timer, watchdog, stopped = false, pending = null, sentOn = null, lastSeen = 0;
  let state = { status: 'connecting', snapshot: null, role: null, pending: false, error: null };
  const publish = patch => { state = { ...state, ...patch }; onChange(state); };
  const send = frame => socket.send(JSON.stringify({ channel, id, ...frame }));
  function apply(snapshot) {
    if (snapshot && (!state.snapshot || snapshot.version >= state.snapshot.version)) publish({ snapshot });
  }
  function retry() {
    if (pending && sentOn !== socket) { sentOn = socket; send(pending); }
  }
  function connect() {
    if (stopped) return;
    publish({ status: 'connecting' });
    const current = socket = new Socket(url);
    current.onopen = () => {
      if (stopped || socket !== current) return;
      lastSeen = Date.now();
      send({ action: 'subscribe' });
      clearInterval(watchdog);
      watchdog = setInterval(() => { if (Date.now() - lastSeen > 20000) current.close(); }, 5000);
    };
    current.onmessage = event => {
      if (stopped || socket !== current) return;
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.channel !== channel || (frame.id && frame.id !== id)) return;
      lastSeen = Date.now();
      if (frame.action === 'presence') { onPresence(frame.peers || []); return; }
      if (frame.action === 'revoked' || ['UNAUTHENTICATED', 'ORIGIN_DENIED', 'SCRIBA_TRANSPORT_UNAVAILABLE'].includes(frame.error)) {
        pending = null;
        publish({ status: 'denied', snapshot: null, role: null, pending: false, error: frame.error });
        stopped = true; clearInterval(watchdog); current.close();
      } else if (frame.action === 'snapshot') {
        apply(frame.snapshot);
        publish({ status: 'connected', role: frame.role });
        retry();
      } else if (frame.action === 'ack') {
        apply(frame.snapshot);
        if (pending?.operationId === frame.operationId) { pending = null; publish({ pending: false, error: null }); }
      } else if (frame.action === 'error') {
        apply(frame.snapshot);
        if (pending?.operationId === frame.operationId) pending = null;
        publish({ pending: Boolean(pending), error: frame.error });
        if (frame.error === 'FORBIDDEN' && !state.snapshot) {
          publish({ status: 'denied', snapshot: null, role: null });
          stopped = true; clearInterval(watchdog); current.close();
        } else if (frame.operationId) send({ action: 'subscribe' });
        else { publish({ status: 'denied' }); stopped = true; clearInterval(watchdog); current.close(); }
      }
    };
    current.onclose = () => {
      if (stopped || socket !== current) return;
      clearInterval(watchdog);
      publish({ status: 'disconnected' });
      timer = setTimeout(connect, reconnectMs);
    };
    current.onerror = () => current.close();
  }
  connect();
  return {
    presence(value) { if (state.status === 'connected' && socket.readyState === 1) send({ action: 'presence', value }); },
    get state() { return state; },
    patch(patches) {
      if (state.status !== 'connected' || socket.readyState !== 1) throw new Error('STATE_OFFLINE');
      if (!['owner', 'editor'].includes(state.role)) throw new Error('FORBIDDEN');
      if (pending) throw new Error('STATE_PENDING');
      pending = { action: 'patch', operationId: globalThis.crypto.randomUUID(), issuedAt: Date.now(),
        baseVersion: state.snapshot?.version ?? 0, patches: JSON.parse(JSON.stringify(patches)) };
      publish({ pending: true, error: null });
      sentOn = null; retry();
    },
    reconnect() { if (!stopped) socket.close(); },
    destroy() { stopped = true; clearTimeout(timer); clearInterval(watchdog); socket?.close(); pending = null; state = { ...state, snapshot: null }; },
  };
}
