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
import { ScanCache } from './cache';
import { IGNORE_DIRS, resolveWorkspace } from './utils';
import { buildAboveDocMap, resolveDoc } from './jsdoc';
import { parseDeclarations } from './declarations';
import {
  parseTool, parseHook, parseRoute, parseCommand,
  parsePredicate, parseMiddleware, parseModule,
} from './parsers';

export const scanCache = new ScanCache();

// ── File discovery ──────────────────────────────────────────────────────────

// Test fixtures can contain registration markers but must never execute at boot.
const TEST_DIRS = new Set(['test', 'tests', '__tests__']);
const TEST_FILE = /\.(?:test|spec)\.js$/;

export function getJsFilesRecursively(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || TEST_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      results.push(...getJsFilesRecursively(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !TEST_FILE.test(entry.name)) {
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

async function loadModule(filePath: string, isEsm: boolean): Promise<any> {
  const previous = moduleLoadLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  moduleLoadLocks.set(filePath, queued);
  await previous;
  try {
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
  const fp = fingerprint(files);

  const cached = scanCache.get(cacheKey, fp);
  if (cached !== undefined) return cached;

  purgePackageCache(folderPath);
  const results: any[] = [];

  for (const filePath of files) {
    let source: string;
    try { source = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
    if (!/@register(?:_|\s)/.test(source)) continue;

    let mod: any;
      // Um pacote ESM pode conter um subdiretório CommonJS com runtime legado.
      // Resolva o modo pelo arquivo, não pela raiz do pacote, para não
      // importar CJS como namespace ESM e registrar cada handler duas vezes.
      try { mod = await loadModule(filePath, isEsmFolder(path.dirname(filePath))); }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[scan:${parserName}] Failed to load ${filePath}: ${reason}`);
      continue;
    }

    const aboveMap = buildAboveDocMap(source);
    for (const fn of extractExportedFunctions(mod)) {
      const doc = resolveDoc(fn, aboveMap);
      const meta = parser(fn, doc);
      if (!meta) continue;
      meta._file = filePath;
      results.push(mapFn(meta));
    }
  }

  scanCache.set(cacheKey, fp, results);
  return results;
}

// ── Public register* API (v1-compatible signatures) ─────────────────────────

const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

// @param {string[]} / {object[]} etc. chegam do parser com o "type" literal
// (ex.: "string[]") — não é um tipo de JSON Schema válido, e a Anthropic API
// rejeita a tool inteira (400 "JSON schema is invalid") quando algum
// inputSchema traz isso. Convertido pra {type:'array', items:{type:...}}.
//
// @enum vira `enum` no próprio schema (JSON Schema padrão — o LLM e a UI já
// entendem). @enumSource não tem equivalente padrão: o schema é estático e a
// fonte é viva, então viaja como metadado `x-enumSource` e quem resolve é o
// consumidor (o Lógos declara, o app resolve).
function toJsonSchemaProperty(param: { type: string; description: string | null; enum?: string[]; enumSource?: string }) {
  const { type: rawType, description } = param;
  const extra: any = {};
  if (param.enum && param.enum.length) extra.enum = param.enum;
  if (param.enumSource) extra['x-enumSource'] = param.enumSource;

  if (typeof rawType === 'string' && rawType.endsWith('[]')) {
    const itemType = rawType.slice(0, -2);
    return {
      type: 'array',
      items: { type: JSON_SCHEMA_TYPES.has(itemType) ? itemType : 'string', ...extra },
      description,
    };
  }
  return { type: JSON_SCHEMA_TYPES.has(rawType) ? rawType : 'string', description, ...extra };
}

export function registerTools(agentFolder: string) {
  return registerGeneric(agentFolder, parseTool, 'tools', meta => ({
    name: meta.name,
    description: meta.description,
    parameters: {
      type: 'object',
      properties: (meta.parameters || []).reduce((acc: any, p: any) => {
        acc[p.name] = toJsonSchemaProperty(p);
        return acc;
      }, {}),
      required: (meta.parameters || []).filter((p: any) => p.required).map((p: any) => p.name),
    },
    call: meta.call,
    condition: meta.condition,
    _file: meta._file,
  }));
}

export function registerCommands(agentFolder: string) {
  return registerGeneric(agentFolder, parseCommand, 'commands');
}

export function registerHooks(agentFolder: string)       { return registerGeneric(agentFolder, parseHook, 'hooks'); }
export function registerRoutes(agentFolder: string)      { return registerGeneric(agentFolder, parseRoute, 'routes'); }
export function registerPredicates(agentFolder: string)  { return registerGeneric(agentFolder, parsePredicate, 'predicates'); }
export function registerMiddlewares(agentFolder: string) { return registerGeneric(agentFolder, parseMiddleware, 'middlewares'); }
export function registerModules(agentFolder: string)     { return registerGeneric(agentFolder, parseModule, 'modules'); }

/** Discover generic declarations without assigning their semantics to the kernel. */
export async function registerDeclarations(agentFolder: string) {
  const groups = await registerGeneric(agentFolder, (fn, doc) => {
    if (!doc) return null;
    const declarations = parseDeclarations(doc);
    return declarations.length ? { declarations, handler: fn } : null;
  }, 'declarations');
  return groups.flatMap(group => group.declarations.map((declaration: any) => ({
    declaration, handler: group.handler, file: group._file,
  })));
}
