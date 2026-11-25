import { jsdocHandler } from './metadata-contracts';
import { schemaFiles } from './model-catalog';
// kernel/scan.ts — file discovery + decorator registration.
//
// This is the v2 successor of register/decorators.js. Differences:
//   * JSDoc is resolved from ABOVE the declaration or INSIDE the body (jsdoc.ts)
//   * The cache is mtime-fingerprinted — valid until a relevant file changes,
//     in development too (v1 rescanned every call in dev)
//   * node_modules and Lógos work dirs are never descended into
//
// The exported register* functions keep the exact v1 signatures so packages
// and external callers do not change.

'use strict';

import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { compileType, loadType } from './type-source';
import { ScanCache } from './cache';
import { IGNORE_DIRS, resolveWorkspace } from './utils';
import { buildAboveDocMap, resolveDoc } from './jsdoc';
import { parseDeclarations } from './declarations';
import { parseModule } from './module-declarations';
import { externalModulePath } from './module-resolution';

export const scanCache = new ScanCache();

// ── File discovery ──────────────────────────────────────────────────────────

// Test fixtures can contain registration markers but must never execute at boot.
const TEST_DIRS = new Set(['test', 'tests', '__tests__']);
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?js|type)$/;

export function getJsFilesRecursively(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || TEST_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      // A nested manifest starts a separate package, scanned under its own owner.
      if (fs.existsSync(path.join(dir, entry.name, 'package.json'))) continue;
      results.push(...getJsFilesRecursively(path.join(dir, entry.name)));
    } else if (entry.isFile() && /\.(?:[cm]?js|type)$/.test(entry.name) && !TEST_FILE.test(entry.name)) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function fingerprint(files: string[]): string {
  let acc = '';
  for (const file of files) {
    try { acc += file + ':' + fs.statSync(file).mtimeMs + ';'; } catch { acc += file + ':gone;'; }
  }
  return acc;
}

export function resolveAgentFolder(agentFolder: string): string | null {
  if (!agentFolder) return null;
  if (path.isAbsolute(agentFolder) && fs.existsSync(agentFolder)) return agentFolder;
  const candidate = path.join(resolveWorkspace(), String(agentFolder));
  if (fs.existsSync(candidate)) return candidate;
  // A package name must resolve inside the configured workspace first.  The
  // application root can legitimately contain runtime-data siblings with the
  // same names (for example `artifacts/` and `agent/`); resolving the cwd
  // first makes the scanner silently mount that data directory instead.
  if (fs.existsSync(agentFolder)) return path.resolve(agentFolder);
  return null;
}

// ── Module loading ──────────────────────────────────────────────────────────

function isEsmFolder(folderPath: string): boolean {
  let dir = folderPath;
  while (true) {
    const pkgJson = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      try { return JSON.parse(fs.readFileSync(pkgJson, 'utf-8')).type === 'module'; }
      catch { return false; }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

// Keep native import at runtime: TypeScript's CommonJS transform rewrites
// import(url) to require(url), which rejects file URLs and falls back to a
// stale Node ESM cache when require() loads an ES module.
const importNative = new Function('url', 'return import(url)') as (url: string) => Promise<any>;
let moduleRevision = 0;
const moduleLoadLocks = new Map<string, Promise<void>>();

async function loadModule(filePath: string, isEsm: boolean, compiledType?: string): Promise<any> {
  const previous = moduleLoadLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  moduleLoadLocks.set(filePath, queued);
  await previous;
  try {
    if (filePath.endsWith('.type')) return loadType(filePath, compiledType);
    if (isEsm) {
      // Do not retry declared ESM with require(): it is invalid and replaces
      // the actionable import failure with ERR_REQUIRE_ESM, leaving routes
      // and tools silently unavailable during boot.
      const url = pathToFileURL(filePath);
      url.searchParams.set('t', `${Date.now()}-${++moduleRevision}`);
      return importNative(url.href);
    }
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(resolved);
  } finally {
    release();
    if (moduleLoadLocks.get(filePath) === queued) moduleLoadLocks.delete(filePath);
  }
}

// On rescan, purge the package's whole CJS subtree from require.cache — not
// just the entry files. Otherwise a reloaded routes.js re-requires its local
// deps (lib/*.js) and gets the STALE cached version, silently mixing module
// versions after a hot-swap (e.g. renamed exports resolving to undefined).
function purgePackageCache(folderPath: string): void {
  const prefix = folderPath.endsWith(path.sep) ? folderPath : folderPath + path.sep;
  const nm = `${path.sep}node_modules${path.sep}`;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix) && !key.includes(nm)) delete require.cache[key];
  }
}

function extractExportedFunctions(mod: any): Function[] {
  if (typeof mod === 'function') return [mod];
  const fns: Function[] = [];
  if (mod && typeof mod === 'object') {
    for (const [key, value] of Object.entries(mod)) {
      if (key === 'default') {
        if (typeof value === 'function') fns.push(value as Function);
        else if (value && typeof value === 'object') {
          for (const inner of Object.values(value)) {
            if (typeof inner === 'function') fns.push(inner as Function);
          }
        }
        continue;
      }
      if (typeof value === 'function') fns.push(value as Function);
    }
  }
  return fns;
}

// ── Generic registration ────────────────────────────────────────────────────

type Parser = (fn: Function, doc: string | null) => any;

export async function registerGeneric(
  agentFolder: string,
  parser: Parser,
  parserName: string,
  mapFn: (meta: any) => any = m => m,
): Promise<any[]> {
  const folderPath = resolveAgentFolder(agentFolder);
  if (!folderPath) throw new Error('Folder not found');

  const files = getJsFilesRecursively(folderPath);
  const cacheKey = `${folderPath}::${parserName}`;
  const fp = fingerprint([...files, ...schemaFiles(folderPath)]);

  const cached = scanCache.get(cacheKey, fp);
  if (cached !== undefined) return cached;

  purgePackageCache(folderPath);
  const results: any[] = [];

  for (const filePath of files) {
    let source: string;
    try { source = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
    if (!/@register(?:_|\s)/.test(source)) continue;
    if (parserName === 'structural-declarations' && !/@register(?:\s+(?:module|type)\b|_module\b)/.test(source)) continue;

    let mod: any;
    let typeDocs: Record<string, string> | undefined;
      // Um pacote ESM pode conter um subdiretório CommonJS com runtime legado.
      // Resolva o modo pelo arquivo, não pela raiz do pacote, para não
      // importar CJS como namespace ESM e registrar cada handler duas vezes.
      try {
        const compiled = filePath.endsWith('.type') ? compileType(source, filePath) : undefined;
        typeDocs = compiled?.docs;
        mod = await loadModule(filePath, isEsmFolder(path.dirname(filePath)), compiled?.js);
      }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (parserName === 'declarations' || parserName === 'structural-declarations') throw new Error(`[logos] failed loading structural declarations ${filePath}: ${reason}`, { cause: error });
      console.warn(`[scan:${parserName}] Failed to load ${filePath}: ${reason}`);
      continue;
    }

    const aboveMap = buildAboveDocMap(source);
    for (const fn of new Set(extractExportedFunctions(mod))) {
      // CoffeeScript exports can be anonymous: use the exported binding as well
      // as fn.name. Keep the existing JavaScript association unchanged.
      const exportName = typeDocs && Object.keys(mod).find(key => mod[key] === fn && typeDocs![key]);
      const doc = typeDocs ? (typeDocs[fn.name] ?? (exportName ? typeDocs[exportName] : null)) : resolveDoc(fn, aboveMap);
      const tags = doc ? parseDeclarations(doc)[0]?.tags : undefined;
      const checked = filePath.endsWith('.type') && tags && !['declarations', 'structural-declarations'].includes(parserName)
        ? jsdocHandler(fn, tags, filePath, `${filePath}:${exportName || fn.name}`) : fn;
      if (checked !== fn) Object.defineProperty(checked, 'name', { value: fn.name });
      const meta = parser(checked, doc);
      if (!meta) continue;
      meta._file = filePath;
      meta._exportName = exportName;
      results.push(mapFn(meta));
    }
  }

  scanCache.set(cacheKey, fp, results);
  return results;
}

// ── Public register* API (v1-compatible signatures) ─────────────────────────

// Concrete aliases delegate to the optional annotations compatibility package.
function legacyScanners(): any { return require(externalModulePath('annotations')).createScanners(registerGeneric); }
export function registerTools(folder: string): Promise<any[]> { return legacyScanners().registerTools(folder); }
export function registerCommands(folder: string): Promise<any[]> { return legacyScanners().registerCommands(folder); }
export function registerHooks(folder: string): Promise<any[]> { return legacyScanners().registerHooks(folder); }
export function registerRoutes(folder: string): Promise<any[]> { return legacyScanners().registerRoutes(folder); }
export function registerPredicates(folder: string): Promise<any[]> { return legacyScanners().registerPredicates(folder); }
export function registerMiddlewares(folder: string): Promise<any[]> { return legacyScanners().registerMiddlewares(folder); }
export function registerModules(folder: string) { return registerGeneric(folder, parseModule, 'modules'); }

/** Discover generic declarations without assigning their semantics to the kernel. */
export async function registerDeclarations(agentFolder: string, structuralOnly = false) {
  const groups = await registerGeneric(agentFolder, (fn, doc) => {
    if (!doc) return null;
    const declarations = parseDeclarations(doc).filter(entry => !structuralOnly || ['module', 'type'].includes(entry.type));
    return declarations.length ? { declarations, handler: fn } : null;
  }, structuralOnly ? 'structural-declarations' : 'declarations');
  return groups.flatMap(group => group.declarations.map((declaration: any) => ({
    declaration: group._file.endsWith('.type') && !declaration.name ? { ...declaration, name: group._exportName || group.handler.name } : declaration, handler: group.handler, file: group._file,
  })));
}
