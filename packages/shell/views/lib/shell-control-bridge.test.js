import { afterEach, describe, expect, test, vi } from 'vitest';
import { installShellControlBridge } from './shell-control-bridge.js';

const sockets = [];
class FakeWebSocket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); this.send = vi.fn(); sockets.push(this); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  emit(type, value = {}) { this.listeners.get(type)?.(value); }
  close() { this.readyState = 3; this.emit('close'); }
}

function target() {
  return {
    location: { protocol: 'https:', host: 'thinkiac.test' },
    setTimeout: vi.fn(() => 3), clearTimeout: vi.fn(),
    setInterval: vi.fn(() => 4), clearInterval: vi.fn(),
  };
}

afterEach(() => { sockets.length = 0; vi.restoreAllMocks(); });

describe('installShellControlBridge', () => {
  test('conecta quando uma sessão inicialmente vazia se torna rastreável', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let sessionId = '';
    const bridge = installShellControlBridge({
      target: target(), sessionId: () => sessionId, execute: vi.fn(),
      state: () => ({ workspaces: [], windows: [], apps: [] }),
    });
    expect(sockets).toHaveLength(0);
    sessionId = 'orbit-ready';
    bridge.updateState();
    expect(sockets[0].url).toContain('session=orbit-ready');
    bridge.stop();
  });

  test('publica catálogo e responde abertura na sessão solicitante', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const execute = vi.fn().mockResolvedValue({ activeWindowId: 'terminal-tab' });
    const bridge = installShellControlBridge({
      target: target(), sessionId: 'orbit-a', execute,
      state: () => ({ activeWorkspace: 'shell', activeWindowId: 'terminal-tab', workspaces: [], windows: [], apps: [] }),
    });
    const socket = sockets[0]; socket.readyState = 1; socket.emit('open');
    socket.emit('message', { data: JSON.stringify({ type: 'desktop:command', requestId: 'r1', action: 'open_app', payload: { appId: 'terminal' } }) });
    await Promise.resolve(); await Promise.resolve();
    expect(socket.url).toContain('session=orbit-a');
    expect(execute).toHaveBeenCalledWith('open_app', { appId: 'terminal' });
    expect(JSON.parse(socket.send.mock.calls[1][0])).toMatchObject({ requestId: 'r1', ok: true });
    bridge.stop();
  });

  test('troca a rota da sessão e descarta resposta da conexão anterior', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let sessionId = 'orbit-a';
    let finish;
    const execution = new Promise((resolve) => { finish = resolve; });
    const ui = target();
    const bridge = installShellControlBridge({ target: ui, sessionId: () => sessionId, execute: () => execution, state: () => ({ workspaces: [], windows: [], apps: [] }) });
    const first = sockets[0]; first.readyState = 1; first.emit('open');
    first.emit('message', { data: JSON.stringify({ type: 'desktop:command', requestId: 'old', action: 'open_app' }) });
    sessionId = 'orbit-b';
    bridge.updateState();
    ui.setTimeout.mock.calls.at(-1)[0]();
    const second = sockets[1]; second.readyState = 1; second.emit('open');
    finish({ opened: true });
    await Promise.resolve(); await Promise.resolve();
    expect(second.url).toContain('session=orbit-b');
    expect(second.send).toHaveBeenCalledTimes(1);
    bridge.stop();
  });

  test('ignora comando entregue por socket antigo antes de executar', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let sessionId = 'orbit-a';
    const execute = vi.fn();
    const ui = target();
    const bridge = installShellControlBridge({ target: ui, sessionId: () => sessionId, execute, state: () => ({ workspaces: [], windows: [], apps: [] }) });
    const first = sockets[0]; first.readyState = 1; first.emit('open');
    sessionId = 'orbit-b';
    bridge.updateState();
    ui.setTimeout.mock.calls.at(-1)[0]();
    first.emit('message', { data: JSON.stringify({ type: 'desktop:command', requestId: 'old', action: 'open_app' }) });
    expect(execute).not.toHaveBeenCalled();
    bridge.stop();
  });

  test('ignora comando quando a sessão muda antes da atualização reativa', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    let sessionId = 'orbit-a';
    const execute = vi.fn();
    const bridge = installShellControlBridge({ target: target(), sessionId: () => sessionId, execute, state: () => ({ workspaces: [], windows: [], apps: [] }) });
    const socket = sockets[0]; socket.readyState = 1; socket.emit('open');
    sessionId = 'orbit-b';
    socket.emit('message', { data: JSON.stringify({ type: 'desktop:command', requestId: 'old', action: 'open_app' }) });
    expect(execute).not.toHaveBeenCalled();
    bridge.stop();
  });

  test('ignora mensagens depois que o bridge é encerrado', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const execute = vi.fn();
    const bridge = installShellControlBridge({ target: target(), sessionId: 'orbit-a', execute, state: () => ({ workspaces: [], windows: [], apps: [] }) });
    const socket = sockets[0]; socket.readyState = 1; socket.emit('open');
    bridge.stop();
    socket.emit('message', { data: JSON.stringify({ type: 'desktop:command', requestId: 'late', action: 'open_app' }) });
    expect(execute).not.toHaveBeenCalled();
  });
});
