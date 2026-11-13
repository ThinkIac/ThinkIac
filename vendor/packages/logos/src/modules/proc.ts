// Process-module integration for the external JSONL bridge.
'use strict';

import path from 'path';
import { Container } from '../kernel/container';
import type { EffectScope } from '../kernel/effects';

const { ProcessBridge } = require('@thinkiac/module-process-bridge');

/** Connects the host bus and lifecycle to the reusable transport. */
class ProcBridge extends ProcessBridge {
  private container: Container;
  private folder: string;
  private unsubscribes: Array<() => void> = [];
  private scope?: EffectScope;

  constructor(container: Container, opts: { folder?: string; name: string; dir: string; runtime: string; main: string; events: string[]; scope?: EffectScope }) {
    let self: ProcBridge;
    super({
      name: opts.name, cwd: opts.dir, runtime: opts.runtime, main: opts.main,
      onRegister: (patterns: string[]) => patterns.forEach(pattern => self.subscribe(pattern)),
      onEmit: (event: string, payload: any) => container.bus.emit(event, payload),
      onLog: (message: string, kind: string) => kind === 'stderr' ? process.stderr.write(`[proc:${opts.name}] ${message}`) : container.log(`[proc] "${opts.name}" ${message}`),
      onError: (error: Error) => container.log(`[proc] ${opts.name}: ${error.message}`),
      onExit: ({ code, signal }: { code: number | null; signal: string | null }) => {
        container.bus.emit('proc:crashed', { module: opts.name, code });
        const supervisor = container.state('supervisor').get('controller');
        if (!supervisor) return false;
        void supervisor.scheduleProc(opts.folder ?? opts.name, async () => {
          if ((self as any).stopped) return { ok: false, error: 'Bridge stopped' };
          self.start();
          return { health: 'unknown' };
        }, { code, signal });
        return true;
      },
    });
    self = this;
    this.container = container;
    this.folder = opts.folder ?? opts.name;
    this.scope = opts.scope;
    for (const pattern of opts.events || [`${opts.name}:*`]) this.subscribe(pattern);
  }

  private subscribe(pattern: string): void {
    const off = this.container.bus.on(pattern, (payload: any) => this.call(pattern, payload), { owner: `proc:${this.name}`, priority: 100, scope: this.scope });
    this.unsubscribes.push(off);
  }

  stop(): void {
    this.container.state('supervisor').get('controller')?.cancel(this.folder);
    for (const off of this.unsubscribes) off();
    super.stop();
  }
}

/** Spawns bridges for every workspace module declared with a non-node runtime. */
export function startProcessModule(container: Container, pkg: any): ProcBridge | null {
  const rt = pkg.runtime || {};
  const runtime = rt.runtime;
  if (!runtime || runtime === 'node') return null;

  const scope = container.getPackageScope(pkg.folder) ??
    container.createPackageScope(pkg.folder, String(Date.now()));
  const bridge = new ProcBridge(container, {
    folder: pkg.folder,
    name: rt.name || pkg.folder,
    dir: pkg.dir,
    runtime,
    main: path.join(pkg.dir, rt.main || 'main.py'),
    events: rt.events || [`${rt.name || pkg.folder}:*`],
    scope,
  });
  bridge.start();
  scope.defer(() => bridge.stop(), { kind: 'process', label: rt.name || pkg.folder });
  container.state('proc').set(pkg.folder, bridge);
  return bridge;
}

export async function stopProcessModule(container: Container, folder: string): Promise<void> {
  const bridge = container.state('proc').get(folder);
  if (bridge) { bridge.stop(); container.state('proc').delete(folder); }
  await container.disposePackageScope(folder, 'process_module_stopped');
}
