import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Container } from '../src/kernel/container';
import { makeWorkspace } from './helpers';
import { discoverExternalRuntimeModules, installExternalModules } from '../src/kernel/external-modules';

describe('external capability discovery', () => {
  it('keeps discovered capabilities separate from workspace packages with the same name', () => {
    const ws = makeWorkspace();
    try {
      ws.pkg('node_modules/mcp', {
        'package.json': JSON.stringify({ name: 'mcp', main: 'index.cjs' }),
        'index.cjs': 'throw new Error("workspace application must not replace capability");',
      });
      const container = new Container({ workspace: ws.root });
      const entries = discoverExternalRuntimeModules().filter(entry => path.basename(entry) === 'mcp');
      expect(entries).toHaveLength(1);
      expect(() => installExternalModules(container, entries)).not.toThrow();
    } finally { ws.cleanup(); }
  });
  it('loads runtime capabilities but never treats transport libraries as runtime modules', () => {
    const entries = discoverExternalRuntimeModules();
    expect(entries.every(entry => path.isAbsolute(entry))).toBe(true);
    const modules = entries.map(entry => path.basename(entry));
    expect(modules).toEqual(expect.arrayContaining(['http', 'hooks', 'legacy-entry', 'repo', 'svelte', 'websocket-runtime']));
    expect(modules).not.toContain('websocket');
    expect(modules).not.toContain('process-bridge');
  });
});
