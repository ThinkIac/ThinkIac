// kernel/bus.ts — Lógos event bus
//
// The bus is the spine of Lógos. Everything above the kernel — system modules
// and user packages alike — participates through the same three primitives:
//
//   emit(event, payload)      fire-and-forget, all handlers run, errors logged
//   pipeline(event, payload)  handlers run in priority order; a handler that
//                             returns a non-undefined/non-null value REPLACES
//                             the payload for the next handler (v1 dispatchEvent
//                             semantics, formalised)
//   veto(event, payload)      handlers may block an operation by returning
//                             `false` or `{ veto: true, reason }`
//
// Wildcards (inherited from v1, unchanged):
//   '*'            everything
//   'pkg:*'        any event in the 'pkg' namespace
//   '*:error'      any event ending in ':error'
//
// Every subscription carries an `owner` (usually a package folder). On hot
// reload the stabilizer calls `removeOwner(folder)` so stale handlers from the
// previous version of a package cannot linger.

'use strict';

import type {
  AccessController,
  AuthorityPrincipal,
  EventAuthorityOperation,
} from './access-controller';
import { currentAuthority, runAsPrincipal, SYSTEM_PRINCIPAL } from './authority-context';
import type { EventContractRegistry } from './event-contracts';
import type { EffectScope } from './effects';
import type { EventGovernance } from './event-governance';

export type BusHandler = (payload: any, ctx?: any) => any;

export interface SubscribeOptions {
  /** Lower runs first. Kernel modules default to 50, packages to 100. */
  priority?: number;
  /** Who registered this — used by removeOwner() on reload/rollback. */
  owner?: string;
  /** Authority represented by this handler. Defaults to passive subscribe. */
  operation?: Exclude<EventAuthorityOperation, 'publish' | 'request'>;
  /** Scope que possui esta subscription e a removerá no teardown. */
  scope?: EffectScope;
}

export interface Subscription {
  pattern: string;
  handler: BusHandler;
  priority: number;
  owner: string | null;
  principal: AuthorityPrincipal;
  operation: Exclude<EventAuthorityOperation, 'publish' | 'request'>;
}

export function matchesEvent(pattern: string, eventName: string): boolean {
  if (pattern === '*') return true;
  if (pattern === eventName) return true;
  if (pattern.endsWith(':*')) {
    const ns = pattern.slice(0, -2);
    return eventName.startsWith(ns + ':');
  }
  if (pattern.startsWith('*:')) {
    const suffix = pattern.slice(2);
    return eventName.endsWith(':' + suffix);
  }
  return false;
}

export class EventBus {
  private subs: Subscription[] = [];
  private log: (msg: string) => void;

  constructor(
    log: (msg: string) => void = console.warn,
    private authority: AccessController | null = null,
    private eventContracts: EventContractRegistry | null = null,
    private governance: EventGovernance | null = null,
  ) {
    this.log = log;
  }

  private principalFor(owner?: string): AuthorityPrincipal {
    if (owner && owner !== 'kernel' && owner !== 'system') return { kind: 'package', id: owner };
    if (owner === 'kernel' || owner === 'system') return SYSTEM_PRINCIPAL;
    return currentAuthority().principal;
  }

  private enforce(operation: EventAuthorityOperation, resource: string, principal = currentAuthority().principal): void {
    // Event delivery governance supersedes manifest event lists. Packages may
    // always emit/listen; authority is decided for every cross-package edge.
    if (this.governance?.enabled && principal.kind === 'package') return;
    const access = this.authority ?? currentAuthority().access;
    access?.enforce({ principal, surface: 'events', operation, resource });
  }

  private invoke(sub: Subscription, payload: any, ctx?: any): any {
    const access = this.authority ?? currentAuthority().access;
    if (!access) return sub.handler(payload, ctx);
    // Kernel handlers mediate the publisher's operation and therefore retain
    // its attributed caller. Package-owned handlers switch to their owner so
    // nested work can never inherit authority from the publisher.
    if (sub.principal.kind === 'system' && currentAuthority().principal.kind === 'package') {
      return sub.handler(payload, ctx);
    }
    return runAsPrincipal(access, sub.principal, () => sub.handler(payload, ctx));
  }

  private async permits(sub: Subscription, event: string, payload: any, ctx: any, operation: 'emit' | 'pipeline' | 'veto'): Promise<boolean> {
    if (!this.governance?.enabled) return true;
    const principal = currentAuthority().principal;
    const source = principal.kind === 'package' ? principal.id : 'system';
    const target = sub.principal.kind === 'package' ? sub.principal.id : 'system';
    const request = this.governance.createRequest({ event, source, target, sourceIntegrity: source === 'system' ? 'system' : this.governance.integrityFor(source), flowId: ctx?.flowId ?? null, operation, payload });
    return this.governance.authorize(request);
  }

  on(pattern: string, handler: BusHandler, opts: SubscribeOptions = {}): () => void {
    const principal = this.principalFor(opts.owner);
    const operation = opts.operation ?? 'subscribe';
    this.enforce(operation, pattern, principal);
    const sub: Subscription = {
      pattern,
      handler,
      priority: opts.priority ?? 100,
      owner: opts.owner ?? (principal.kind === 'package' ? principal.id : null),
      principal,
      operation,
    };
    this.subs.push(sub);
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      this.subs = this.subs.filter(candidate => candidate !== sub);
    };
    try {
      opts.scope?.defer(unsubscribe, { kind: 'listener', label: pattern, operation });
    } catch (error) {
      unsubscribe();
      throw error;
    }
    return unsubscribe;
  }

  once(pattern: string, handler: BusHandler, opts: SubscribeOptions = {}): () => void {
    const off = this.on(pattern, async (payload, ctx) => {
      off();
      return handler(payload, ctx);
    }, opts);
    return off;
  }

  off(pattern: string, handler: BusHandler): void {
    this.subs = this.subs.filter(s => !(s.pattern === pattern && s.handler === handler));
  }

  /** Removes every subscription registered by `owner`. Used on reload/rollback. */
  removeOwner(owner: string): number {
    const before = this.subs.length;
    this.subs = this.subs.filter(s => s.owner !== owner);
    return before - this.subs.length;
  }

  listeners(event: string): Subscription[] {
    return this.subs
      .filter(s => matchesEvent(s.pattern, event))
      .sort((a, b) => a.priority - b.priority);
  }

  /** Fire-and-forget. Handler errors are logged, never thrown. */
  async emit(event: string, payload?: any, ctx?: any): Promise<void> {
    this.enforce('publish', event);
    this.eventContracts?.validate(event, payload);
    for (const sub of this.listeners(event)) {
      try {
        if (!await this.permits(sub, event, payload, ctx, 'emit')) continue;
        await this.invoke(sub, payload, { ...(ctx ?? {}), event });
      } catch (err: any) {
        this.log(`[bus] handler for '${event}' (owner: ${sub.owner ?? 'kernel'}) failed: ${err?.message ?? err}`);
      }
    }
  }

  /** Transform pipeline — the contract packages use to change runtime behavior. */
  async pipeline(event: string, payload: any, ctx?: any, operation: 'transform' | 'request' = 'transform'): Promise<any> {
    this.enforce(operation, event);
    this.eventContracts?.validate(event, payload);
    let current = payload;
    for (const sub of this.listeners(event)) {
      try {
        if (!await this.permits(sub, event, current, ctx, 'pipeline')) continue;
        const result = await this.invoke(sub, current, { ...(ctx ?? {}), event });
        if (result !== undefined && result !== null) {
          this.eventContracts?.validate(event, result);
          current = result;
        }
      } catch (err: any) {
        this.log(`[bus] pipeline handler for '${event}' (owner: ${sub.owner ?? 'kernel'}) failed: ${err?.message ?? err}`);
      }
    }
    return current;
  }

  /**
   * Any handler may block. Returns the verdict and who blocked.
   *
   * `code` and `details` ride along untouched: whoever vetoes has to be able to
   * say WHY — and with which data (the id of a pending decision, say) — without
   * the transport having to guess it from the reason string.
   */
  async veto(event: string, payload: any, ctx?: any): Promise<{ allowed: boolean; reason?: string; by?: string; code?: string; details?: any }> {
    this.enforce('veto', event);
    this.eventContracts?.validate(event, payload);
    for (const sub of this.listeners(event)) {
      try {
        if (!await this.permits(sub, event, payload, ctx, 'veto')) continue;
        const result = await this.invoke(sub, payload, ctx);
        if (result === false) return { allowed: false, by: sub.owner ?? 'kernel' };
        if (result && typeof result === 'object' && result.veto) {
          return { allowed: false, reason: result.reason, by: sub.owner ?? 'kernel', code: result.code, details: result.details };
        }
      } catch (err: any) {
        this.log(`[bus] veto handler for '${event}' failed (treated as no-veto): ${err?.message ?? err}`);
      }
    }
    return { allowed: true };
  }
}
