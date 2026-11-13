// Cliente mínimo do protocolo Desktop Control para o Shell standalone. Ele
// vive no próprio Shell para que a view continue compilando quando o pacote
// opcional desktop-control não estiver instalado.
function socketUrl(target, id) {
  const protocol = target.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${target.location.host}/ws?session=${encodeURIComponent(id)}`;
}

export function installShellControlBridge({ target = window, sessionId, state, execute, reconnectMs = 1_500, heartbeatMs = 20_000 }) {
  let socket = null;
  let stopped = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let routedSessionId = '';
  const activeSessionId = () => String(typeof sessionId === 'function' ? sessionId() : sessionId || '').trim();

  const connect = () => {
    if (stopped || typeof WebSocket === 'undefined') return;
    if (reconnectTimer) target.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    routedSessionId = activeSessionId();
    if (!routedSessionId) return;
    const connection = new WebSocket(socketUrl(target, routedSessionId));
    socket = connection;
    connection.addEventListener('open', () => {
      if (socket !== connection) return;
      connection.send(JSON.stringify({
        type: 'desktop:hello', version: 2,
        clientId: `shell-ui-${crypto.randomUUID?.() || Date.now().toString(36)}`,
        state: state(),
      }));
      heartbeatTimer = target.setInterval(() => {
        if (socket === connection && connection.readyState === WebSocket.OPEN) {
          connection.send(JSON.stringify({ type: 'desktop:heartbeat' }));
        }
      }, heartbeatMs);
    });
    connection.addEventListener('message', async (event) => {
      if (socket !== connection || connection.readyState !== WebSocket.OPEN || activeSessionId() !== routedSessionId) return;
      let command;
      try { command = JSON.parse(event.data); } catch { return; }
      if (command?.type !== 'desktop:command' || !command.requestId || !command.action) return;
      try {
        const result = await execute(command.action, command.payload || {});
        if (socket !== connection || connection.readyState !== WebSocket.OPEN || activeSessionId() !== routedSessionId) return;
        connection.send(JSON.stringify({
          type: 'desktop:response', version: 2, requestId: command.requestId,
          ok: true, result, state: state(),
        }));
      } catch (error) {
        if (socket !== connection || connection.readyState !== WebSocket.OPEN || activeSessionId() !== routedSessionId) return;
        connection.send(JSON.stringify({
          type: 'desktop:response', requestId: command.requestId,
          ok: false, error: error?.message || 'Invalid command',
        }));
      }
    });
    connection.addEventListener('close', () => {
      if (socket !== connection) return;
      if (heartbeatTimer) target.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      socket = null;
      if (!stopped) reconnectTimer = target.setTimeout(connect, reconnectMs);
    });
    connection.addEventListener('error', () => { try { connection.close(); } catch {} });
  };

  connect();
  return {
    updateState() {
      const currentSessionId = activeSessionId();
      if (!socket) {
        if (currentSessionId) connect();
        return;
      }
      if (socket && currentSessionId !== routedSessionId) {
        try { socket.close(); } catch {}
        return;
      }
      if (socket?.readyState !== WebSocket.OPEN) return;
      try { socket.send(JSON.stringify({ type: 'desktop:state', version: 2, state: state() })); } catch {}
    },
    stop() {
      stopped = true;
      if (reconnectTimer) target.clearTimeout(reconnectTimer);
      if (heartbeatTimer) target.clearInterval(heartbeatTimer);
      try { socket?.close(); } catch {}
    },
  };
}
