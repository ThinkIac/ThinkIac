import type { Container } from './container';
import { currentAuthority, runAsPackage } from './authority-context';
import type { EffectivePackageContract } from './package-contract';
import { normalizePackageContract } from './package-contract';

export class EventPermissionRequiredError extends Error {
  readonly code = 'EVENT_PERMISSION_REQUIRED';
  readonly package: string;
  readonly event: string;
  readonly requestedEvent: string;

  constructor(packageName: string, event: string, requestedEvent: string) {
    super(`Package ${packageName} requires permission to call ${event}`);
    this.name = 'EventPermissionRequiredError';
    this.package = packageName;
    this.event = event;
    this.requestedEvent = requestedEvent;
  }
}

function effectiveContract(container: Container, folder: string): EffectivePackageContract {
  return container.registry.getActiveContract(folder)
    ?? normalizePackageContract(container.registry.getPackage(folder));
}

/** Opt-in `$()` layer; packages without `$` retain exact legacy behavior. */
export async function callPackageEvent(container: Container, requestedEvent: string, payload?: any, ctx?: any): Promise<any> {
  const principal = currentAuthority().principal;
  if (principal.kind !== 'package') return container.bus.pipeline(requestedEvent, payload, ctx);

  const effective = effectiveContract(container, principal.id);
  const policy = effective.contract.eventCalls;
  if (policy === null) return container.bus.pipeline(requestedEvent, payload, ctx);

  const packageName = effective.contract.package.name;
  const qualified = requestedEvent.includes('::') ? requestedEvent : `${packageName}::${requestedEvent}`;
  const owned = qualified.startsWith(`${packageName}::`);
  const allowed = owned || policy === '*' || policy.includes(requestedEvent) || policy.includes(qualified);
  if (!allowed) throw new EventPermissionRequiredError(packageName, qualified, requestedEvent);

  return runAsPackage(container.authority, principal.id, () =>
    container.bus.pipeline(qualified, payload, ctx, 'request'));
}
