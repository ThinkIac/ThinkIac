import { randomUUID } from 'node:crypto';
import { currentAuthority } from './authority-context';
import type { Container } from './container';

export const RUNTIME_PROTOCOL_VERSION = 1 as const;

/** Critical delivery propagates failures; ordinary emit retains v1 semantics. */
export async function runtimeEvent(container: Container, event: string, phase: string, data: Record<string, any> = {}, strict = true): Promise<void> {
  const state = container.state('runtime:protocol');
  if (!state.has('correlationId')) state.set('correlationId', randomUUID());
  const payload = Object.freeze({
    ...data, version: RUNTIME_PROTOCOL_VERSION, origin: 'logos', workspace: container.workspace,
    package: data.package ?? null, correlationId: state.get('correlationId'), phase,
    authority: currentAuthority().principal,
  });
  if (strict) await container.bus.emitStrict(event, payload);
  else await container.bus.emit(event, payload);
}
