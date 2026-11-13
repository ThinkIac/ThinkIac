// modules/views/index.ts — the views module (wire phase).
//
// Registers /view/<pkg>/<page> for every package with a views/ dir, serves the
// compiled client bundles at /svelte-cache, mounts the bootstrap-configured
// index page at /, listens for .svelte changes to drive HMR, and exposes
// setViewsTheme()/setViewsTailwind()/setViewsGlobalData() (both style-layer
// changes push a live reload to every open page).
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewsModule = void 0;
exports.isWidgetPath = isWidgetPath;
exports.resolveHotReloadMode = resolveHotReloadMode;
exports.getEngine = getEngine;
exports.resolveViewSource = resolveViewSource;
exports.resolveEntryView = resolveEntryView;
exports.isRegisteredPublicView = isRegisteredPublicView;
exports.setViewsGlobalData = setViewsGlobalData;
exports.getViewsGlobalData = getViewsGlobalData;
exports.setViewsTheme = setViewsTheme;
exports.setViewsTailwind = setViewsTailwind;
exports.rebuildWidgetRegistry = rebuildWidgetRegistry;
exports.getWidgetComponentPath = getWidgetComponentPath;
exports.prewarmViews = prewarmViews;
const fs_1 = __importDefault(require("fs"));
const http_performance_1 = require("./views-bridge.cjs");
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const ws_1 = require("./views-bridge.cjs");
const http_1 = require("./views-bridge.cjs");
const offline_1 = require("./offline.cjs");
const DEFAULT_HOT_RELOAD_MODE = 'auto';
// The engine belongs to the reusable Svelte module. Keep both paths because
// source tests execute from src/ while published Lógos executes from dist/src/.
// Load the engine directly. Requiring the package root here would recurse
// through runtime-module.cjs while this capability is being installed.
const { SvelteEngine, isHotReloadMode } = require('./engine.cjs');
const { mountPackageViews } = require('./routes.cjs');
/**
 * Includes widget files and the widgets directory itself. Directory removals
 * arrive from chokidar without an extension, but still invalidate the global
 * registry just like a removed .svelte/.svx widget does.
 */
function isWidgetPath(filePath) {
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
function resolveHotReloadMode(container, pkgFolder, query = {}) {
    if (isHotReloadMode(query?.hmr))
        return query.hmr;
    const pkg = container.registry?.getPackage?.(pkgFolder);
    const declared = pkg?.runtime?.hotReload?.mode;
    if (isHotReloadMode(declared))
        return declared;
    const configured = container.config?.views?.hotReload?.mode;
    if (isHotReloadMode(configured))
        return configured;
    return DEFAULT_HOT_RELOAD_MODE;
}
function getEngine(container) {
    let engine = container.state('views').get('engine');
    if (!engine) {
        engine = new SvelteEngine(undefined, container.config?.views?.validationIntervalMs ?? 1000);
        container.state('views').set('engine', engine);
    }
    return engine;
}
function globalData(container) {
    return container.state('views').get('globalData') || {};
}
function isHomepageRedirect(value) {
    if (typeof value !== 'string')
        return false;
    if (value.startsWith('/') && !value.startsWith('//'))
        return true;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    }
    catch {
        return false;
    }
}
function isViewPageName(value) {
    // A extensão e o marcador .public pertencem ao filesystem, nunca à URL.
    return /^[A-Za-z0-9_-]+$/.test(String(value || ''));
}
function viewFiles(viewsDir) {
    try {
        return fs_1.default.readdirSync(viewsDir);
    }
    catch {
        return [];
    }
}
function privateViewFile(viewsDir, page) {
    for (const extension of ['svelte', 'svx']) {
        const file = `${page}.${extension}`;
        if (fs_1.default.existsSync(path_1.default.join(viewsDir, file)))
            return file;
    }
    return null;
}
function publicViewFile(viewsDir, page) {
    const escaped = page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = viewFiles(viewsDir).find(file => new RegExp(`^${escaped}\\.public\\.(svelte|svx)$`, 'i').test(file));
    return match || null;
}
/** Resolves a clean URL page name to a private or .public source file. */
function resolveViewSource(viewsDir, page, authenticated = false) {
    if (!isViewPageName(page))
        return null;
    const privateFile = privateViewFile(viewsDir, page);
    const publicFile = publicViewFile(viewsDir, page);
    const file = authenticated ? privateFile || publicFile : publicFile;
    if (!file)
        return null;
    return { page, file, sourcePath: path_1.default.join(viewsDir, file), public: file === publicFile };
}
/** The package root follows the declared Index → Home priority. */
function resolveEntryView(viewsDir, authenticated = false) {
    if (authenticated) {
        for (const page of ['Index', 'Home']) {
            const file = privateViewFile(viewsDir, page);
            if (file)
                return { page, file, sourcePath: path_1.default.join(viewsDir, file), public: false };
        }
    }
    for (const page of ['Index', 'Home']) {
        const file = publicViewFile(viewsDir, page);
        if (file)
            return { page, file, sourcePath: path_1.default.join(viewsDir, file), public: true };
    }
    return null;
}
function publicPages(viewsDir) {
    const pages = new Set();
    for (const file of viewFiles(viewsDir)) {
        const match = file.match(/^([A-Za-z0-9_-]+)\.public\.(?:svelte|svx)$/i);
        if (match)
            pages.add(match[1]);
    }
    return pages;
}
/** True only for the clean URL of a currently-discovered .public view. */
function isRegisteredPublicView(container, requestPath) {
    const match = String(requestPath || '').split('?')[0].match(/^\/view\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (!match)
        return false;
    const [, pkgFolder, page] = match;
    const publicViews = container.state('views').get('publicViews');
    const pages = publicViews?.get(pkgFolder);
    if (!pages)
        return false;
    return page ? pages.has(page) : Boolean(resolveEntryView(path_1.default.join(container.workspace, pkgFolder, 'views'), false));
}
function replacePublicViews(container, pkgFolder, viewsDir) {
    const registry = container.state('views').get('publicViews') ?? new Map();
    registry.set(pkgFolder, publicPages(viewsDir));
    container.state('views').set('publicViews', registry);
}
async function renderPage(container, pkgFolder, page, query, res, authenticated = false) {
    (0, http_performance_1.setPerformanceRoute)(res.req, `/view/${pkgFolder}/:page`);
    const engine = getEngine(container);
    const viewsDir = path_1.default.join(container.workspace, pkgFolder, 'views');
    const view = resolveViewSource(viewsDir, page, authenticated);
    if (!view) {
        return res.status(404).send(`[views] "${page}" not found or not public in package "${pkgFolder}"`);
    }
    try {
        const componentName = `${pkgFolder}__${page}${view.public ? '__public' : ''}`;
        const props = { ...globalData(container), ...query };
        const offline = (0, offline_1.resolveOfflinePolicy)(container, pkgFolder);
        const render = await container.bus.pipeline('views:render', {
            packageName: pkgFolder,
            viewName: page,
            source: view.public ? 'public' : 'private',
            clientScripts: [],
        }, { packageName: pkgFolder, viewName: page, source: view.public ? 'public' : 'private' });
        const html = await (0, http_performance_1.measurePhase)(res.req, 'view', () => engine.render(view.sourcePath, componentName, props, container.workspace, {
            hotReloadMode: resolveHotReloadMode(container, pkgFolder, query),
            hotReloadBadge: container.config?.views?.hotReload?.badge === true,
            // Pacote sem política offline não recebe o cliente — e sem o cliente
            // nenhum Service Worker é registrado. `off` significa off de verdade.
            offlineClient: offline.mode === 'off' ? undefined : (0, offline_1.offlineClientScript)(offline),
            clientScripts: render.clientScripts,
        }));
        res.send(html);
    }
    catch (err) {
        console.error(`[views] ${pkgFolder}/${page}:`, err);
        res.status(500).send(`<pre>[views] Error:\n${err.stack}</pre>`);
    }
}
/** HMR: invalidate every page whose import graph contains the changed file. */
async function onViewsFileChanged(container, payload) {
    const engine = getEngine(container);
    const changed = path_1.default.resolve(payload.file);
    replacePublicViews(container, payload.pkg, path_1.default.join(container.workspace, payload.pkg, 'views'));
    // Widgets folder changed → registry must be rebuilt (affects every page).
    const isWidget = isWidgetPath(changed);
    if (isWidget)
        engine.buildWidgetRegistry(container.workspace);
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
    }
    catch (error) {
        const detail = error?.stack || error?.message || String(error);
        container.log(`[views:hmr] validation failed for ${path_1.default.basename(changed)}: ${detail}`);
        await container.bus.emit('package:reload_failed', {
            pkg: payload.pkg, files: [changed], checks: [{ name: 'views:ssr', ok: false, detail }], error: detail,
        });
        container.state('views').set(`validation:${changed}`, detail);
        return;
    }
    const hub = (0, ws_1.getHub)(container);
    // O payload carrega pacote e arquivos: o cliente só recarrega sozinho no modo
    // `always`; nos outros ele precisa saber O QUE mudou para mostrar ao usuário.
    const signal = { pkg: payload.pkg, files: [path_1.default.basename(changed)] };
    if (affected.length) {
        // O registry entra no manifest apenas de páginas que usam <Widget>; até
        // widgets compartilhados podem, portanto, atualizar só seus consumidores.
        hub.broadcast({ type: 'views:hmr', components: affected, all: false, ...signal });
        container.log(`[views:hmr] ${path_1.default.basename(changed)} → ${affected.join(', ')}`);
    }
}
exports.viewsModule = {
    name: 'views',
    phase: 'wire',
    after: ['http', 'ws'],
    install(container) {
        if (container.config?.views?.enabled === false)
            return;
        const engine = getEngine(container);
        container.state('views').set('globalData', container.config?.views?.globalData || {});
        engine.setTheme(container.config?.views?.theme || {}, container.config?.views?.bootstrap5);
        engine.setTailwind(container.config?.views?.tailwind ?? false, container.config?.views?.precompileCss ?? false);
        container.bus.on('package:wiring', (payload) => mountPackageViews(container, payload.pkg, { getEngine, getPackageMount: http_1.getPackageMount, replacePublicViews, resolveEntryView, renderPage, staticAssets: express_1.default.static }), { priority: 70 });
        container.bus.on('views:file_changed', (payload) => onViewsFileChanged(container, payload), { priority: 50 });
        // Política offline computada — é o que o Service Worker precisa e não pode
        // ler (ele não enxerga JSDoc nem package.json).
        container.app.get('/_logos/offline', (_req, res) => {
            res.set('Cache-Control', 'no-store').json((0, offline_1.buildOfflineManifest)(container));
        });
        // Servido na RAIZ porque o escopo de um Service Worker é limitado pelo
        // caminho de onde ele é servido: em /logos-sw.js o escopo é `/` e cobre
        // /view/<pkg>/<page> e as rotas dos pacotes. `no-cache` porque o browser
        // precisa revalidar para enxergar uma política nova.
        container.app.get('/logos-sw.js', (_req, res) => {
            res.set('Content-Type', 'application/javascript')
                .set('Cache-Control', 'no-cache')
                .set('Service-Worker-Allowed', '/')
                .send((0, offline_1.serviceWorkerScript)((0, offline_1.buildOfflineManifest)(container)));
        });
        // bootstrap({ views: { index } }) — serve a page (or redirect) at /
        const index = container.config?.views?.index;
        if (index) {
            container.app.get('/', async (req, res) => {
                // Packages can claim the homepage through the closed `views:index`
                // pipeline.  The configured index remains the default and handlers
                // only affect this request when they explicitly return `redirect`.
                const resolved = await container.bus.pipeline('views:index', { index, req });
                if (isHomepageRedirect(resolved?.redirect)) {
                    return res.redirect(resolved.redirect);
                }
                const target = resolved?.index || index;
                if (typeof target === 'string')
                    return res.redirect(target);
                return renderPage(container, target.package, target.page, { ...req.query }, res);
            });
            container.log(`[views] index mounted at / → ${typeof index === 'string' ? index : `${index.package}/${index.page}`}`);
        }
    },
};
// ── Public helpers (exported from src/index.ts) ─────────────────────────────
function setViewsGlobalData(container, data) {
    container.state('views').set('globalData', data && typeof data === 'object' ? data : {});
}
function getViewsGlobalData(container) {
    return globalData(container);
}
function setViewsTheme(container, theme) {
    getEngine(container).setTheme(theme);
    // Theme lives in each rendered page — push a live reload everywhere.
    (0, ws_1.getHub)(container).broadcast({ type: 'views:hmr', components: [], all: true });
}
/**
 * Toggles the Tailwind v4 CDN runtime at runtime. Combine freely with
 * setViewsTheme() — the same theme variables feed Tailwind's `@theme` block
 * once this is on.
 */
function setViewsTailwind(container, enabled) {
    getEngine(container).setTailwind(enabled);
    (0, ws_1.getHub)(container).broadcast({ type: 'views:hmr', components: [], all: true });
}
function rebuildWidgetRegistry(container) {
    getEngine(container).buildWidgetRegistry(container.workspace);
    (0, ws_1.getHub)(container).broadcast({ type: 'views:hmr', components: [], all: true });
}
function getWidgetComponentPath(container) {
    return getEngine(container).widgetComponentPath;
}
/** Serial warmup keeps cold builds from competing with one another. */
async function prewarmViews(container) {
    const failed = [];
    if (container.config?.views?.enabled === false)
        return { ready: true, failed };
    for (const target of container.config?.views?.warmup ?? []) {
        const viewsDir = path_1.default.join(container.workspace, target.package, 'views');
        // Optional packages are not installed in every tenant.
        if (!fs_1.default.existsSync(viewsDir))
            continue;
        const view = resolveViewSource(viewsDir, target.page, true);
        if (!view) {
            failed.push(`${target.package}/${target.page}`);
            continue;
        }
        try {
            await getEngine(container).prewarm(view.sourcePath, `${target.package}__${target.page}${view.public ? '__public' : ''}`, container.workspace);
        }
        catch (error) {
            failed.push(`${target.package}/${target.page}`);
            container.log(`[views:warmup] ${target.package}/${target.page}: ${error.message}`);
        }
    }
    return { ready: failed.length === 0, failed };
}
//# sourceMappingURL=index.js.map
