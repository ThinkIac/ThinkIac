import { describe, expect, test, vi } from 'vitest';
import { shellStateKey, restoreSessionState, saveSessionState } from './persistence.js';

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
