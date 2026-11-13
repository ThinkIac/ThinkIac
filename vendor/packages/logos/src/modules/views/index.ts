// modules/views/index.ts — the views module (wire phase).
//
// Registers /view/<pkg>/<page> for every package with a views/ dir, serves the
// compiled client bundles at /svelte-cache, mounts the bootstrap-configured
// index page at /, listens for .svelte changes to drive HMR, and exposes
// setViewsTheme()/setViewsTailwind()/setViewsGlobalData() (both style-layer
// changes push a live reload to every open page).

'use strict';

import fs from 'fs';
import { measurePhase, setPerformanceRoute } from '../../kernel/http-performance';
import path from 'path';
import express from 'express';
import { Container, LogosModule } from '../../kernel/container';
import { getHub } from '../ws';
import { getPackageMount } from '../http';
import { resolveOfflinePolicy, offlineClientScript, buildOfflineManifest, serviceWorkerScript } from './offline';

export type HotReloadMode = 'always' | 'auto' | 'prompt' | 'manual';
export interface RenderOptions {
  hotReloadMode?: HotReloadMode;
  hotReloadBadge?: boolean;
  offlineClient?: string;
  clientScripts?: string[];
}

const DEFAULT_HOT_RELOAD_MODE: HotReloadMode = 'auto';

// The engine belongs to the reusable Svelte module. Keep both paths because
// source tests execute from src/ while published Lógos executes from dist/src/.
function loadSvelteModule(): any {
  const candidates = [
    path.resolve(__dirname, '../../../../modules/svelte'),
    path.resolve(__dirname, '../../../../../modules/svelte'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error('[logos] required Svelte module was not found');
}

const svelteModule = loadSvelteModule();
const { SvelteEngine, mountPackageViews, isHotReloadMode } = svelteModule;

/**
 * Includes widget files and the widgets directory itself. Directory removals
 * arrive from chokidar without an extension, but still invalidate the global
 * registry just like a removed .svelte/.svx widget does.
 */
export function isWidgetPath(filePath: string): boolean {
  return /[\\/]views[\\/]widgets(?:[\\/]|$)/i.test(filePath);
}

/**
 * Precedência do modo de hot-reload de uma página, do mais específico ao mais
 * geral:
 *
 *   1. `?hmr=always|prompt|manual` na URL      (depuração pontual)
 *   2. `runtime.hotReload.mode` do package.json (o pacote se declara)
 *   3. `views.hotReload.mode` do bootstrap      (política do runtime)
 *   4. 'auto'                                   (default: janela segura e silenciosa)
 *
 * O default `auto` nunca recarrega uma interação ativa, mas converge sem UI
 * quando a página fica ociosa.
 */
export function resolveHotReloadMode(container: Container, pkgFolder: string, query: any = {}): HotReloadMode {
  if (isHotReloadMode(query?.hmr)) return query.hmr;

  const pkg = container.registry?.getPackage?.(pkgFolder);
  const declared = pkg?.runtime?.hotReload?.mode;
  if (isHotReloadMode(declared)) return declared;

  const configured = container.config?.views?.hotReload?.mode;
  if (isHotReloadMode(configured)) return configured;

  return DEFAULT_HOT_RELOAD_MODE;
}

export function getEngine(container: Container): any {
  let engine = container.state('views').get('engine');
  if (!engine) {
    engine = new SvelteEngine(undefined, container.config?.views?.validationIntervalMs ?? 1000);
    container.state('views').set('engine', engine);
  }
  return engine;
}

function globalData(container: Container): Record<string, any> {
  return container.state('views').get('globalData') || {};
}

function isHomepageRedirect(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export type ResolvedView = { page: string; file: string; sourcePath: string; public: boolean };

/** Payload transformado por extensões antes da renderização de uma view. */
export type ViewRenderPayload = {
  packageName: string;
  viewName: string;
  source: 'public' | 'private';
  clientScripts: string[];
};

function isViewPageName(value: string): boolean {
  // A extensão e o marcador .public pertencem ao filesystem, nunca à URL.
  return /^[A-Za-z0-9_-]+$/.test(String(value || ''));
}

function viewFiles(viewsDir: string): string[] {
  try { return fs.readdirSync(viewsDir); } catch { return []; }
}

function privateViewFile(viewsDir: string, page: string): string | null {
  for (const extension of ['svelte', 'svx']) {
    const file = `${page}.${extension}`;
    if (fs.existsSync(path.join(viewsDir, file))) return file;
  }
  return null;
}

function publicViewFile(viewsDir: string, page: string): string | null {
  const escaped = page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = viewFiles(viewsDir).find(file => new RegExp(`^${escaped}\\.public\\.(svelte|svx)$`, 'i').test(file));
  return match || null;
}

/** Resolves a clean URL page name to a private or .public source file. */
export function resolveViewSource(viewsDir: string, page: string, authenticated = false): ResolvedView | null {
  if (!isViewPageName(page)) return null;
  const privateFile = privateViewFile(viewsDir, page);
  const publicFile = publicViewFile(viewsDir, page);
  const file = authenticated ? privateFile || publicFile : publicFile;
  if (!file) return null;
  return { page, file, sourcePath: path.join(viewsDir, file), public: file === publicFile };
}

/** The package root follows the declared Index → Home priority. */
export function resolveEntryView(viewsDir: string, authenticated = false): ResolvedView | null {
  if (authenticated) {
    for (const page of ['Index', 'Home']) {
      const file = privateViewFile(viewsDir, page);
      if (file) return { page, file, sourcePath: path.join(viewsDir, file), public: false };
    }
  }
  for (const page of ['Index', 'Home']) {
    const file = publicViewFile(viewsDir, page);
    if (file) return { page, file, sourcePath: path.join(viewsDir, file), public: true };
  }
  return null;
}

function publicPages(viewsDir: string): Set<string> {
  const pages = new Set<string>();
  for (const file of viewFiles(viewsDir)) {
    const match = file.match(/^([A-Za-z0-9_-]+)\.public\.(?:svelte|svx)$/i);
    if (match) pages.add(match[1]);
  }
  return pages;
}

/** True only for the clean URL of a currently-discovered .public view. */
export function isRegisteredPublicView(container: Container, requestPath: string): boolean {
  const match = String(requestPath || '').split('?')[0].match(/^\/view\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match) return false;
  const [, pkgFolder, page] = match;
  const publicViews: Map<string, Set<string>> | undefined = container.state('views').get('publicViews');
  const pages = publicViews?.get(pkgFolder);
  if (!pages) return false;
  return page ? pages.has(page) : Boolean(resolveEntryView(path.join(container.workspace, pkgFolder, 'views'), false));
}

function replacePublicViews(container: Container, pkgFolder: string, viewsDir: string): void {
  const registry: Map<string, Set<string>> = container.state('views').get('publicViews') ?? new Map();
  registry.set(pkgFolder, publicPages(viewsDir));
  container.state('views').set('publicViews', registry);
}

async function renderPage(container: Container, pkgFolder: string, page: string, query: any, res: any, authenticated = false) {
  setPerformanceRoute(res.req, `/view/${pkgFolder}/:page`);
  const engine = getEngine(container);
  const viewsDir = path.join(container.workspace, pkgFolder, 'views');
  const view = resolveViewSource(viewsDir, page, authenticated);

  if (!view) {
    return res.status(404).send(`[views] "${page}" not found or not public in package "${pkgFolder}"`);
  }
  try {
    const componentName = `${pkgFolder}__${page}${view.public ? '__public' : ''}`;
    const props = { ...globalData(container), ...query };
    const offline = resolveOfflinePolicy(container, pkgFolder);
    const render = await container.bus.pipeline('views:render', {
      packageName: pkgFolder,
      viewName: page,
      source: view.public ? 'public' : 'private',
      clientScripts: [],
    } satisfies ViewRenderPayload, { packageName: pkgFolder, viewName: page, source: view.public ? 'public' : 'private' }) as ViewRenderPayload;
    const html = await measurePhase(res.req, 'view', () => engine.render(view.sourcePath, componentName, props, container.workspace, {
      hotReloadMode: resolveHotReloadMode(container, pkgFolder, query),
      hotReloadBadge: container.config?.views?.hotReload?.badge === true,
      // Pacote sem política offline não recebe o cliente — e sem o cliente
      // nenhum Service Worker é registrado. `off` significa off de verdade.
      offlineClient: offline.mode === 'off' ? undefined : offlineClientScript(offline),
      clientScripts: render.clientScripts,
    }));
    res.send(html);
  } catch (err: any) {
    console.error(`[views] ${pkgFolder}/${page}:`, err);
    res.status(500).send(`<pre>[views] Error:\n${err.stack}</pre>`);
  }
}

/** HMR: invalidate every page whose import graph contains the changed file. */
async function onViewsFileChanged(container: Container, payload: { pkg: string; file: string }): Promise<void> {
  const engine = getEngine(container);
  const changed = path.resolve(payload.file);
  replacePublicViews(container, payload.pkg, path.join(container.workspace, payload.pkg, 'views'));

  // Widgets folder changed → registry must be rebuilt (affects every page).
  const isWidget = isWidgetPath(changed);
  if (isWidget) engine.buildWidgetRegistry(container.workspace);

  // A remoção de uma pasta não pertence ao grafo anterior de nenhuma página.
  // O registry, porém, pertence ao grafo de toda página que usa <Widget>.
  // Portanto sua reconstrução é a mudança que essas páginas precisam receber.
  const affected = [...new Set([
    ...engine.affectedComponents(changed),
    ...(isWidget ? engine.affectedComponents(engine.widgetRegistryPath) : []),
  ])];
  try {
    // A alteração só é publicada depois de compilar e renderizar SSR sem DOM.
    // Assim um `window` fora de onMount mantém a versão saudável em serviço.
    await engine.validateComponents(affected, container.workspace);
    container.state('views').delete?.(`validation:${changed}`);
  } catch (error: any) {
    const detail = error?.stack || error?.message || String(error);
    container.log(`[views:hmr] validation failed for ${path.basename(changed)}: ${detail}`);
    await container.bus.emit('package:reload_failed', {
      pkg: payload.pkg, files: [changed], checks: [{ name: 'views:ssr', ok: false, detail }], error: detail,
    });
    container.state('views').set(`validation:${changed}`, detail);
    return;
  }

  const hub = getHub(container);
  // O payload carrega pacote e arquivos: o cliente só recarrega sozinho no modo
  // `always`; nos outros ele precisa saber O QUE mudou para mostrar ao usuário.
  const signal = { pkg: payload.pkg, files: [path.basename(changed)] };
  if (affected.length) {
    // O registry entra no manifest apenas de páginas que usam <Widget>; até
    // widgets compartilhados podem, portanto, atualizar só seus consumidores.
    hub.broadcast({ type: 'views:hmr', components: affected, all: false, ...signal });
    container.log(`[views:hmr] ${path.basename(changed)} → ${affected.join(', ')}`);
  }
}

export const viewsModule: LogosModule = {
  name: 'views',
  phase: 'wire',
  after: ['http', 'ws'],
  install(container: Container) {
    if (container.config?.views?.enabled === false) return;

    const engine = getEngine(container);
    container.state('views').set('globalData', container.config?.views?.globalData || {});
    engine.setTheme(container.config?.views?.theme || {}, container.config?.views?.bootstrap5);
    engine.setTailwind(container.config?.views?.tailwind ?? false, container.config?.views?.precompileCss ?? false);

    container.bus.on('package:wiring', (payload: any) => mountPackageViews(container, payload.pkg, { getEngine, getPackageMount, replacePublicViews, resolveEntryView, renderPage, staticAssets: express.static }), { priority: 70 });
    container.bus.on('views:file_changed', (payload: any) => onViewsFileChanged(container, payload), { priority: 50 });

    // Política offline computada — é o que o Service Worker precisa e não pode
    // ler (ele não enxerga JSDoc nem package.json).
    container.app.get('/_logos/offline', (_req: any, res: any) => {
      res.set('Cache-Control', 'no-store').json(buildOfflineManifest(container));
    });

    // Servido na RAIZ porque o escopo de um Service Worker é limitado pelo
    // caminho de onde ele é servido: em /logos-sw.js o escopo é `/` e cobre
    // /view/<pkg>/<page> e as rotas dos pacotes. `no-cache` porque o browser
    // precisa revalidar para enxergar uma política nova.
    container.app.get('/logos-sw.js', (_req: any, res: any) => {
      res.set('Content-Type', 'application/javascript')
         .set('Cache-Control', 'no-cache')
         .set('Service-Worker-Allowed', '/')
         .send(serviceWorkerScript(buildOfflineManifest(container)));
    });

    // bootstrap({ views: { index } }) — serve a page (or redirect) at /
    const index = container.config?.views?.index;
    if (index) {
      container.app.get('/', async (req: any, res: any) => {
        // Packages can claim the homepage through the closed `views:index`
        // pipeline.  The configured index remains the default and handlers
        // only affect this request when they explicitly return `redirect`.
        const resolved = await container.bus.pipeline('views:index', { index, req });
        if (isHomepageRedirect(resolved?.redirect)) {
          return res.redirect(resolved.redirect);
        }
        const target = resolved?.index || index;
        if (typeof target === 'string') return res.redirect(target);
        return renderPage(container, target.package, target.page, { ...req.query }, res);
      });
      container.log(`[views] index mounted at / → ${typeof index === 'string' ? index : `${index.package}/${index.page}`}`);
    }
  },
};

// ── Public helpers (exported from src/index.ts) ─────────────────────────────

export function setViewsGlobalData(container: Container, data: Record<string, any>): void {
  container.state('views').set('globalData', data && typeof data === 'object' ? data : {});
}

export function getViewsGlobalData(container: Container): Record<string, any> {
  return globalData(container);
}

export function setViewsTheme(container: Container, theme: Record<string, string>): void {
  getEngine(container).setTheme(theme);
  // Theme lives in each rendered page — push a live reload everywhere.
  getHub(container).broadcast({ type: 'views:hmr', components: [], all: true });
}

/**
 * Toggles the Tailwind v4 CDN runtime at runtime. Combine freely with
 * setViewsTheme() — the same theme variables feed Tailwind's `@theme` block
 * once this is on.
 */
export function setViewsTailwind(container: Container, enabled: boolean): void {
  getEngine(container).setTailwind(enabled);
  getHub(container).broadcast({ type: 'views:hmr', components: [], all: true });
}

export function rebuildWidgetRegistry(container: Container): void {
  getEngine(container).buildWidgetRegistry(container.workspace);
  getHub(container).broadcast({ type: 'views:hmr', components: [], all: true });
}

export function getWidgetComponentPath(container: Container): string {
  return getEngine(container).widgetComponentPath;
}

/** Serial warmup keeps cold builds from competing with one another. */
export async function prewarmViews(container: Container): Promise<{ ready: boolean; failed: string[] }> {
  const failed: string[] = [];
  if (container.config?.views?.enabled === false) return { ready: true, failed };
  for (const target of container.config?.views?.warmup ?? []) {
    const viewsDir = path.join(container.workspace, target.package, 'views');
    // Optional packages are not installed in every tenant.
    if (!fs.existsSync(viewsDir)) continue;
    const view = resolveViewSource(viewsDir, target.page, true);
    if (!view) { failed.push(`${target.package}/${target.page}`); continue; }
    try {
      await getEngine(container).prewarm(view.sourcePath, `${target.package}__${target.page}${view.public ? '__public' : ''}`, container.workspace);
    } catch (error: any) {
      failed.push(`${target.package}/${target.page}`);
      container.log(`[views:warmup] ${target.package}/${target.page}: ${error.message}`);
    }
  }
  return { ready: failed.length === 0, failed };
}
