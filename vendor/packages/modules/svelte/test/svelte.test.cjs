'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { SvelteEngine, HOT_RELOAD_MODES, isHotReloadMode } = require('..');

test('exports the Svelte runtime contract', () => {
  assert.equal(typeof SvelteEngine, 'function');
  assert.deepEqual(HOT_RELOAD_MODES, ['always', 'auto', 'prompt', 'manual']);
  assert.equal(isHotReloadMode('auto'), true);
  assert.equal(isHotReloadMode('unexpected'), false);
});

test('renders and hydrates a Svelte page without Logos internals', async () => {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-svelte-'));
  const workspace = join(root, 'packages');
  const source = join(workspace, 'demo', 'views', 'Index.svelte');
  const cache = join(root, 'cache');
  try {
    mkdirSync(join(workspace, 'demo', 'views'), { recursive: true });
    writeFileSync(source, '<script>export let name = "world";</script><h1>Hello {name}</h1>');
    const html = await new SvelteEngine(cache).render(source, 'demo__Index', { name: 'Svelte' }, workspace);
    assert.match(html, /Hello Svelte/);
    assert.match(html, /svelte-cache\/demo__Index\.DOM\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
