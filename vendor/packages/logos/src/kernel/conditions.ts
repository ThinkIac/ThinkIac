// kernel/conditions.ts — declarative availability for tools/commands/hooks.
//
// v2 change (documented in MIGRATION.md): `@when` and `@only` were parsed
// separately in v1 but evaluated identically. They are now the same condition
// (`only`). `@never` is unchanged.

'use strict';

export interface Condition {
  only?: string[];
  never?: string[];
  /** v1 leftover — treated as `only`. */
  when?: string[];
}

export async function resolveConditions(condition: Condition = {}, context: Record<string, any> = {}): Promise<boolean> {
  const required = [...(condition.only || []), ...(condition.when || [])];
  for (const key of required) if (!context[key]) return false;
  for (const key of (condition.never || [])) if (context[key]) return false;
  return true;
}
