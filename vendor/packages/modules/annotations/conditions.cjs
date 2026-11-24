// kernel/conditions.ts — declarative availability for tools/commands/hooks.
//
// v2 change (documented in MIGRATION.md): `@when` and `@only` were parsed
// separately in v1 but evaluated identically. They are now the same condition
// (`only`). `@never` is unchanged.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveConditions = resolveConditions;
async function resolveConditions(condition = {}, context = {}) {
    const required = [...(condition.only || []), ...(condition.when || [])];
    for (const key of required)
        if (!context[key])
            return false;
    for (const key of (condition.never || []))
        if (context[key])
            return false;
    return true;
}
