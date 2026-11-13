import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Agent and Shell define a theme-aware, compact global scrollbar', async () => {
  const [home, shell, agentTheme, shellTheme] = await Promise.all([
    read('agent/views/Home.svelte'),
    read('shell/views/Index.svelte'),
    read('agent/views/theme.js'),
    read('shell/views/theme.js'),
  ]);

  for (const source of [agentTheme, shellTheme]) {
    assert.match(source, /scrollbar-width:\s*thin/);
    assert.match(source, /::-webkit-scrollbar\s*\{\s*width:\s*6px/);
    assert.match(source, /::-webkit-scrollbar-thumb:hover/);
    assert.match(source, /thinkiac-theme-scrollbar/);
  }

  assert.match(agentTheme, /export function applyThemeScrollbarToDocument/);
  assert.match(agentTheme, /export function applyThemeToDocument/);
  assert.match(home, /applyThemeToDocument\(iframeRefs\[tab\.id\]\?\.contentDocument\)/);
  assert.match(shell, /applyThemeToDocument\(iframeRefs\[tab\.id\]\?\.contentDocument\)/);
  assert.match(shellTheme, /--thinkiac-scrollbar-thumb:\s*rgba\(245, 245, 245, \.14\)/);
  assert.match(shellTheme, /--thinkiac-scrollbar-thumb-hover:\s*rgba\(245, 245, 245, \.30\)/);
  assert.match(shellTheme, /!important/);
});

test('Shell aplica o contrato de scrollbar aos seus iframes same-origin', async () => {
  const [shell, theme] = await Promise.all([
    read('shell/views/Index.svelte'),
    read('shell/views/theme.js'),
  ]);

  assert.match(shell, /applyThemeToDocument\(iframeRefs\[tab\.id\]\?\.contentDocument\)/);
  assert.match(theme, /thinkiac-theme-scrollbar/);
  assert.match(theme, /--thinkiac-scrollbar-thumb/);
});
