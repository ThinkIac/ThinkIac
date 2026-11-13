// kernel/template.ts — minimal {{dot.path}} substitution.
//
// Exists so data-driven step definitions (crew tasks, flow steps, chain
// prompts stored as JSON) can reference prior results without every package
// writing its own interpolation. Deliberately not a general template
// language: no logic, no loops, just path lookups.

'use strict';

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function resolveTemplate(input: string, ctx: Record<string, any>): string {
  if (typeof input !== 'string') return input;
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = getPath(ctx, path);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}
