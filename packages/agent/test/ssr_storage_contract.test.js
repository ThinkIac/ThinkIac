import assert from 'node:assert/strict';
import test from 'node:test';

test('browser preference modules can be imported during SSR without localStorage', async () => {
  const previous = globalThis.localStorage;
  try {
    delete globalThis.localStorage;
    for (const module of [
      '../views/lib/app_folders.js',
      '../views/lib/app_layout.js',
      '../views/lib/app_usage.js',
      '../views/lib/menu_bootstrap.js',
      '../views/lib/profiles_bootstrap.js',
    ]) {
      await assert.doesNotReject(() => import(`${module}?ssr=${Date.now()}-${Math.random()}`));
    }
  } finally {
    if (previous !== undefined) globalThis.localStorage = previous;
  }
});
