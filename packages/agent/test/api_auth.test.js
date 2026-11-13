import assert from 'node:assert/strict';
import test from 'node:test';
import { api as agentApi } from '../views/api.js';
import { api as desktopApi } from '../../desktop/views/lib/api.js';
import { api as shellApi } from '../../shell/views/api.js';

for (const [name, api] of [['Agent', agentApi], ['Desktop', desktopApi], ['Shell', shellApi]]) {
  test(`${name}: respostas válidas, sessão expirada e acesso negado`, async (t) => {
    const redirects = [];
    t.mock.method(globalThis, 'fetch', async () => ({
      status: 200, ok: true, url: 'https://thinkiac.test/agent/session',
      json: async () => ({ data: { success: true } }),
      text: async () => JSON.stringify({ data: { success: true } }),
    }));
    const previous = globalThis.window;
    globalThis.window = {
      location: { href: 'https://thinkiac.test/desktop?tab=chat#work', pathname: '/desktop', search: '?tab=chat', hash: '#work' },
      top: { location: { replace: (url) => redirects.push(url) } },
    };
    t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
    assert.deepEqual(await api('/session'), { success: true });
    assert.equal(redirects.length, 0);
    for (const status of [401, 403]) {
      fetch.mock.mockImplementation(async () => ({ status, ok: false, url: 'https://thinkiac.test/agent/session',
        json: async () => ({ error: 'Acesso negado' }), text: async () => '{"error":"Acesso negado"}' }));
      if (name === 'Desktop') await assert.rejects(api('/session'));
      else await api('/session');
      assert.equal(redirects.length, 1, 'somente 401 deve redirecionar');
    }
    assert.equal(redirects[0], '/view/auth/Login?next=%2Fdesktop%3Ftab%3Dchat%23work');
    fetch.mock.mockImplementation(async () => ({ status: 200, ok: true, url: 'https://thinkiac.test/view/auth/Login' }));
    if (name === 'Desktop') await assert.rejects(api('/session'));
    else assert.equal(await api('/session'), null);
    assert.equal(redirects.length, 2);
  });
}
