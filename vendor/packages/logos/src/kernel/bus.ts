// kernel/bus.ts — Lógos event bus
//
// The bus is the spine of Lógos. Everything above the kernel — system modules
// and user packages alike — uses explicit delivery operations:
//
//   emit(event, payload)      fire-and-forget, all handlers run, errors logged
//   pipeline(event, payload)  handlers run in priority order; a handler that
//                             returns a non-undefined/non-null value REPLACES
//                             the payload for the next handler (v1 dispatchEvent
//                             semantics, formalised)
//   request(event, payload) one explicitly registered provider, typed result
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

import { AsyncLocalStorage } from 'node:async_hooks';
import { deserialize, serialize } from 'node:v8';
import type {
  AccessController,
  AuthorityPrincipal,
  EventAuthorityOperation,
} from './access-controller';
import { currentAuthority, runAsPrincipal, SYSTEM_PRINCIPAL } from './authority-context';
import type { EventContractRegistry } from './event-contracts';
import type { EffectScope } from './effects';
import type { EventGovernance, EventDeliveryRequest } from './event-governance';

interface DeliveryFrame {
  readonly caller: AuthorityPrincipal;
  readonly provider: AuthorityPrincipal;
  readonly event: string;
  readonly operation: EventDeliveryRequest['operation'];
}

export type BusHandler = (payload: any, ctx?: any) => any;

export interface RequestContext {
  event: string;
  signal: AbortSignal;
  flowId?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  flowId?: string;
}

export type ExtensionPhase = 'before' | 'transform' | 'after';

export interface RequestContract<Input, Output> {
  extensions?: readonly ExtensionPhase[];
  input: (value: unknown) => value is Input;
  output: (value: unknown) => value is Output;
  exposeInput?: (value: Input) => unknown;
  exposeOutput?: (value: Output) => unknown;
}

export class EventRequestError extends Error {
  constructor(readonly code: string, readonly event: string) {
    super(`${code}: ${event}`);
    this.name = 'EventRequestError';
  }
}

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
  requestProvider?: boolean;
  extensionPhases?: readonly ExtensionPhase[];
  extensionPhase?: ExtensionPhase;
  pattern: string;
  handler: BusHandler;
  priority: number;
  registrationOrder: number;
  owner: string | null;
  principal: AuthorityPrincipal;
  operation: Exclude<EventAuthorityOperation, 'request'>;
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
  private readonly deliveries = new AsyncLocalStorage<readonly DeliveryFrame[]>();
  private subs: Subscription[] = [];
  private nextRegistrationOrder = 0;
  private declaredExtensions = new Map<string, Subscription[]>();
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
    if (owner?.startsWith('module:')) return SYSTEM_PRINCIPAL;
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

  private invoke(sub: Subscription, payload: any, ctx: any, event: string, operation: DeliveryFrame['operation']): any {
    const caller = currentAuthority().principal;
    const frame = Object.freeze({ caller, provider: sub.principal, event, operation });
    return this.deliveries.run(Object.freeze([...(this.deliveries.getStore() ?? []), frame]),
      () => this.invokeHandler(sub, payload, ctx));
  }

  private invokeHandler(sub: Subscription, payload: any, ctx: any): any {
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

  private async permits(sub: Subscription, event: string, payload: any, ctx: any, operation: EventDeliveryRequest['operation']): Promise<boolean> {
    if (!this.governance?.enabled) return true;
    const principal = currentAuthority().principal;
    const source = principal.kind === 'package' ? principal.id : 'system';
    const target = sub.principal.kind === 'package' ? sub.principal.id : 'system';
    const sources = new Set([source]);
    for (const frame of this.deliveries.getStore() ?? []) {
      if (frame.caller.kind === 'package') sources.add(frame.caller.id);
    }
    for (const origin of sources) {
      const request = this.governance.createRequest({
        event, source: origin, target,
        sourceIntegrity: origin === 'system' ? 'system' : this.governance.integrityFor(origin),
        flowId: origin === source ? ctx?.flowId ?? null : null,
        operation, payload,
      });
      if (!await this.governance.authorize(request)) return false;
    }
    return true;
  }

  on(pattern: string, handler: BusHandler, opts: SubscribeOptions = {}): () => void {
    return this.register(pattern, handler, opts);
  }

  private register(pattern: string, handler: BusHandler, opts: SubscribeOptions, delivery: Pick<Subscription, 'requestProvider' | 'extensionPhases' | 'extensionPhase'> = {}, authorityOperation?: 'publish'): () => void {
    const principal = this.principalFor(opts.owner);
    const operation = authorityOperation ?? opts.operation ?? 'subscribe';
    if (authorityOperation === 'publish') {
      (this.authority ?? currentAuthority().access)?.enforce({ principal, surface: 'events', operation, resource: pattern });
    } else {
      this.enforce(operation, pattern, principal);
    }
    const sub: Subscription = {
      pattern,
      handler,
      ...delivery,
      priority: opts.priority ?? 100,
      registrationOrder: this.nextRegistrationOrder++,
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
      .filter(s => !s.requestProvider && !s.extensionPhase && matchesEvent(s.pattern, event))
      .sort((a, b) => a.priority - b.priority);
  }

  provide<Input, Output>(
    event: string,
    contract: RequestContract<Input, Output>,
    handler: (payload: Input, context: RequestContext) => Output | Promise<Output>,
    opts: Pick<SubscribeOptions, 'scope' | 'owner'> & { authorizePublish?: boolean } = {},
  ): () => void {
    if (!event || event.includes('*')) throw new EventRequestError('EVENT_PROVIDER_INVALID_NAME', event);
    if (this.subs.some(sub => sub.requestProvider && sub.pattern === event)) {
      throw new EventRequestError('EVENT_PROVIDER_DUPLICATE', event);
    }
    const extensionPhases = Object.freeze([...(contract.extensions ?? [])]);
    return this.register(event, async (payload: unknown, context: RequestContext) => {
      if (!contract.input(payload)) throw new EventRequestError('EVENT_REQUEST_INVALID_INPUT', event);
      if (extensionPhases.includes('before')) await this.runExtensionPhase(event, 'before', contract.exposeInput ? contract.exposeInput(payload) : payload, context);
      context.signal.throwIfAborted();
      const result = await handler(payload, this.deliveryContext(context));
      if (!contract.output(result)) throw new EventRequestError('EVENT_REQUEST_INVALID_OUTPUT', event);
      const output = extensionPhases.includes('transform')
        ? await this.runExtensionPhase(event, 'transform', contract.exposeOutput ? contract.exposeOutput(result) : result, context, contract.output, contract.exposeOutput) : result;
      if (extensionPhases.includes('after')) await this.runExtensionPhase(event, 'after', contract.exposeOutput ? contract.exposeOutput(output as Output) : output, context);
      return output;
    }, opts, { requestProvider: true, extensionPhases }, opts.authorizePublish ? 'publish' : undefined);
  }

  /** Replace only the subscriptions owned by this declaration generation. */
  replaceDeclaredExtensions(owner: string, install: () => void): { rollback(): void; dispose(): void } {
    const previous = this.declaredExtensions.get(owner);
    const original = this.subs;
    const previousActive = previous?.filter(sub => original.includes(sub)) ?? [];
    this.subs = original.filter(sub => !previous?.includes(sub));
    const retained = new Set(this.subs);
    try {
      install();
    } catch (error) {
      this.subs = original;
      throw error;
    }
    const next = this.subs.filter(sub => !retained.has(sub));
    this.declaredExtensions.set(owner, next);
    const remove = () => {
      this.subs = this.subs.filter(sub => !next.includes(sub));
      if (this.declaredExtensions.get(owner) !== next) return false;
      this.declaredExtensions.delete(owner);
      return true;
    };
    return {
      dispose: () => { remove(); },
      rollback: () => {
        if (!remove() || !previous) return;
        this.subs.push(...previousActive);
        this.declaredExtensions.set(owner, previous);
      },
    };
  }

  hook(
    event: string,
    phase: ExtensionPhase,
    handler: BusHandler,
    opts: Pick<SubscribeOptions, 'owner' | 'scope' | 'priority'> = {},
  ): () => void {
    if (!['before', 'transform', 'after'].includes(phase)) throw new TypeError('Invalid extension phase');
    if (!event || event.includes('*')) throw new EventRequestError('EVENT_HOOK_INVALID_NAME', event);
    const principal = this.principalFor(opts.owner);
    if (this.subs.some(sub => sub.pattern === event && sub.extensionPhase === phase &&
        sub.principal.kind === principal.kind && sub.principal.id === principal.id)) {
      throw new EventRequestError('EVENT_HOOK_DUPLICATE', event);
    }
    return this.register(event, handler, {
      ...opts, operation: phase === 'transform' ? 'transform' : 'subscribe',
    }, { extensionPhase: phase });
  }

  private deliveryContext(context: RequestContext): RequestContext {
    // A handler can dispatch an Event on its own signal. Keep the request's
    // cancellation signal private so synthetic events cannot affect other phases.
    return Object.freeze({ ...context, signal: AbortSignal.any([context.signal]) });
  }

  private async runExtensionPhase(
    event: string,
    phase: ExtensionPhase,
    payload: unknown,
    context: RequestContext,
    validate?: (value: unknown) => boolean,
    expose?: (value: any) => unknown,
  ): Promise<unknown> {
    const provider = this.subs.find(sub => sub.requestProvider && sub.pattern === event);
    if (!provider?.extensionPhases?.includes(phase)) return payload;
    const hooks = this.subs.filter(sub => sub.pattern === event && sub.extensionPhase === phase)
      .sort((a, b) => a.priority - b.priority || a.registrationOrder - b.registrationOrder);
    let current = payload;
    for (const hook of hooks) {
      context.signal.throwIfAborted();
      const operation = phase === 'transform' ? 'extension-transform'
        : phase === 'before' ? 'extension-before' : 'extension-after';
      // The request's trace ID does not authorize a different delivery edge.
      if (!await this.permits(hook, event, current, undefined, operation)) continue;
      context.signal.throwIfAborted();
      if (!this.subs.includes(hook) || !this.subs.includes(provider)) continue;
      const result = await this.invoke(hook, deserialize(serialize(current)), this.deliveryContext(context), event, operation);
      if (validate && result !== undefined) {
        const replacement = deserialize(serialize(result));
        if (!validate(replacement)) throw new EventRequestError('EVENT_REQUEST_INVALID_OUTPUT', event);
        current = expose ? expose(replacement) : replacement;
      }
    }
    return current;
  }

  async request(event: string, payload: unknown, options: RequestOptions = {}): Promise<unknown> {
    this.enforce('request', event);
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
      throw new RangeError('timeoutMs must be a positive integer supported by setTimeout');
    }
    const controller = new AbortController();
    const { signal } = controller;
    const cancel = () => controller.abort(new EventRequestError('EVENT_REQUEST_CANCELLED', event));
    if (options.signal?.aborted) cancel();
    signal.throwIfAborted();

    const provider = this.subs.find(sub => sub.requestProvider && sub.pattern === event);
    if (!provider) throw new EventRequestError('EVENT_PROVIDER_NOT_FOUND', event);
    const timer = setTimeout(() => {
      controller.abort(new EventRequestError('EVENT_REQUEST_TIMEOUT', event));
    }, timeoutMs);
    options.signal?.addEventListener('abort', cancel, { once: true });
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const deliver = async () => {
        if (!await this.permits(provider, event, payload, options, 'request')) {
          throw new EventRequestError('EVENT_REQUEST_DENIED', event);
        }
        signal.throwIfAborted();
        if (!this.subs.includes(provider)) throw new EventRequestError('EVENT_PROVIDER_NOT_FOUND', event);
        return this.invoke(provider, payload, Object.freeze({ event, signal, flowId: options.flowId }), event, 'request');
      };
      return await Promise.race([aborted, deliver()]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  /** Fire-and-forget. Handler errors are logged, never thrown. */
  async emit(event: string, payload?: any, ctx?: any): Promise<void> {
    this.enforce('publish', event);
    this.eventContracts?.validate(event, payload);
    for (const sub of this.listeners(event)) {
      try {
        if (!await this.permits(sub, event, payload, ctx, 'emit')) continue;
        await this.invoke(sub, payload, { ...(ctx ?? {}), event }, event, 'emit');
      } catch (err: any) {
        this.log(`[bus] handler for '${event}' (owner: ${sub.owner ?? 'kernel'}) failed: ${err?.message ?? err}`);
      }
    }
  }

  /** Await listeners and propagate failures for transactional lifecycle work. */
  async emitStrict(event: string, payload?: any, ctx?: any): Promise<void> {
    this.enforce('publish', event);
    this.eventContracts?.validate(event, payload);
    for (const sub of this.listeners(event)) {
      if (!await this.permits(sub, event, payload, ctx, 'emit')) continue;
      await this.invoke(sub, payload, { ...(ctx ?? {}), event }, event, 'emit');
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
        const result = await this.invoke(sub, current, { ...(ctx ?? {}), event }, event, 'pipeline');
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
        const result = await this.invoke(sub, payload, ctx, event, 'veto');
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
