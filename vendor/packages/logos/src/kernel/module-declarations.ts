import { parseDeclarations } from './declarations';
import { tagValues } from './jsdoc';

/** Module declarations use the same generic grammar as package resources. */
export function parseModule(fn: Function, doc: string | null) {
  if (typeof fn !== 'function' || !doc) return null;
  const declaration = parseDeclarations(doc).find(entry => entry.type === 'module');
  if (!declaration) return null;
  if (!declaration.name) throw new Error('Module declaration requires a name');
  return {
    name: declaration.name, legacy: declaration.legacy,
    phase: doc.match(/@phase\s+(boot|wire)/)?.[1] ?? 'wire',
    after: tagValues(doc, 'after'), requires: tagValues(doc, 'requires'),
    swappable: !/@swappable\s+false/.test(doc),
    runtime: doc.match(/@runtime\s+(\S+)/)?.[1]?.trim() ?? 'node',
    events: tagValues(doc, 'events'), install: fn,
  };
}
