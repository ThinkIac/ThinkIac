import { AsyncLocalStorage } from 'node:async_hooks';
import type { AccessController, AuthorityPrincipal } from './access-controller';

export interface AuthorityContext {
  principal: AuthorityPrincipal;
  access: AccessController | null;
}

export const SYSTEM_PRINCIPAL: AuthorityPrincipal = Object.freeze({ kind: 'system', id: 'system' });

const storage = new AsyncLocalStorage<AuthorityContext>();
const DEFAULT_CONTEXT: AuthorityContext = Object.freeze({ principal: SYSTEM_PRINCIPAL, access: null });

export function currentAuthority(): AuthorityContext {
  return storage.getStore() ?? DEFAULT_CONTEXT;
}

export function runAsPrincipal<T>(
  access: AccessController,
  principal: AuthorityPrincipal,
  fn: () => T,
): T {
  return storage.run({ principal: Object.freeze({ ...principal }), access }, fn);
}

export function runAsPackage<T>(access: AccessController, packageName: string, fn: () => T): T {
  return runAsPrincipal(access, { kind: 'package', id: packageName }, fn);
}

export function runAsSystem<T>(access: AccessController, fn: () => T): T {
  return runAsPrincipal(access, SYSTEM_PRINCIPAL, fn);
}
