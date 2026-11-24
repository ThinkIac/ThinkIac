import type { Container } from './container';

/** One snapshot. Rollback tolerates absent/partial commit; disposal must
 * preserve any newer publication for the same owner. */
export interface ResourceGeneration {
  commit(): void | Promise<void>;
  rollback(): void | Promise<void>;
  dispose(): void | Promise<void>;
}

/** Preparation leaves live state unchanged and cleans acquisitions if it throws. */
export interface TransactionalResourceConsumer {
  prepare(resources: readonly any[], context: { package: string; version: 1 }): ResourceGeneration | Promise<ResourceGeneration>;
}

export type ResourceConsumer = ((resource: any) => any | Promise<any>) | TransactionalResourceConsumer;

/** Per-container snapshots. Consumers own publication and compensating rollback. */
export class ResourceTransactions {
  private live = new Map<string, ResourceGeneration[]>();
  private pending = new Map<string, () => Promise<void>>();
  private operations = new Set<Promise<unknown>>();
  private closing: Promise<void> | null = null;
  private closed = false;
  constructor(private container: Container) {}

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation);
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation));
    return operation;
  }

  prepare(owner: string, resources: readonly any[]) {
    return this.track(this.prepareSnapshot(owner, resources));
  }

  private async prepareSnapshot(owner: string, resources: readonly any[]) {
    if (this.closed) throw new Error('Resource lifecycle is closed');
    if (this.pending.has(owner)) throw new Error(`Resource transaction already pending: ${owner}`);
    const next: ResourceGeneration[] = [];
    const previous = this.live.get(owner) || [];
    let state: 'prepared' | 'committing' | 'committed' | 'finished' = 'prepared';
    let committing: Promise<void> | null = null;
    const rollback = async () => {
      if (state === 'finished') return;
      state = 'finished';
      const errors: unknown[] = [];
      for (const generation of [...next].reverse()) {
        try { await generation.rollback(); } catch (error) { errors.push(error); }
      }
      this.pending.delete(owner);
      if (errors.length) throw new AggregateError(errors, 'Resource rollback failed');
    };
    this.pending.set(owner, rollback);
    try {
      for (const mod of this.container.modules.values()) {
        for (const [type, consumer] of Object.entries(mod.resources || {})) {
          if (typeof consumer === 'function') continue;
          const generation = await consumer.prepare(Object.freeze(resources.filter(r => r.declaration.type === type)), { package: owner, version: 1 });
          if (!generation || ['commit', 'rollback', 'dispose'].some(key => typeof (generation as any)[key] !== 'function')) {
            throw new TypeError(`Invalid resource generation from ${mod.name}:${type}`);
          }
          next.push(generation);
          if (this.closed) throw new Error('Resource lifecycle is closed');
        }
      }
    } catch (error) {
      try { await rollback(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Resource preparation and rollback failed'); }
      throw error;
    }
    return {
      commit: () => {
        const operation = (async () => {
        if (this.closed) throw new Error('Resource lifecycle is closed');
        if (state !== 'prepared') throw new Error('Resource transaction is not prepared');
        state = 'committing';
        try {
          for (const generation of next) await generation.commit();
          state = 'committed';
        } catch (error) {
          try { await rollback(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Resource commit and rollback failed'); }
          throw error;
        }
        })();
        if (!committing && state === 'committing') committing = operation;
        return this.track(operation);
      },
      rollback: async () => {
        if (committing) await committing.catch(() => {});
        await rollback();
      },
      finish: () => this.track((async () => {
        if (this.closed) throw new Error('Resource lifecycle is closed');
        if (state !== 'committed') throw new Error('Resource transaction is not committed');
        state = 'finished';
        this.live.set(owner, next);
        this.pending.delete(owner);
        for (const generation of [...previous].reverse()) {
          try { await generation.dispose(); } catch (error) { this.container.log(`[logos] resource retirement failed for ${owner}: ${error}`); }
        }
      })()),
    };
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = this.closeAll();
    return this.closing;
  }

  private async closeAll() {
    await Promise.allSettled([...this.operations]);
    const errors: unknown[] = [];
    for (const rollback of [...this.pending.values()].reverse()) {
      try { await rollback(); } catch (error) { errors.push(error); }
    }
    const generations = [...this.live.values()].flat().reverse();
    this.live.clear();
    for (const generation of generations) {
      try { await generation.dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Resource shutdown failed');
  }
}
