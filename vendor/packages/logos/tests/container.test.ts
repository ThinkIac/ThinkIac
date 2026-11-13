// tests/container.test.ts — the runtime container: module registration,
// @after-ordered install phases, override semantics, and state buckets.

import { describe, it, expect } from 'vitest';
import { Container, LogosModule, getDefaultContainer, setDefaultContainer } from '../src/kernel/container';

function mod(name: string, phase: 'boot' | 'wire', after: string[], onInstall: () => void): LogosModule {
  return { name, phase, after, install: () => { onInstall(); } };
}

describe('Container basics', () => {
  it('exposes the workspace resolved from config', () => {
    const c = new Container({ workspace: '/ws/here' });
    expect(c.workspace).toBe('/ws/here');
    expect(process.env.PACKAGES_PATH).toBe('/ws/here'); // v1 modules read this
  });

  it('state() returns a stable, per-namespace bucket', () => {
    const c = new Container({ workspace: '/x' });
    c.state('tools').set('k', 1);
    expect(c.state('tools').get('k')).toBe(1);
    expect(c.state('other').has('k')).toBe(false);
  });
});

describe('Container.installPhase ordering', () => {
  it('installs only the requested phase, respecting @after', async () => {
    const c = new Container({ workspace: '/x' });
    const order: string[] = [];
    c.use(mod('db', 'boot', [], () => order.push('db')));
    c.use(mod('env', 'boot', [], () => order.push('env')));
    c.use(mod('http', 'wire', ['env'], () => order.push('http')));

    await c.installPhase('boot');
    expect(order).not.toContain('http');       // wire not run yet
    expect(order).toContain('env');
    expect(order).toContain('db');

    await c.installPhase('wire');
    expect(order[order.length - 1]).toBe('http');
  });

  it('a wire module may depend on a module installed during boot', async () => {
    const c = new Container({ workspace: '/x' });
    const order: string[] = [];
    c.use(mod('env', 'boot', [], () => order.push('env')));
    c.use(mod('routes', 'wire', ['env'], () => order.push('routes')));
    await c.installPhase('boot');
    await expect(c.installPhase('wire')).resolves.toBeUndefined();
    expect(order).toEqual(['env', 'routes']);
  });

  it('throws on a dependency cycle', async () => {
    const c = new Container({ workspace: '/x' });
    c.use(mod('a', 'wire', ['b'], () => {}));
    c.use(mod('b', 'wire', ['a'], () => {}));
    await expect(c.installPhase('wire')).rejects.toThrow(/dependency cycle/);
  });

  it('ignores @after references to unknown modules', async () => {
    const c = new Container({ workspace: '/x' });
    let ran = false;
    c.use(mod('solo', 'wire', ['ghost'], () => { ran = true; }));
    await c.installPhase('wire');
    expect(ran).toBe(true);
  });

  it('does not install the same module twice across phase calls', async () => {
    const c = new Container({ workspace: '/x' });
    let count = 0;
    c.use(mod('once', 'boot', [], () => { count++; }));
    await c.installPhase('boot');
    await c.installPhase('boot');
    expect(count).toBe(1);
  });

  it('emits runtime:module_installed for each install', async () => {
    const c = new Container({ workspace: '/x' });
    const installed: string[] = [];
    c.bus.on('runtime:module_installed', (p: any) => { installed.push(p.name); });
    c.use(mod('m', 'boot', [], () => {}));
    await c.installPhase('boot');
    expect(installed).toEqual(['m']);
  });
});

describe('Container.use override', () => {
  it('a later registration overrides by name and re-runs on install', async () => {
    const c = new Container({ workspace: '/x' });
    const order: string[] = [];
    c.use(mod('http', 'boot', [], () => order.push('builtin')));
    await c.installPhase('boot');
    c.use(mod('http', 'boot', [], () => order.push('override')), 'workspace');
    await c.installPhase('boot');
    expect(order).toEqual(['builtin', 'override']);
  });
});

describe('default container', () => {
  it('getDefaultContainer is a lazy singleton settable via setDefaultContainer', () => {
    const custom = new Container({ workspace: '/custom' });
    setDefaultContainer(custom);
    expect(getDefaultContainer()).toBe(custom);
  });
});
