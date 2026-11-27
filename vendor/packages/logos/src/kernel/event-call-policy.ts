import type { AuthorityPrincipal } from './access-controller';
import type { PackageContractV1 } from './package-contract';

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

export type ResolveEventContract = (principal: AuthorityPrincipal) => PackageContractV1 | null;

export function eventCallAllowed(contract: PackageContractV1, event: string): boolean {
  const policy = contract.eventCalls;
  return policy === null || policy === '*' || event.startsWith(`${contract.package.name}::`) || policy.includes(event);
}
