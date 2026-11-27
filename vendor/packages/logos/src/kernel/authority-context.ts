import { AsyncLocalStorage } from 'node:async_hooks';
import type { AccessController, AuthorityPrincipal } from './access-controller';

export interface EventDelegation {
  readonly caller: Readonly<AuthorityPrincipal>;
  readonly provider: Readonly<AuthorityPrincipal>;
  readonly event: string;
  readonly operation: import('./event-governance').EventDeliveryRequest['operation'];
}

export interface AuthorityContext {
  readonly principal: Readonly<AuthorityPrincipal>;
  readonly access: AccessController | null;
  readonly delegation: readonly EventDelegation[];
}

export const SYSTEM_PRINCIPAL: AuthorityPrincipal = Object.freeze({ kind: 'system', id: 'system' });

const storage = new AsyncLocalStorage<AuthorityContext>();
const DEFAULT_CONTEXT: AuthorityContext = Object.freeze({ principal: SYSTEM_PRINCIPAL, access: null, delegation: Object.freeze([]) });

export function currentAuthority(): AuthorityContext {
  return storage.getStore() ?? DEFAULT_CONTEXT;
}

export function runAsPrincipal<T>(
  access: AccessController,
  principal: AuthorityPrincipal,
  fn: () => T,
): T {
  return storage.run(Object.freeze({
    principal: Object.freeze({ ...principal }), access, delegation: currentAuthority().delegation,
  }), fn);
}

export function runWithEventDelivery<T>(
  provider: AuthorityPrincipal, event: string, operation: EventDelegation['operation'], fn: () => T,
): T {
  const context = currentAuthority();
  const frame: EventDelegation = Object.freeze({
    caller: context.principal, provider: Object.freeze({ ...provider }), event, operation,
  });
  return storage.run(Object.freeze({
    ...context, delegation: Object.freeze([...context.delegation, frame]),
  }), fn);
}

export function runAsPackage<T>(access: AccessController, packageName: string, fn: () => T): T {
  return runAsPrincipal(access, { kind: 'package', id: packageName }, fn);
}

export function runAsSystem<T>(access: AccessController, fn: () => T): T {
  return runAsPrincipal(access, SYSTEM_PRINCIPAL, fn);
}
