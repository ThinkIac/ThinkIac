// Generic bridge for capability packages.  The runtime owns lifecycle and
// authority ports; capability implementations stay outside the Logos tree.
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { createRequire, isBuiltin } from 'node:module';
import { buildAboveDocMap, resolveDoc } from './jsdoc';
import { parseDeclarations } from './declarations';
import { collectStructuralDeclaration } from './declarative-catalog';
import { Container, LogosModule } from './container';
import { nativeModuleContext } from './module-context';
import { modulePrimitives } from './module-primitives';
import { externalModulePath, externalModuleRoots } from './module-resolution';
export { externalModulePath } from './module-resolution';

export interface ExternalRuntimeModule extends LogosModule { api?: Record<string, any>; }

/** Resolve a capability without exposing the Logos source-tree layout. */
/**
 * Compatibility discovery reads declared entrypoints without executing packages.
 * A broken declared capability fails during loading instead of disappearing.
 */
export function discoverExternalRuntimeModules(): string[] {
  const entries = new Map<string, string>();
  for (const root of externalModuleRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entries.has(entry.name)) continue;
      const manifestPath = path.join(root, entry.name, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (typeof manifest.runtime?.entry === 'string') entries.set(entry.name, path.join(root, entry.name));
    }
  }
  // Preserve the discovered package identity: a workspace dependency with the
  // same short name (for example mcp) must not replace its capability module.
  return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);
}

/** The protocol deliberately exposes ports, not Logos implementation objects. */

export function installExternalModules(container: Container, names: readonly string[]): void {
  for (const name of names) {
    // Explicit paths and installed packages do not depend on the vendor layout.
    let entry: string;
    if (path.isAbsolute(name) || name.startsWith('.')) {
      entry = path.resolve(container.workspace, name);
    } else if (isBuiltin(name)) {
      // Legacy capability aliases such as http must not resolve to Node built-ins.
      entry = externalModulePath(name);
    } else {
      const resolve = createRequire(path.join(container.workspace, 'package.json'));
      try { entry = resolve.resolve(name); }
      catch (error: any) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        entry = externalModulePath(name);
      }
    }
    // Honor the package's declared runtime entry even when npm's main points
    // at a library API. Entrypoints cannot escape their package directory.
    let directory = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
    while (true) {
      const manifestPath = path.join(directory, 'package.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (typeof manifest.runtime?.entry === 'string') {
          const declared = path.resolve(directory, manifest.runtime.entry);
          const relative = path.relative(directory, declared);
          if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
            throw new Error(`[logos] runtime entrypoint escapes package: ${name}`);
          }
          entry = declared;
        }
        break;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    entry = require.resolve(entry);
    const cleanups = container.state('runtime:entrypoints');
    if (cleanups.has(entry)) continue;
    const exported = require(entry);
    const subscriptions = new Set<() => void>();
    const clean = () => { for (const off of subscriptions) off(); subscriptions.clear(); };
    cleanups.set(entry, clean);
    const above = buildAboveDocMap(fs.readFileSync(entry, 'utf8'));
    const declarations = [...new Set(Object.values(exported).filter((value): value is Function => typeof value === 'function'))]
      .flatMap(handler => parseDeclarations(resolveDoc(handler, above) ?? '').filter(declaration => ['module', 'type'].includes(declaration.type))
        .map(declaration => ({ declaration, handler, file: entry })));
    if (declarations.length) {
      const off = container.bus.on('logos:modules:register', async () => {
        for (const declaration of declarations) {
          // Explicit programmatic overrides retain their compatibility semantics.
          if (declaration.declaration.type === 'module' && container.state('runtime:programmatic-modules').has(declaration.declaration.name!)) continue;
          await collectStructuralDeclaration(container, declaration, `external:${directory}`, subscriptions);
        }
      });
      subscriptions.add(off);
      continue;
    }
    if (typeof exported.register === 'function') {
      const native = nativeModuleContext(container, name, subscriptions);
      const off = container.bus.on('logos:modules:register', () => native.collect(exported.register));
      subscriptions.add(off);
      continue;
    }
    const factory = exported.createRuntimeModule;
    if (typeof factory !== 'function') throw new Error(`[logos] external module "${name}" must export register(context) or the compatibility factory createRuntimeModule(host)`);
    const adapt = exported.createHost ?? require(externalModulePath('runtime-compat')).createHost;
    const external: ExternalRuntimeModule = factory(adapt(container, modulePrimitives(), subscriptions));
    if (!external || typeof external.install !== 'function' || !external.name || !external.phase) throw new Error(`[logos] invalid external module "${name}"`);
    container.use({ ...external, async close() {
      try { await external.close?.(); } finally {
        for (const off of subscriptions) off();
        subscriptions.clear();
      }
    } }, `external:${name}`);
  }
}

export function externalApi<T = any>(container: Container, name: string): T {
  const api = container.state('external-api').get(name);
  if (!api) throw new Error(`[logos] external capability unavailable: ${name}`);
  return api as T;
}
