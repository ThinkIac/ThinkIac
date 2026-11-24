// Lazy adapter for existing imports. Native registration needs no annotations SDK.
import path from 'node:path';
import { externalModulePath } from './module-resolution';
import { registerGeneric, resolveAgentFolder } from './scan';
export function annotatedCompatibility(name: string): any {
  const root = externalModulePath('annotations');
  if (name === 'conditions') return require(path.join(root, 'conditions.cjs'));
  if (!['middleware', 'manifest'].includes(name)) throw new Error(`Unknown annotation adapter: ${name}`);
  const scanners = require(root).createScanners(registerGeneric);
  return require(path.join(root, `${name}.cjs`)).create({ ...scanners, resolveAgentFolder });
}
