// kernel/registry.ts — package discovery + per-package lifecycle state.
//
// Lifecycle:  discovered → wiring → active
//                                 → failed
//             active → staging → active (swap ok)
//                              → active (staging failed, old version serving)
//                              → rolled_back (checkpoint restored)

'use strict';

import fs from 'fs';
import path from 'path';
import { IGNORE_DIRS, safeReadJson } from './utils';
import type { PackageHealth } from '../stabilizer/health';
import type { EffectivePackageContract } from './package-contract';

export type PackageState =
  | 'discovered' | 'wiring' | 'active' | 'failed' | 'staging' | 'rolled_back'
  | 'denied_contract'
  | 'blocked'
  // parado de propósito (stopPackage): rotas vazias e streams soltos, mas o
  // pacote continua no disco e sobe de novo com startPackage.
  | 'stopped';

export interface PackageInfo {
  folder: string;
  path: string;
  dir: string;
  name?: string;
  version?: string;
  entry?: string;
  /** Parsed package.json (merged in, v1 compat: manifest fields on the object). */
  [key: string]: any;
}

export class PackageRegistry {
  workspace: string;
  private states = new Map<string, { state: PackageState; error?: string; since: number; health?: PackageHealth }>();
  private activeContracts = new Map<string, EffectivePackageContract>();

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  /** Reads one package's manifest. Throws only on unreadable folder. */
  getPackage(folderName: string): PackageInfo {
    const dir = path.join(this.workspace, folderName);
    const manifestPath = path.join(dir, 'package.json');
    let manifest: any = {};
    if (fs.existsSync(manifestPath)) {
      manifest = safeReadJson(manifestPath) ?? {};
    }
    return { ...manifest, folder: folderName, path: dir, dir };
  }

  /**
   * Lists packages from the two stable workspace roots:
   *
   * - `<workspace>/<package>` for applications and legacy packages;
   * - `<workspace>/modules/<module>` for passive runtime modules;
   * - `<workspace>/<owner>/mcp` for an MCP module colocated with its owner.
   *
   * We deliberately do not perform an unrestricted recursive scan. An
   * application may contain nested package.json files for a web client, a
   * fixture or a vendored tool; treating those as Lógos packages makes the
   * runtime topology depend on implementation details of an application.
   */
  discover(): PackageInfo[] {
    if (!fs.existsSync(this.workspace)) return [];
    const direct = fs.readdirSync(this.workspace, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name) && e.name !== 'modules')
      .map(e => this.getPackage(e.name));
    const modulesRoot = path.join(this.workspace, 'modules');
    const modules = fs.existsSync(modulesRoot)
      ? fs.readdirSync(modulesRoot, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name))
        .map(e => this.getPackage(path.join('modules', e.name)))
      : [];
    // MCP may be colocated with a package (for example `agent/mcp`) while
    // still being a runtime module.  This is intentionally an exact,
    // one-level convention, not a recursive package.json scan: applications
    // commonly contain nested clients, fixtures and vendored projects.
    const colocatedMcp = fs.readdirSync(this.workspace, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !IGNORE_DIRS.has(e.name) && e.name !== 'modules')
      .map(e => path.join(e.name, 'mcp'))
      .filter(folder => fs.existsSync(path.join(this.workspace, folder))
        && fs.statSync(path.join(this.workspace, folder)).isDirectory()
        && fs.existsSync(path.join(this.workspace, folder, 'package.json')))
      .map(folder => this.getPackage(folder));
    return [...direct, ...modules, ...colocatedMcp];
  }

  /** Packages whose manifest declares `"runtime": { "role": "module" }`. */
  isModulePackage(pkg: PackageInfo): boolean {
    return pkg?.runtime?.role === 'module';
  }

  setState(folder: string, state: PackageState, error?: string): void {
    this.states.set(folder, { state, error, since: Date.now(), ...(this.states.get(folder)?.health ? { health: this.states.get(folder)!.health } : {}) });
  }

  setHealth(folder: string, health: PackageHealth): void {
    const state = this.states.get(folder);
    if (state) state.health = { ...health };
  }

  getState(folder: string) {
    return this.states.get(folder) ?? null;
  }

  setActiveContract(folder: string, contract: EffectivePackageContract): void {
    this.activeContracts.set(folder, contract);
  }

  getActiveContract(folder: string): EffectivePackageContract | null {
    return this.activeContracts.get(folder) ?? null;
  }

  snapshot(): Record<string, any> {
    return Object.fromEntries(this.states);
  }
}
