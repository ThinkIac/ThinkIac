// kernel/effects.ts — ownership universal de recursos do runtime.
//
// Um EffectScope aceita aquisições enquanto está aberto e garante que tudo o
// que entrou nele saia uma única vez, em ordem LIFO. O AbortSignal permite que
// aquisições assíncronas em voo parem cedo; mesmo que concluam depois do
// cancelamento, o disposer devolvido ainda é executado antes de dispose()
// terminar.

'use strict';

export type EffectDisposer = () => void | Promise<void>;
export type EffectAcquire = (signal: AbortSignal) => void | EffectDisposer | Promise<void | EffectDisposer>;
export type EffectScopeState = 'open' | 'disposing' | 'disposed';
export type EffectResourceState = 'acquiring' | 'active' | 'disposing' | 'disposed' | 'failed';

export interface EffectMetadata {
  kind?: string;
  label?: string;
  [key: string]: unknown;
}

export interface EffectScopeOptions {
  owner: string;
  generation?: string;
  kind?: string;
  parent?: EffectScope;
}

export interface EffectDisposeError {
  resourceId: string;
  kind: string;
  label?: string;
  message: string;
}

export interface EffectDisposeReport {
  scopeId: string;
  owner: string;
  generation: string;
  reason: string;
  startedAt: string;
  completedAt: string;
  disposed: number;
  failed: number;
  errors: ReadonlyArray<EffectDisposeError>;
}

export interface EffectResourceSnapshot {
  id: string;
  kind: string;
  label?: string;
  state: EffectResourceState;
  createdAt: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface EffectScopeSnapshot {
  id: string;
  owner: string;
  generation: string;
  kind: string;
  parentId: string | null;
  state: EffectScopeState;
  createdAt: string;
  resources: ReadonlyArray<EffectResourceSnapshot>;
}

interface EffectEntry {
  id: string;
  metadata: EffectMetadata;
  createdAt: string;
  state: EffectResourceState;
  disposer?: EffectDisposer;
  acquisitionError?: unknown;
  child?: EffectScope;
  ready: Promise<void>;
}

let nextScopeId = 1;
let nextResourceId = 1;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function immutableMetadata(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return String(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => immutableMetadata(item, seen)));
  }
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = immutableMetadata(item, seen);
  }
  return Object.freeze(copy);
}

export class EffectScopeClosedError extends Error {
  readonly code = 'EFFECT_SCOPE_CLOSED';

  constructor(readonly scopeId: string, readonly owner: string) {
    super(`EffectScope ${scopeId} (${owner}) is not open`);
    this.name = 'EffectScopeClosedError';
  }
}

export class EffectScope {
  readonly id: string;
  readonly owner: string;
  readonly generation: string;
  readonly kind: string;
  readonly parent: EffectScope | null;
  readonly createdAt = new Date().toISOString();

  private controller = new AbortController();
  private entries: EffectEntry[] = [];
  private _state: EffectScopeState = 'open';
  private disposal: Promise<EffectDisposeReport> | null = null;
  private disposedReport: EffectDisposeReport | null = null;
  private onDisposed?: (scope: EffectScope) => void;
  private registerScope?: (scope: EffectScope) => void;

  constructor(
    options: EffectScopeOptions,
    onDisposed?: (scope: EffectScope) => void,
    registerScope?: (scope: EffectScope) => void,
  ) {
    if (!options?.owner) throw new TypeError('EffectScope owner is required');
    this.id = `scope-${nextScopeId++}`;
    this.owner = options.owner;
    this.generation = options.generation ?? 'default';
    this.kind = options.kind ?? 'component';
    this.parent = options.parent ?? null;
    this.onDisposed = onDisposed;
    this.registerScope = registerScope;

    if (this.parent) {
      this.parent.registerChild(this);
    }
  }

  get state(): EffectScopeState {
    return this._state;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  private assertOpen(): void {
    if (this._state !== 'open') throw new EffectScopeClosedError(this.id, this.owner);
  }

  private makeEntry(metadata: EffectMetadata = {}): EffectEntry {
    return {
      id: `effect-${nextResourceId++}`,
      metadata: { ...metadata },
      createdAt: new Date().toISOString(),
      state: 'acquiring',
      ready: Promise.resolve(),
    };
  }

  private registerChild(child: EffectScope): void {
    this.assertOpen();
    const entry = this.makeEntry({ kind: 'scope', label: child.owner, childScopeId: child.id });
    entry.state = 'active';
    entry.child = child;
    entry.disposer = async () => { await child.dispose('parent_disposed'); };
    this.entries.push(entry);
  }

  child(options: Omit<EffectScopeOptions, 'parent'>): EffectScope {
    this.assertOpen();
    const child = new EffectScope({ ...options, parent: this }, this.onDisposed, this.registerScope);
    this.registerScope?.(child);
    return child;
  }

  async effect(acquire: EffectAcquire, metadata: EffectMetadata = {}): Promise<void> {
    this.assertOpen();
    if (typeof acquire !== 'function') throw new TypeError('Effect acquire must be a function');

    const entry = this.makeEntry(metadata);
    this.entries.push(entry);
    entry.ready = Promise.resolve()
      .then(() => acquire(this.signal))
      .then(disposer => {
        if (disposer !== undefined && typeof disposer !== 'function') {
          throw new TypeError('Effect acquire must return a disposer function or void');
        }
        entry.disposer = typeof disposer === 'function' ? disposer : undefined;
        entry.state = 'active';
      })
      .catch(error => {
        entry.acquisitionError = error;
        entry.state = 'failed';
      });

    await entry.ready;
    if (entry.acquisitionError !== undefined) throw entry.acquisitionError;
  }

  defer(disposer: EffectDisposer, metadata: EffectMetadata = {}): void {
    this.assertOpen();
    if (typeof disposer !== 'function') throw new TypeError('Effect disposer must be a function');
    const entry = this.makeEntry(metadata);
    entry.disposer = disposer;
    entry.state = 'active';
    this.entries.push(entry);
  }

  private async disposeEntry(entry: EffectEntry): Promise<EffectDisposeReport | void> {
    await entry.ready;
    if (entry.acquisitionError !== undefined) throw entry.acquisitionError;
    if (entry.state === 'disposed') return;
    entry.state = 'disposing';
    const childReport = entry.child ? await entry.child.dispose('parent_disposed') : undefined;
    if (!entry.child) await entry.disposer?.();
    entry.state = 'disposed';
    return childReport;
  }

  dispose(reason = 'disposed'): Promise<EffectDisposeReport> {
    if (this.disposal) return this.disposal;
    if (this.disposedReport) return Promise.resolve(this.disposedReport);

    this._state = 'disposing';
    this.controller.abort(reason);
    const startedAt = new Date().toISOString();

    this.disposal = (async () => {
      let disposed = 0;
      const errors: EffectDisposeError[] = [];
      for (const entry of [...this.entries].reverse()) {
        try {
          const childReport = await this.disposeEntry(entry);
          if (childReport) {
            disposed += childReport.disposed;
            errors.push(...childReport.errors);
          } else {
            disposed += 1;
          }
        } catch (error) {
          entry.state = 'failed';
          errors.push({
            resourceId: entry.id,
            kind: String(entry.metadata.kind ?? 'effect'),
            ...(entry.metadata.label ? { label: String(entry.metadata.label) } : {}),
            message: errorMessage(error),
          });
        }
      }
      this._state = 'disposed';
      const report = Object.freeze({
        scopeId: this.id,
        owner: this.owner,
        generation: this.generation,
        reason,
        startedAt,
        completedAt: new Date().toISOString(),
        disposed,
        failed: errors.length,
        errors: Object.freeze(errors.map(error => Object.freeze(error))),
      });
      this.disposedReport = report;
      this.onDisposed?.(this);
      return report;
    })();

    return this.disposal;
  }

  snapshot(): EffectScopeSnapshot {
    const resources = this.entries.map(entry => Object.freeze({
      id: entry.id,
      kind: String(entry.metadata.kind ?? 'effect'),
      ...(entry.metadata.label ? { label: String(entry.metadata.label) } : {}),
      state: entry.state,
      createdAt: entry.createdAt,
      metadata: immutableMetadata(entry.metadata) as Readonly<Record<string, unknown>>,
    }));
    return Object.freeze({
      id: this.id,
      owner: this.owner,
      generation: this.generation,
      kind: this.kind,
      parentId: this.parent?.id ?? null,
      state: this._state,
      createdAt: this.createdAt,
      resources: Object.freeze(resources),
    });
  }
}

export class EffectScopeRegistry {
  private scopes = new Map<string, EffectScope>();

  create(options: EffectScopeOptions): EffectScope {
    const register = (created: EffectScope) => this.scopes.set(created.id, created);
    const scope = new EffectScope(options, disposed => this.scopes.delete(disposed.id), register);
    this.scopes.set(scope.id, scope);
    return scope;
  }

  inventory(): ReadonlyArray<EffectScopeSnapshot> {
    return Object.freeze([...this.scopes.values()].map(scope => scope.snapshot()));
  }

  async disposeAll(reason = 'runtime_disposed'): Promise<ReadonlyArray<EffectDisposeReport>> {
    const roots = [...this.scopes.values()].filter(scope => scope.parent === null).reverse();
    return Promise.all(roots.map(scope => scope.dispose(reason)));
  }
}
