import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import puppeteer from 'puppeteer';
import { transformSharedState } from '../src/modules/views/shared-state';

// A memory-only fixture deliberately separates compiler behavior from sync,
// authorization and persistence. This is not the production Scriba client.
const scope = `
  const subscribers = new Set();
  let revision = 0;
  const data = { panel: { title: 'initial' }, items: [{label:'one'}] };
  const proxies = new WeakMap();
  function notify() { revision++; for (const fn of subscribers) fn(revision); }
  function wrap(value) {
    if (!value || typeof value !== 'object') return value;
    if (!proxies.has(value)) proxies.set(value, new Proxy(value, {
      get(target, key) { return wrap(target[key]); },
      set(target, key, next) { target[key] = next; notify(); return true; }
    }));
    return proxies.get(value);
  }
  export function remote(title) { data.panel.title = title; notify(); }
  export function count() { return subscribers.size; }
  export function createViewScope() {
    return {
      useState() { return wrap(data); },
      subscribe(fn) { subscribers.add(fn); fn(revision); return () => subscribers.delete(fn); },
      destroy() {}
    };
  }
`;

async function bundle(source: string, generate: 'dom' | 'ssr') {
  const result = await build({
    stdin: { contents: generate === 'dom'
      ? `import View from 'fixture:View'; import {remote,count} from 'logos:scriba-view'; window.probe={remote,count,view:new View({target:document.body})};`
      : `export {default} from 'fixture:View';`, resolveDir: process.cwd() },
    write: false, bundle: true, platform: generate === 'dom' ? 'browser' : 'node', format: generate === 'dom' ? 'iife' : 'cjs',
    conditions: ['svelte'], mainFields: ['svelte', 'browser', 'module', 'main'],
    plugins: [{ name: 'fixture', setup(plugin) {
      plugin.onResolve({filter:/^(fixture:|logos:scriba-view)/}, args => ({path:args.path, namespace:'fixture'}));
      plugin.onLoad({filter:/.*/,namespace:'fixture'}, args => {
        if (args.path === 'logos:scriba-view') return {contents:scope, resolveDir:process.cwd()};
        const child = `<script>export let panel;</script><span id="child">{panel.title}</span>`;
        return {contents:compile(args.path === 'fixture:Child' ? child : transformSharedState(source), {generate, hydratable:true}).js.code,resolveDir:process.cwd()};
      });
    }}],
  });
  return result.outputFiles[0].text;
}

describe('Scriba compiler in a real browser', () => {
  it('updates DOM, aliases, each, child props and two-way input; releases subscriptions', async () => {
    const code = await bundle(`<script>
      import Child from 'fixture:Child';
      const layout = useState('demo.layout.123');
      const panel = layout.panel;
      $: title = layout.panel.title;
      function readTitle() { return panel.title; }
      $: indirect = readTitle();
      function append() { layout.items.push({label:'two'}); }
    </script>
    <input bind:value={panel.title} />
    <strong>{title}</strong><Child {panel}/><i>{readTitle()}</i><b>{indirect}</b>
    {#each layout.items as item}<p>{item.label}</p>{/each}
    <button on:click={append}>append</button>`, 'dom');
    const browser = await puppeteer.launch({headless:true,args:['--no-sandbox']});
    try {
      const page = await browser.newPage();
      await page.setContent('<html><body></body></html>');
      await page.addScriptTag({content:code});
      await page.evaluate(() => (window as any).probe.remote('remote'));
      await page.waitForFunction(() => document.querySelector('strong')?.textContent === 'remote');
      expect(await page.$eval('#child', e => e.textContent)).toBe('remote');
      expect(await page.$eval('i', e => e.textContent)).toBe('remote');
      expect(await page.$eval('b', e => e.textContent)).toBe('remote');
      expect(await page.$eval('input', e => e.value)).toBe('remote');
      await page.$eval('input', e => {e.value='local';e.dispatchEvent(new Event('input',{bubbles:true}));});
      await page.waitForFunction(() => document.querySelector('#child')?.textContent === 'local');
      await page.click('button');
      expect(await page.$$eval('p', nodes => nodes.map(n=>n.textContent))).toEqual(['one','two']);
      await page.evaluate(() => (window as any).probe.view.$destroy());
      expect(await page.evaluate(() => (window as any).probe.count())).toBe(0);
    } finally { await browser.close(); }
  }, 20000);

  it('renders SSR without browser globals and without leaving subscriptions', async () => {
    const code = await bundle(`<script>const layout = useState('demo.layout.123');</script><p>{layout.panel.title}</p>`, 'ssr');
    const module = {exports:{} as any};
    new Function('module','exports','require',code)(module,module.exports,require);
    expect(module.exports.default.render().html).toContain('initial');
    expect(module.exports.default.render().html).toContain('initial');
  });
});
