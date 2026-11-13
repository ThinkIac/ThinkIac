import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const logosRequire = createRequire(require.resolve('logos/package.json'));
const { SvelteEngine } = logosRequire('./dist/src/modules/views/engine.js');
const express = logosRequire('express');
const packages = path.resolve('packages');
const screenshotDirectory = process.env.CHAT_SESSIONS_SCREENSHOT_DIR;

const implementations = [
  ['shell', path.join(packages, 'shell/views/ChatSessionsCompact.svelte')],
  ['agent', path.join(packages, 'agent/views/ChatSessionsCompact.svelte')],
];

for (const [surface, componentPath] of implementations) {
  test(`${surface}: ChatSessionsCompact preserves states, paging and keyboard actions`, { timeout: 60_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), `chat-sessions-${surface}-`));
    let browser;
    let server;
    try {
      const probe = path.join(directory, 'ChatSessionsProbe.svelte');
      await writeFile(probe, `<script>
        import ChatSessionsCompact from '${componentPath}';
        const tabs = [
          { sessionId: 's1', name: 'Nome muito longo que precisa ser truncado para caber no widget' },
          { sessionId: 's2', name: 'Ativa' },
          { sessionId: 's3', name: 'Carregando' },
          { sessionId: 's4', name: 'Não lida' },
          { sessionId: 's5', name: 'Loading prioritário' },
          { sessionId: 's6', name: 'Seis' },
          { sessionId: 's7', name: 'Sete' },
          { sessionId: 's8', name: 'Oito' },
          { sessionId: 's9', name: 'Fixada', pinned: true },
          { sessionId: 's10', name: 'Dez' },
        ];
        let events = [];
        let populated = true;
        let theme = 'dark';
        function record(type, event) { events = [...events, type + ':' + event.detail]; }
      </script>
      <svelte:head><meta name="viewport" content="width=device-width, initial-scale=1" /></svelte:head>
      <main data-theme={theme}>
        <button id="empty" on:click={() => populated = false}>Empty</button>
        <button id="dark" on:click={() => theme = 'dark'}>Dark</button>
        <button id="light" on:click={() => theme = 'light'}>Light</button>
        <div class="fixture">
          <ChatSessionsCompact
            chatTabs={populated ? tabs : []}
            activeTab="s2"
            loadingMap={{ s2: true, s3: true, s5: true }}
            unreadMap={{ s2: true, s4: true, s5: true }}
            on:selectChat={(event) => record('select', event)}
            on:togglePin={(event) => record('pin', event)}
            on:closeChat={(event) => record('close', event)}
          />
        </div>
        <output id="events">{events.join(',')}</output>
      </main>
      <style>
        main { --rail-border: rgba(255,255,255,.09); --rail-border-hi: rgba(255,255,255,.16); --rail-flat: #181818; --rail-txt: #f5f5f5; --rail-txt-2: #cccccc; --rail-txt-3: #888888; min-height: 100dvh; padding: 16px; background: #111111; }
        main[data-theme="light"] { --rail-border: rgba(0,0,0,.10); --rail-border-hi: rgba(0,0,0,.18); --rail-flat: #f5f5f5; --rail-txt: #1a1a1a; --rail-txt-2: #444444; --rail-txt-3: #666666; background: #ffffff; }
        .fixture { width: 260px; }
      </style>`);

      const html = await new SvelteEngine(directory).render(probe, `${surface}__ChatSessionsProbe`, {}, packages);
      const app = express();
      app.use('/svelte-cache', express.static(directory));
      app.get('/fixture', (_req, res) => res.type('html').send(html));
      server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      });
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);

      assert.equal(await page.$$eval('.csc-item', (nodes) => nodes.length), 8);
      assert.equal(await page.$eval('.csc-item .csc-label', (node) => node.textContent), 'Fixada');
      assert.equal(await page.$$eval('.csc-status-loading', (nodes) => nodes.length), 2);
      assert.equal(await page.$$eval('.csc-status-unread', (nodes) => nodes.length), 1);
      assert.equal(await page.$$eval('.csc-item.active .csc-status', (nodes) => nodes.length), 0);
      assert.equal(await page.$eval('.csc-item:nth-child(2) .csc-label', (node) => node.scrollWidth > node.clientWidth), true);
      assert.equal(await page.$eval('.fixture', (node) => node.scrollWidth <= node.clientWidth), true);

      if (screenshotDirectory) {
        await mkdir(screenshotDirectory, { recursive: true });
        await page.screenshot({ path: path.join(screenshotDirectory, `${surface}-desktop-dark.png`) });
      }
      await page.click('#light');
      assert.equal(await page.$eval('main', (node) => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
      if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, `${surface}-desktop-light.png`) });
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      await page.waitForSelector('.csc-item');
      await page.click('#light');
      assert.equal(await page.$eval('main', (node) => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
      assert.equal(await page.$eval('.csc-pin', (node) => getComputedStyle(node).width), '36px');
      assert.equal(await page.$eval('.fixture', (node) => node.scrollWidth <= node.clientWidth), true);
      if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, `${surface}-mobile-light.png`) });
      await page.click('#dark');
      assert.equal(await page.$eval('main', (node) => getComputedStyle(node).backgroundColor), 'rgb(17, 17, 17)');
      if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, `${surface}-mobile-dark.png`) });

      const rows = await page.$$('.csc-item');
      await rows[2].focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.$eval('#events', (node) => node.textContent), 'select:s2');

      const pin = await rows[1].$('.csc-pin');
      await pin.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.$eval('#events', (node) => node.textContent), 'select:s2,pin:s1');

      const close = await rows[1].$('.csc-close');
      await close.focus();
      await page.keyboard.press('Space');
      assert.equal(await page.$eval('#events', (node) => node.textContent), 'select:s2,pin:s1,close:s1');

      await page.click('[aria-label="Próxima página"]');
      assert.equal(await page.$$eval('.csc-item', (nodes) => nodes.length), 2);
      assert.equal(await page.$eval('[aria-current="page"]', (node) => node.textContent), '2 de 2');

      await page.click('#empty');
      assert.equal(await page.$$eval('.csc-list, .csc-pagination', (nodes) => nodes.length), 0);
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
