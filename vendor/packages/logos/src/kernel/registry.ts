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

  /** Discover manifests at any depth. Paths locate packages; manifest names identify them.
   * Symlinks are not followed, so aliases and cycles cannot duplicate a package.
   */
  discover(): PackageInfo[] {
    if (!fs.existsSync(this.workspace)) return [];
    const packages: PackageInfo[] = [];
    const names = new Map<string, string>();
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORE_DIRS.has(entry.name)) continue;
        const dir = path.join(directory, entry.name);
        if (fs.existsSync(path.join(dir, 'package.json'))) {
          const pkg = this.getPackage(path.relative(this.workspace, dir));
          if (pkg.name) {
            const previous = names.get(pkg.name);
            if (previous) throw new Error(`[logos] duplicate package name "${pkg.name}": ${previous} and ${pkg.folder}`);
            names.set(pkg.name, pkg.folder);
          }
          packages.push(pkg);
        }
        visit(dir);
      }
    };
    visit(this.workspace);
    return packages;
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
