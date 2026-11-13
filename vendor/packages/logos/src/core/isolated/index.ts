// core/isolated — process boundary for packages declared `isolated: true`.
//
// The parent never imports package code. It receives only declarative surface
// descriptors and invokes an opaque handler id over Node's IPC channel.

import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export interface IsolatedSurface {
  id: string;
  kind: 'tool' | 'route' | 'hook';
  name?: string;
  path?: string;
  event?: string;
  method?: string;
  public?: boolean;
  description?: string | null;
  parameters?: any;
  condition?: any;
  priority?: number;
}

export interface IsolatedManifest {
  tools: IsolatedSurface[];
  routes: IsolatedSurface[];
  hooks: IsolatedSurface[];
  declarations: { id: string; file: string; declaration: import('../../kernel/declarations').DeclarationPayload }[];
}

export interface IsolatedRunnerOptions {
  folder: string;
  dir: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onEvent?: (event: string, payload: any) => Promise<any>;
  onCapability?: (request: { surface: string; [key: string]: any }) => Promise<any>;
  onLog?: (message: string) => void;
  onExit?: (event: { code: number | null; signal: string | null; expected: boolean; pid?: number }) => void;
}

type Pending = { resolve: (value: any) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout };

export class IsolatedRunner {
  private child: ChildProcess | null = null;
  private pending = new Map<string, Pending>();
  private sequence = 0;
  private stopping = false;
  private manifest: IsolatedManifest | null = null;

  constructor(private readonly options: IsolatedRunnerOptions) {}

  get running(): boolean { return Boolean(this.child && this.child.connected && !this.stopping); }
  get surfaces(): IsolatedManifest | null { return this.manifest; }
  get pid(): number | undefined { return this.child?.pid; }

  async start(): Promise<IsolatedManifest> {
    if (this.running && this.manifest) return this.manifest;
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
      throw new Error('Isolated packages require Node.js 20+ permission mode');
    }
    this.stopping = false;
    const childPath = path.join(__dirname, 'child.js');
    const env = { ...this.options.env, LOGOS_ISOLATED_PACKAGE: this.options.dir, LOGOS_ISOLATED_FOLDER: this.options.folder };
    // Permission mode denies filesystem writes, child processes and workers by
    // default. Read access is restricted to the package and this tiny bootstrap.
    this.child = fork(childPath, [], {
      cwd: this.options.dir, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: ['--experimental-permission', `--allow-fs-read=${this.options.dir}`, `--allow-fs-read=${path.dirname(childPath)}`],
    });
    const child = this.child;
    child.on('message', message => { if (this.child === child) void this.onMessage(message); });
    child.once('exit', (code, signal) => {
      const expected = this.stopping || this.child !== child;
      if (this.child === child) this.onExit(signal ? `child terminated (${signal})` : 'child exited');
      this.options.onExit?.({ code, signal, expected, pid: child.pid });
    });
    child.once('error', error => { if (this.child === child) this.onExit(error.message); });
    try {
      const manifest = await this.request('start', {});
      this.manifest = manifest;
      return manifest;
    } catch (error) { await this.stop('start_failed'); throw error; }
  }

  async invoke(id: string, args: any[], context: any = {}): Promise<any> {
    if (!this.running) throw new Error(`Isolated package "${this.options.folder}" is not running`);
    return this.request('invoke', { handler: id, args, context });
  }

  async stop(reason = 'stopped'): Promise<void> {
    const child = this.child;
    this.stopping = true;
    this.child = null;
    this.manifest = null;
    this.rejectAll(reason);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try { if (child.connected) child.send({ op: 'stop', reason }); } catch { /* already gone */ }
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignored */ } resolve(); }, 1_000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  private request(op: string, payload: any): Promise<any> {
    const child = this.child;
    if (!child?.connected) return Promise.reject(new Error(`Isolated package "${this.options.folder}" is not connected`));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Isolated package "${this.options.folder}" ${op} timed out`));
      }, this.options.timeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      child.send({ op, id, ...payload }, error => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(id); pending.reject(error);
      });
    });
  }

  private async onMessage(message: any): Promise<void> {
    if (!message || typeof message !== 'object') return;
    if (message.op === 'event') {
      try { const result = await this.options.onEvent?.(message.event, message.payload); this.child?.send({ op: 'event:result', id: message.id, result }); }
      catch (error: any) { this.child?.send({ op: 'event:error', id: message.id, error: error?.message ?? String(error) }); }
      return;
    }
    if (message.op === 'capability') {
      try { const result = await this.options.onCapability?.(message.request); this.child?.send({ op: 'capability:result', id: message.id, result }); }
      catch (error: any) { this.child?.send({ op: 'capability:error', id: message.id, error: error?.message ?? String(error) }); }
      return;
    }
    if (message.op === 'log') { this.options.onLog?.(String(message.message)); return; }
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(String(message.id));
    if (message.op === 'error') pending.reject(new Error(message.error ?? 'isolated package failed'));
    else pending.resolve(message.result);
  }

  private onExit(reason: string): void {
    this.child = null;
    this.manifest = null;
    this.rejectAll(reason);
  }

  private rejectAll(reason: string): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`Isolated package "${this.options.folder}": ${reason}`)); }
    this.pending.clear();
  }
}
