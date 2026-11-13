// modules/legacy-entry.ts — v1 "entry" support (wire phase).
//
// v1 allowed a package.json "entry" pointing at a function that receives the
// express app (registerPackage). Preserved as-is minus the odd v1 rule that
// required a routes.js file to exist.

'use strict';

import fs from 'fs';
import path from 'path';
import { Container, LogosModule } from '../kernel/container';
import { runAsPackage } from '../kernel/authority-context';

export function runLegacyEntry(container: Container, pkg: any): void {
  if (!pkg.entry) return;
  const entryPath = path.join(pkg.dir, pkg.entry);
  if (!fs.existsSync(entryPath)) return;

  try {
    const resolved = require.resolve(entryPath);
    delete require.cache[resolved];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const usePackage = require(resolved);
    if (typeof usePackage !== 'function') {
      container.log(`${pkg.name ?? pkg.folder}: invalid entry point (expected a function)`);
      return;
    }
    const result = runAsPackage(container.authority, pkg.folder, () => usePackage(container.app) ?? usePackage);
    result?.setup && runAsPackage(container.authority, pkg.folder, () => result.setup());
    container.log(`${pkg.name ?? pkg.folder} ${pkg.version ? `version ${pkg.version} ` : ''}is running.`);
  } catch (err: any) {
    container.log(`Error with package ${pkg.name ?? pkg.folder}: ${err.message}`);
  }
}

export const legacyEntryModule: LogosModule = {
  name: 'legacy-entry',
  phase: 'wire',
  after: ['http'],
  install(container: Container) {
    container.bus.on('package:wiring', (payload: any) => runLegacyEntry(container, payload.pkg), { priority: 55 });
  },
};
