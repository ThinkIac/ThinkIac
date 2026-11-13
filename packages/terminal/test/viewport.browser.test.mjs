import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function bundle(source) {
  const result = await build({
    stdin: { contents: "import Terminal from './Index.svelte'; new Terminal({target: document.body});", resolveDir: path.join(root, 'views') },
    bundle: true, write: false, format: 'iife',
    plugins: [{ name: 'terminal-svelte', setup(builder) {
      builder.onLoad({ filter: /Index\.svelte$/ }, () => ({
        contents: compile(source, { filename: path.join(root, 'views/Index.svelte'), css: 'injected' }).js.code,
        resolveDir: path.join(root, 'views'),
      }));
    } }],
  });
  return result.outputFiles[0].text;
}

test('viewport height keeps the actual xterm visible, including keyboard resize', async () => {
  const source = await readFile(path.join(root, 'views/Index.svelte'), 'utf8');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const broken of [true, false]) {
      const code = await bundle(broken
        ? source.replace("viewportHeight > 0 ? `${viewportHeight}px` : '100dvh'", "viewportHeight || '100dvh'")
        : source);
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('http://terminal.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.startsWith('/vendor/xterm/')) {
          const filename = path.basename(url.pathname);
          return route.fulfill({ body: await readFile(path.join(root, '../../public/vendor/xterm', filename)), contentType: filename.endsWith('.css') ? 'text/css' : 'text/javascript' });
        }
        const responses = { '/terminal/profiles': { profiles: ['default'] }, '/terminal/token': { token: 'test' }, '/terminal/capabilities': { pty: true } };
        if (responses[url.pathname]) return route.fulfill({ json: responses[url.pathname] });
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>' });
      });
      await page.addInitScript(() => {
        window.WebSocket = class {
          static OPEN = 1;
          readyState = 1;
          constructor() { setTimeout(() => this.onopen?.(), 0); }
          send(raw) {
            const msg = JSON.parse(raw);
            if (msg.action === 'start') setTimeout(() => {
              for (const payload of [ { type: 'terminal:pty:started', ptyId: msg.ptyId }, { type: 'terminal:pty:data', ptyId: msg.ptyId, data: 'VISIBLE_PROMPT $ ' } ]) this.onmessage?.({ data: JSON.stringify(payload) });
            }, 0);
          }
          close() {}
        };
      });
      await page.goto('http://terminal.test/');
      await page.addScriptTag({ content: code });
      await page.waitForFunction(() => document.querySelector('.terminal-accessible-output')?.textContent.includes('VISIBLE_PROMPT'));
      for (const height of [844, 420, 844]) {
        await page.setViewportSize({ width: 390, height });
        await page.waitForTimeout(250);
        const size = await page.locator('.terminal-body').evaluate(el => el.getBoundingClientRect().height);
        if (broken) assert.equal(size, 0, 'old code reproduces zero-height terminal');
        else {
          assert.ok(size > 100 && size < height, `terminal height ${size} fits viewport ${height}`);
          assert.ok(await page.locator('.xterm-rows').innerText().then(text => text.includes('VISIBLE_PROMPT')));
        }
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); }
});
