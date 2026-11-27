import type { RequestOptions } from './bus';
import type { Container } from './container';

export { EventPermissionRequiredError } from './event-call-policy';

/** Packages without `$` retain the legacy event name and operation. */
export async function callPackageEvent(container: Container, event: string, payload?: any, ctx?: any): Promise<any> {
  return container.bus.call(event, payload, ctx);
}

export async function requestPackageResponse(
  container: Container, event: string, payload: unknown, options?: RequestOptions,
): Promise<unknown> {
  return container.bus.request(event, payload, options);
}
