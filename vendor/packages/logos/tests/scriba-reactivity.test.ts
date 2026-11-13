import { describe, expect, it } from 'vitest';
import { compile } from 'svelte/compiler';
import { transformSharedState } from '../src/modules/views/shared-state';

describe('Scriba Svelte 4 compilation gate', () => {
  it('compiles natural writes, remote invalidation, nested aliases and input binding for DOM and SSR', () => {
    const source = `<script>
      const layout = useState('demo.layout.123');
      const panel = layout.panel;
      function rename() { panel.title = 'local'; }
      $: title = layout.panel.title;
    </script>
    <input bind:value={panel.title} /><button on:click={rename}>{title}</button>
    {#each layout.items as item}<p>{item.label}</p>{/each}`;
    const result = transformSharedState(source);
    expect(result).not.toBe(source);
    for (const generate of ['dom', 'ssr'] as const) {
      expect(() => compile(result, { generate, hydratable: true })).not.toThrow();
    }
  });

  it('does not hijack a locally declared helper or views without shared state', () => {
    for (const source of [
      `<script>import { useState } from './local'; const a = useState();</script><p>{a.x}</p>`,
      `<script>function useState() { return {}; } const a = useState();</script>`,
      `<script>const value = 1;</script><p>{value}</p>`,
    ]) expect(transformSharedState(source)).toBe(source);
  });

  it('rejects unsupported call locations instead of silently producing a nonreactive binding', () => {
    expect(() => transformSharedState(`<script>function make() { return useState('x.y'); }</script>`))
      .toThrow(/top-level/);
  });
});
