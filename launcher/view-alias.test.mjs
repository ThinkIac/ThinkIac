import assert from 'node:assert/strict';
import test from 'node:test';
import { profileShellCompatibility } from '../lib/view-alias.js';

test('the default profile sends home to Shell and preserves catalog queries', () => {
  const middleware = profileShellCompatibility({ shell: true, nestedRuntime: true, desktop: false });
  const catalog = { url: '/shell/apps/list?limit=5' };
  middleware(catalog, {}, () => {});
  assert.equal(catalog.url, '/shell/runtime/apps/list?limit=5');

  const redirects = [];
  const response = { redirect: (...args) => redirects.push(args) };
  middleware({ method: 'GET', path: '/redirect/home', url: '/redirect/home' },
    response, () => response.redirect(302, '/view/desktop/Index'));
  assert.deepEqual(redirects, [[302, '/view/shell/Index']]);
});
