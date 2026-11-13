// Generic bridge for capability packages.  The runtime owns lifecycle and
// authority ports; capability implementations stay outside the Logos tree.
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { Container, LogosModule } from './container';
import type { BusHandler, SubscribeOptions } from './bus';
import { createRuntimeContext } from './context';
import { resolveConditions } from './conditions';
import { appendLog } from './debug-log';
import { currentAuthority, runAsPackage, runAsSystem, SYSTEM_PRINCIPAL } from './authority-context';
import { PrivateVault, openSqlCipherDatabase } from '../vault/private-vault';
import { composePackageSchema } from '../database/schema-composer';
import express from 'express';
import { registerRoutes, registerHooks, registerTools, registerCommands } from './scan';
import { getIsolatedRunner } from '../core/isolated/bridge';
import { loadMiddlewareSnapshot, resolveMiddlewares, runMiddlewares } from './middleware';
import { routeMountPath } from './utils';
import { measurePhase, recordPhase, setPerformanceRoute } from './http-performance';
import { generateManifest } from './manifest';
import { getErrors } from './debug-log';
import { requestReboot } from '../stabilizer/isolation';

export interface ExternalRuntimeModule extends LogosModule { api?: Record<string, any>; }

/** Resolve a capability without exposing the Logos source-tree layout. */
function externalModuleRoots(): string[] {
  return [path.resolve(__dirname, '../../../modules'), path.resolve(__dirname, '../../../../modules')];
}

export function externalModulePath(name: string): string {
  for (const root of externalModuleRoots()) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`[logos] external capability module not found: ${name}`);
}

/**
 * Finds ordinary module packages that participate in this runtime.  A package
 * is a capability only when its public entry exports createRuntimeModule;
 * libraries such as websocket transport and process-bridge remain libraries.
 */
export function discoverExternalRuntimeModules(): string[] {
  const names = new Set<string>();
  for (const root of externalModuleRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || names.has(entry.name)) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        if (typeof require(path.join(root, entry.name)).createRuntimeModule === 'function') names.add(entry.name);
      } catch {
        // A library package may intentionally have unavailable optional peers.
        // It is not a runtime capability unless its entry loads successfully.
      }
    }
  }
  return [...names].sort();
}

/** The protocol deliberately exposes ports, not Logos implementation objects. */
function host(container: Container) {
  return Object.freeze({
    applicationRoot: () => process.cwd(),
    workspace: () => container.workspace,
    dataDir: () => process.env.LOGOS_DATA_DIR,
    composeSchema: composePackageSchema,
    appendLog,
    currentAuthority,
    createVault: (config: any) => new PrivateVault(config),
    openPrivateDatabase: openSqlCipherDatabase,
    log: (message: string) => container.log(message),
    createContext: createRuntimeContext,
    resolveConditions,
    scanHooks: registerHooks,
    loadTools: (workspace: string) => externalApi<any>(container, 'tools').loadMcpTools(workspace),
    // Keep the event port complete. External capabilities must not receive the
    // container, but lifecycle listeners need the same one-shot semantics as
    // built-in modules (for example, initialization after package wiring).
    on: (event: string, handler: BusHandler, options?: SubscribeOptions) => container.bus.on(event, handler, options),
    once: (event: string, handler: BusHandler, options?: SubscribeOptions) => container.bus.once(event, handler, options),
    emit: (event: string, payload?: any, context?: any) => container.bus.emit(event, payload, context),
    pipeline: (event: string, payload?: any, context?: any) => container.bus.pipeline(event, payload, context),
    veto: (event: string, payload?: any, context?: any) => container.bus.veto(event, payload, context),
    state: (namespace: string) => container.state(namespace),
    registry: Object.freeze({
      getPackage: (name: string) => container.registry.getPackage(name),
      discover: () => container.registry.discover(),
    }),
    config: () => container.config,
    // Capability modules receive narrowly-scoped runtime ports.  These are
    // deliberately functions rather than the Container itself, so a package
    // can own a capability without importing Logos internals.
    http: Object.freeze({
      app: () => container.app,
      express,
      getPackageMount: () => externalApi<any>(container, 'http').getPackageMount(),
      scanRoutes: registerRoutes,
      isolatedRunner: (pkg: string) => getIsolatedRunner(container, pkg),
      createContext: createRuntimeContext,
      loadMiddlewareSnapshot,
      resolveMiddlewares,
      runMiddlewares,
      routeMountPath,
      recordOfflineRoutes: (pkg: string, routes: any[]) => container.bus.emit('views:offline_routes', { pkg, routes }),
      measurePhase,
      recordPhase,
      setPerformanceRoute,
      runAsPackage: (pkg: string, work: () => any) => runAsPackage(container.authority, pkg, work),
    }),
    ws: Object.freeze({ getHub: () => externalApi<any>(container, 'ws').getHub() }),
    tools: Object.freeze({
      authority: () => container.authority,
      scan: registerTools,
      resolveMiddlewares,
      runMiddlewares,
      generateManifest,
      getErrors,
      requestReboot: (ignored: any, options: any) => requestReboot(container, options),
      currentAuthority,
      runAsPackage: (_authority: any, pkg: string, work: () => any) => runAsPackage(container.authority, pkg, work),
      runAsSystem: (_authority: any, work: () => any) => runAsSystem(container.authority, work),
      isolatedRunner: (_ignored: any, pkg: string) => getIsolatedRunner(container, pkg),
    }),
    commands: Object.freeze({
      scan: registerCommands,
      resolveConditions,
      createContext: createRuntimeContext,
      resolveMiddlewares,
      runMiddlewares,
    }),
    storage: Object.freeze({
      config: () => container.config.storage || {},
      workspace: () => container.workspace,
    }),
    // Process and repository capabilities receive only the lifecycle ports
    // they need.  They deliberately do not receive the Container itself.
    process: Object.freeze({
      getScope: (pkg: string) => container.getPackageScope(pkg),
      createScope: (pkg: string, version: string) => container.createPackageScope(pkg, version),
      disposeScope: (pkg: string, reason: string) => container.disposePackageScope(pkg, reason),
      supervisor: () => container.state('supervisor').get('controller'),
    }),
    // Repository transport is external. This compatibility handle is only
    // the capability port for the pre-event repository protocol.
    repo: Object.freeze({
      container: () => container,
      isBranchInstance: () => process.env.LOGOS_ROLE === 'branch',
    }),
    scopes: Object.freeze({
      get: (pkg: string) => container.getPackageScope(pkg),
      create: (pkg: string, version: string) => container.createPackageScope(pkg, version),
      dispose: (pkg: string, reason: string) => container.disposePackageScope(pkg, reason),
      removeOwner: (pkg: string) => container.bus.removeOwner(pkg),
    }),
  });
}

export function installExternalModules(container: Container, names: readonly string[]): void {
  for (const name of names) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const factory = require(externalModulePath(name)).createRuntimeModule;
    if (typeof factory !== 'function') throw new Error(`[logos] external module "${name}" must export createRuntimeModule(host)`);
    const external: ExternalRuntimeModule = factory(host(container));
    if (!external || typeof external.install !== 'function' || !external.name || !external.phase) throw new Error(`[logos] invalid external module "${name}"`);
    container.use(external, `external:${name}`);
    if (external.api) container.state('external-api').set(external.name, Object.freeze(external.api));
  }
}

export function externalApi<T = any>(container: Container, name: string): T {
  const api = container.state('external-api').get(name);
  if (!api) throw new Error(`[logos] external capability unavailable: ${name}`);
  return api as T;
}
