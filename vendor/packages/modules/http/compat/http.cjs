// Legacy public compatibility implementation, owned by module-http.
module.exports = function(require, module, exports, __dirname, __filename, kernel) {
// modules/http.ts — HTTP route registration (wire phase).
//
// One express.Router per package, mounted ONCE; hot-reload/staging swaps the
// router's stack atomically (in-flight requests finish on the old closures).
//
// Packages can change routing behavior through the bus:
//   route:registering   (pipeline) — transform { pkg, route } before mount;
//                        return { skip: true } to drop a route entirely
//   http:request        (emit)     — observe every package request
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpModule = void 0;
exports.buildUploadMiddleware = buildUploadMiddleware;
exports.getPackageMount = getPackageMount;
exports.getOrCreateRouter = getOrCreateRouter;
exports.clearRouter = clearRouter;
exports.isRegisteredPublicRoute = isRegisteredPublicRoute;
exports.mountPackageRoutes = mountPackageRoutes;
exports.replaceRegisteredPublicRoutes = replaceRegisteredPublicRoutes;
const express_1 = __importDefault(require("express"));
const perf_hooks_1 = require("perf_hooks");
const http_performance_1 = require("../kernel/http-performance");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const scan_1 = require("../kernel/scan");
const context_1 = require("../kernel/context");
const middleware_1 = require("../kernel/middleware");
const utils_1 = require("../kernel/utils");
const offline_1 = require("./views/offline");
const authority_context_1 = require("../kernel/authority-context");
const bridge_1 = require("../core/isolated/bridge");
// ── Upload middleware (v1 parity) ───────────────────────────────────────────
function parseSize(size) {
    const match = String(size).toLowerCase().match(/(\d+)(kb|mb|gb)/);
    if (!match)
        return 10 * 1024 * 1024;
    const value = Number(match[1]);
    if (match[2] === 'kb')
        return value * 1024;
    if (match[2] === 'mb')
        return value * 1024 * 1024;
    return value * 1024 * 1024 * 1024;
}
function buildUploadMiddleware(config) {
    if (!config)
        return null;
    const limits = { fileSize: parseSize(config.size) };
    const storage = config.storage === 'memory'
        ? multer_1.default.memoryStorage()
        : multer_1.default.diskStorage({
            destination: path_1.default.join(process.cwd(), 'uploads'),
            filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
        });
    const upload = (0, multer_1.default)({ storage, limits });
    return config.quantity === 1 ? upload.single(config.field) : upload.array(config.field, config.quantity);
}
// ── Router registry ─────────────────────────────────────────────────────────
/**
 * Ponto de montagem de TODO pacote — um router só, preso ao app uma única vez,
 * durante a fase `wire` (antes de bootstrap() instalar o 404 e o error handler).
 *
 * Sem ele, um pacote criado com o runtime já de pé fazia `app.use()` DEPOIS do
 * 404 catch-all: o Express percorre a stack em ordem, então o 404 respondia
 * antes de a rota nova ser alcançada e o pacote parecia morto até um restart.
 * Montando dentro deste router, a posição na stack do app é fixada no boot e
 * qualquer pacote registrado depois entra antes da cauda.
 */
function getPackageMount(container) {
    const state = container.state('http');
    let mount = state.get('mount');
    if (!mount) {
        mount = express_1.default.Router();
        state.set('mount', mount);
        container.app.use('/', mount);
    }
    return mount;
}
function getOrCreateRouter(container, pkgFolder) {
    const routers = container.state('routers');
    if (routers.has(pkgFolder))
        return routers.get(pkgFolder);
    const router = express_1.default.Router();
    routers.set(pkgFolder, router);
    getPackageMount(container).use('/', router); // mounted once; stack swaps on reload
    return router;
}
function clearRouter(container, pkgFolder) {
    const router = container.state('routers').get(pkgFolder);
    if (router)
        router.stack = [];
    container.state('http').get('publicRoutes')?.delete(pkgFolder);
}
function normalPath(value) {
    const requestPath = String(value || '').split('?')[0] || '/';
    return requestPath.length > 1 ? requestPath.replace(/\/+$/, '') : requestPath;
}
function compilePathTemplate(template) {
    const segments = normalPath(template).split('/');
    const pattern = segments.map(segment => {
        if (segment.startsWith(':'))
            return '[^/]+';
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/');
    return new RegExp(`^${pattern}$`);
}
/** True only for an already-mounted route explicitly declared with @public. */
function isRegisteredPublicRoute(container, requestPath, requestMethod = 'GET') {
    const routesByPackage = container.state('http').get('publicRoutes');
    const method = String(requestMethod || 'GET').toLowerCase();
    const normalized = normalPath(requestPath);
    for (const routes of routesByPackage?.values() ?? []) {
        if (routes.some(route => route.method === method && route.matcher.test(normalized)))
            return true;
    }
    return false;
}
function replacePublicRoutes(container, pkgFolder, routes) {
    const routesByPackage = container.state('http').get('publicRoutes') ?? new Map();
    routesByPackage.set(pkgFolder, routes
        .filter(route => route.public === true)
        .map(route => ({ path: (0, utils_1.routeMountPath)(pkgFolder, route.path), method: String(route.method || 'get').toLowerCase(), matcher: compilePathTemplate((0, utils_1.routeMountPath)(pkgFolder, route.path)) })));
    container.state('http').set('publicRoutes', routesByPackage);
}
// ── Route mounting ──────────────────────────────────────────────────────────
//
// `targetRouter` lets the stabilizer build routes into a GHOST router for
// health checks, then swap stacks — the live router is untouched on failure.
async function mountPackageRoutes(container, pkg, targetRouter) {
    let routes = [];
    const isolated = (0, bridge_1.getIsolatedRunner)(container, pkg.folder);
    try {
        routes = isolated?.surfaces?.routes.map(route => ({
            ...route,
            handler: (req, _res, _next, context) => isolated.invoke(route.id, [{
                    body: req.body, rawBody: req.rawBody, query: req.query, params: req.params, headers: req.headers, method: req.method, path: req.path,
                }], context),
        })) ?? await (0, scan_1.registerRoutes)(pkg.folder);
    }
    catch {
        return [];
    }
    if (!routes.length)
        return [];
    const router = targetRouter ?? getOrCreateRouter(container, pkg.folder);
    const buildCredentialGuard = container.state('credential').get('buildGuard');
    const mounted = [];
    // Captured by the router closures: ghost validation cannot alter live middleware.
    const middlewareSnapshot = await (0, middleware_1.loadMiddlewareSnapshot)(pkg.folder);
    for (const rawRoute of routes) {
        // Packages may transform or drop routes here.
        const decision = await container.bus.pipeline('route:registering', { pkg: pkg.folder, route: rawRoute });
        if (decision?.skip)
            continue;
        const route = decision?.route ?? rawRoute;
        const handlers = [];
        const uploadMw = buildUploadMiddleware(route.upload);
        if (uploadMw)
            handlers.push(uploadMw);
        if (route.credentialRequired && buildCredentialGuard)
            handlers.push(buildCredentialGuard(pkg.folder));
        handlers.push(async (req, res, next) => {
            await (0, authority_context_1.runAsPackage)(container.authority, pkg.folder, async () => {
                (0, http_performance_1.setPerformanceRoute)(req, (0, utils_1.routeMountPath)(pkg.folder, route.path));
                const context = (0, context_1.createRuntimeContext)({ req, res, pkg });
                container.bus.emit('http:request', { pkg: pkg.folder, path: route.path, method: route.method });
                try {
                    const middlewares = await (0, http_performance_1.measurePhase)(req, 'predicates', () => (0, middleware_1.resolveMiddlewares)(pkg.folder, context, middlewareSnapshot));
                    await (0, middleware_1.runMiddlewares)(middlewares, context, async () => {
                        if (route.streaming) {
                            await (0, http_performance_1.measurePhase)(req, 'handler', () => route.handler(req, res, next, context));
                            return;
                        }
                        const payload = await (0, http_performance_1.measurePhase)(req, 'handler', () => route.handler(req, res, next, context));
                        const serializeStart = perf_hooks_1.performance.now();
                        try {
                            if (payload && typeof payload === 'object') {
                                const { status = 200, headers, body, data } = payload;
                                if (headers && typeof headers === 'object') {
                                    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
                                }
                                if (body !== undefined) {
                                    res.status(status).send(body);
                                    return;
                                }
                                if (data !== undefined) {
                                    res.status(status).json(data);
                                    return;
                                }
                            }
                            res.status(200).json(payload);
                        }
                        finally {
                            (0, http_performance_1.recordPhase)(req, 'serialize', serializeStart);
                        }
                    });
                }
                catch (err) {
                    next(err);
                }
            });
        });
        const mountPath = (0, utils_1.routeMountPath)(pkg.folder, route.path);
        router[route.method](mountPath, ...handlers);
        mounted.push(route);
        container.log(`${pkg.name ?? pkg.folder} registered [${route.method.toUpperCase()}] ${mountPath}` +
            `${route.streaming ? ' [streaming]' : ''}${route.credentialRequired ? ' [credential]' : ''}` +
            `${route.offline === 'cache' ? ' [offline:cache]' : ''}`);
    }
    // O que o Service Worker pode cachear sai daqui, do mount real — assim a lista
    // é exatamente o que o Express serve. Só no mount ao vivo: um router ghost do
    // stabilizer pode nunca virar o ativo, e publicar a política de uma versão que
    // não entrou em serviço faria o SW cachear uma rota inexistente.
    if (!targetRouter) {
        (0, offline_1.recordOfflineRoutes)(container, pkg.folder, mounted);
        replacePublicRoutes(container, pkg.folder, mounted);
    }
    return mounted;
}
/** Updates the access registry after a staged router swap has become live. */
function replaceRegisteredPublicRoutes(container, pkgFolder, routes) {
    replacePublicRoutes(container, pkgFolder, routes);
}
// ── Module ──────────────────────────────────────────────────────────────────
exports.httpModule = {
    name: 'http',
    phase: 'wire',
    after: ['env', 'credential'],
    install(container) {
        // Reserva a posição dos pacotes na stack do app ANTES do 404 (ver
        // getPackageMount): o mount precisa existir mesmo que nenhum pacote tenha
        // rota no boot, senão o primeiro pacote criado em runtime cai atrás da cauda.
        getPackageMount(container);
        // Static /public directory next to /packages (bootstrap: http.public)
        const publicDir = container.config?.http?.public;
        if (publicDir) {
            const resolved = path_1.default.isAbsolute(publicDir)
                ? publicDir
                : path_1.default.resolve(path_1.default.dirname(container.workspace), publicDir);
            container.app.use(express_1.default.static(resolved));
            container.log(`[http] serving static "${resolved}" at /`);
        }
        container.bus.on('package:wiring', async (payload) => {
            await mountPackageRoutes(container, payload.pkg);
        }, { priority: 50 });
    },
};

};
