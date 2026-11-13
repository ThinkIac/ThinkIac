// kernel/context.ts — RuntimeContext factory (unchanged API from v1).

'use strict';

export function createRuntimeContext(initial: Record<string, any> = {}): Record<string, any> {
  return { ...initial };
}
