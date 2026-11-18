import { describe, expect, test, vi } from 'vitest';
import { shellStateKey, restoreSessionState, saveSessionState, saveWidgetCache, writeShellStorage } from './persistence.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
  };
}

describe('persistência do Shell por matriz Desktop', () => {
  test('separa cada combinação de workspace e janela', () => {
    expect(shellStateKey({ workspaceId: 'main', shellId: 'shell-a' }))
      .not.toBe(shellStateKey({ workspaceId: 'main', shellId: 'shell-b' }));
    expect(shellStateKey({ workspaceId: 'main', shellId: 'shell-a' }))
      .not.toBe(shellStateKey({ workspaceId: 'research', shellId: 'shell-a' }));
  });

  test('restaura somente o snapshot da janela solicitada', () => {
    const storage = memoryStorage();
    saveSessionState({ tabs: [{ sessionId: 'chat-a' }] }, { workspaceId: 'main', shellId: 'shell-a' }, storage);
    saveSessionState({ tabs: [{ sessionId: 'chat-b' }] }, { workspaceId: 'main', shellId: 'shell-b' }, storage);

    expect(restoreSessionState({ workspaceId: 'main', shellId: 'shell-a' }, storage).tabs[0].sessionId).toBe('chat-a');
    expect(restoreSessionState({ workspaceId: 'main', shellId: 'shell-b' }, storage).tabs[0].sessionId).toBe('chat-b');
  });

  test('não persiste o cache duplicado de histórico de chat', () => {
    const storage = memoryStorage();
    saveSessionState({
      tabs: [{ sessionId: 'chat-a' }],
      sessionCache: { 'chat-a': [{ role: 'assistant', content: 'payload grande' }] },
    }, { workspaceId: 'main', shellId: 'shell-a' }, storage);

    const state = restoreSessionState({ workspaceId: 'main', shellId: 'shell-a' }, storage);
    expect(state.tabs).toEqual([{ sessionId: 'chat-a' }]);
    expect(state.sessionCache).toBeUndefined();
  });
});

test('quota preserves the previous snapshot and reports only storage metadata', () => {
  const storage = memoryStorage();
  const scope = { workspaceId: 'main', shellId: 'quota-test' };
  const key = shellStateKey(scope);
  saveSessionState({ tabs: ['previous'] }, scope, storage);
  storage.length = 1;
  storage.key = () => key;
  storage.setItem.mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(saveSessionState({ tabs: ['next'] }, scope, storage)).toBe(false);
    expect(restoreSessionState(scope, storage).tabs).toEqual(['previous']);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('[Shell] Browser storage write failed', {
      operation: 'window state',
      error: 'QuotaExceededError',
      estimatedBytes: expect.any(Number),
      usage: { desktopSnapshots: { keys: 1, estimatedBytes: expect.any(Number) } },
    });
    expect(writeShellStorage('current_sessionId', 'next', 'session selection', storage)).toBe(false);
  } finally {
    warn.mockRestore();
  }
});

test('widget cache fits its byte budget and skips unchanged writes', () => {
  const storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  try {
    const items = [{ title: 'x'.repeat(100_000) }, { title: 'A' }, { title: 'y'.repeat(40_000) }, { title: 'z'.repeat(40_000) }];
    expect(saveWidgetCache('preview', items, 200, 'preview', 'device-a')).toBe(true);
    const value = storage.getItem('preview');
    expect(2 * ('preview'.length + value.length)).toBeLessThanOrEqual(128 * 1024);
    expect(JSON.parse(value)).toEqual({ scope: 'device-a', items: items.slice(1, 3) });
    expect(saveWidgetCache('preview', items, 200, 'preview', 'device-a')).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
