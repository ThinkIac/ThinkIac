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
      ws.pkg('capabilities/mcp', {
        'package.json': JSON.stringify({ name: '@thinkiac/module-mcp', runtime: { entry: 'index.cjs' } }),
        'index.cjs': `exports.register = context => context.register({ name: 'mcp', phase: 'wire', install() {} });`,
      });
      const container = new Container({ workspace: ws.root });
      const entries = discoverExternalRuntimeModules([path.join(ws.root, 'capabilities')]).filter(entry => path.basename(entry) === 'mcp');
      expect(entries).toHaveLength(1);
      expect(() => installExternalModules(container, entries)).not.toThrow();
    } finally { ws.cleanup(); }
  });
  it('loads runtime capabilities but never treats transport libraries as runtime modules', () => {
    const ws = makeWorkspace();
    try {
      ws.pkg('capabilities/http', { 'package.json': '{"runtime":{"entry":"index.cjs"}}' });
      ws.pkg('capabilities/websocket', { 'package.json': '{"main":"index.cjs"}' });
      const entries = discoverExternalRuntimeModules([path.join(ws.root, 'capabilities')]);
      expect(entries).toEqual([path.join(ws.root, 'capabilities/http')]);
    } finally { ws.cleanup(); }
  });
  it('loads and registers a declared .type runtime entry without a generated JavaScript file', async () => {
    const ws = makeWorkspace();
    try {
      ws.pkg('capabilities/calculator', {
        'package.json': JSON.stringify({ name: '@thinkiac/calculator', runtime: { entry: 'tools/calc.type' } }),
        'tools/calc.type': 'exports.register = (context) -> context.register { name: \'calculator\', phase: \'wire\', install: -> }\n',
      });
      const container = new Container({ workspace: ws.root });
      const entries = discoverExternalRuntimeModules([path.join(ws.root, 'capabilities')]);
      expect(entries).toEqual([path.join(ws.root, 'capabilities/calculator')]);
      expect(() => installExternalModules(container, entries)).not.toThrow();
      await container.bus.emitStrict('logos:modules:register');
      expect(container.modules.get('calculator')).toBeDefined();
      expect(container.state('runtime:entrypoints').has(path.join(ws.root, 'capabilities/calculator/tools/calc.type'))).toBe(true);
    } finally { ws.cleanup(); }
  });
});
