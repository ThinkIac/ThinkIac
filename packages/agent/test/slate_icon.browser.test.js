import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const logosRequire = createRequire(require.resolve('logos/package.json'));
const { SvelteEngine } = logosRequire('./dist/src/modules/views/engine.js');
const express = logosRequire('express');
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packages = path.join(repository, 'packages');

const implementations = [
  ['shell', path.join(packages, 'shell/views/components/SlateIcon.svelte')],
  ['agent', path.join(packages, 'agent/views/components/SlateIcon.svelte')],
];

for (const [surface, componentPath] of implementations) {
  test(`${surface}: SlateIcon matches the app icon manifest contract`, { timeout: 60_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), `slate-icon-${surface}-`));
    let browser;
    let server;
    try {
      const probe = path.join(directory, 'SlateIconProbe.svelte');
      await writeFile(probe, `<script>
        import SlateIcon from '${componentPath}';
        const image = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"%3E%3Ccircle cx="5" cy="5" r="5" fill="%2300aa55"/%3E%3C/svg%3E';
        let iconSize = 14;
        const apps = {
          mono: { name: 'Mono', color: '#ffffff', iconSvg: '<svg data-asset="mono" viewBox="0 0 10 10"><path fill="currentColor" d="M0 0h10v10H0z"/></svg>' },
          colored: { name: 'Colored', bgColor: '#123456', iconSvg: '<svg data-asset="colored" viewBox="0 0 10 10"><path fill="#e87924" d="M0 0h10v10H0z"/></svg>' },
          image: { name: 'Image', icon: image },
          fallback: { name: 'Fallback' },
          darkSvg: { name: 'Dark SVG', iconSvg: '<svg data-asset="light-svg" viewBox="0 0 10 10"></svg>', iconDarkSvg: '<svg data-asset="dark-svg" viewBox="0 0 10 10"></svg>' },
          darkImage: { name: 'Dark image', icon: image, iconDark: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"%3E%3Crect width="10" height="10" fill="%230055aa"/%3E%3C/svg%3E' },
          minPadding: { name: 'Min', iconSvg: '<svg viewBox="0 0 10 10"></svg>', padding: -5 },
          maxPadding: { name: 'Max', iconSvg: '<svg viewBox="0 0 10 10"></svg>', padding: 99 },
          noBorder: { name: 'Borderless', noBorder: true },
        };
      </script>
      <button id="resize" on:click={() => iconSize = 16}>Resize</button>
      <main>
        {#each Object.entries(apps) as [id, app]}
          <span id={id}><SlateIcon {app} theme="dark" size={iconSize} radius={4} /></span>
        {/each}
        <span id="lightDarkSvg"><SlateIcon app={apps.darkSvg} theme="light" size={14} /></span>
        <span id="sigmaApp"><SlateIcon sigma app={{ padding: 10, noBorder: true }} size={14} /></span>
        <span id="lightTheme" class="light"><SlateIcon app={apps.mono} theme="light" size={14} /></span>
        <span id="lightThemeDarkBrand" class="light"><SlateIcon app={{ name: 'Dark brand', color: '#111111' }} theme="light" size={14} /></span>
      </main>
      <style>
        main { --rail-flat: var(--tk-surface); --rail-txt: var(--tk-text); --rail-border: var(--tk-border); --rail-shadow-rest: none; --tk-bg: #111111; --tk-surface: #181818; --tk-text: #f5f5f5; --tk-border: rgba(255,255,255,.09); display:flex; gap:8px; }
        .light { --tk-bg: #ffffff; --tk-text: #1a1a1a; --tk-surface: #f5f5f5; --tk-border: rgba(0,0,0,.10); }
      </style>`);

      const html = await new SvelteEngine(directory).render(probe, `${surface}__SlateIconProbe`, {}, packages);
      const app = express();
      app.use('/svelte-cache', express.static(directory));
      app.get('/fixture', (_req, res) => res.type('html').send(html));
      server = await new Promise((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      });
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);

      assert.equal(await page.$eval('#mono .slate-icon', (node) => getComputedStyle(node).backgroundColor), 'rgb(255, 255, 255)');
      assert.equal(await page.$eval('#mono .slate-icon', (node) => getComputedStyle(node).color), 'rgb(17, 17, 17)');
      assert.equal(await page.$eval('#colored [data-asset="colored"] path', (node) => getComputedStyle(node).fill), 'rgb(232, 121, 36)');
      assert.equal(await page.$$eval('#image img', (nodes) => nodes.length), 1);
      assert.equal(await page.$eval('#fallback .slate-letter', (node) => node.textContent), 'F');
      assert.equal(await page.$$eval('#darkSvg [data-asset="dark-svg"]', (nodes) => nodes.length), 1);
      assert.equal(await page.$$eval('#lightDarkSvg [data-asset="light-svg"]', (nodes) => nodes.length), 1);
      assert.equal(await page.$eval('#darkImage img', (node) => node.getAttribute('src').includes('%3Crect')), true);
      assert.equal(await page.$eval('#minPadding .slate-icon', (node) => getComputedStyle(node).padding), '0px');
      assert.equal(await page.$eval('#maxPadding .slate-icon', (node) => getComputedStyle(node).padding), '4.375px');
      assert.equal(await page.$eval('#noBorder .slate-icon', (node) => getComputedStyle(node).borderStyle), 'none');
      assert.equal(await page.$eval('#sigmaApp .slate-icon', (node) => getComputedStyle(node).padding), '0px');
      assert.notEqual(await page.$eval('#sigmaApp .slate-icon', (node) => getComputedStyle(node).borderStyle), 'none');
      assert.equal(await page.$eval('#lightTheme .slate-icon', (node) => getComputedStyle(node).color), 'rgb(26, 26, 26)');
      assert.equal(await page.$eval('#lightThemeDarkBrand .slate-icon', (node) => getComputedStyle(node).color), 'rgb(255, 255, 255)');

      const geometry = await page.$$eval('.slate-icon', (nodes) => nodes.map((node) => ({
        id: node.parentElement.id,
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        clipped: node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight,
      })));
      assert.equal(geometry.every(({ width, height }) => width === 14 && height === 14), true);
      const assetIds = new Set(['mono', 'colored', 'image', 'darkSvg', 'darkImage', 'minPadding', 'maxPadding', 'lightDarkSvg']);
      assert.equal(geometry.filter(({ id }) => assetIds.has(id)).every(({ clipped }) => !clipped), true, JSON.stringify(geometry));
      await page.click('#resize');
      assert.equal(await page.$eval('#maxPadding .slate-icon', (node) => getComputedStyle(node).padding), '5px');
      assert.equal(await page.$eval('#maxPadding .slate-icon', (node) => node.getBoundingClientRect().width), 16);
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
}
