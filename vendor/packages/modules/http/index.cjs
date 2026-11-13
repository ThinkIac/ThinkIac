'use strict';

// HTTP is a capability module.  The host supplies framework-neutral ports and
// lifecycle primitives; this package owns Express routers, route declarations
// and the public-route registry.
const path = require('node:path');
const multer = require('multer');
const { performance } = require('node:perf_hooks');

const normalize = value => {
  const result = String(value || '').split('?')[0] || '/';
  return result.length > 1 ? result.replace(/\/+$/, '') : result;
};
const matcher = template => new RegExp(`^${normalize(template).split('/').map(part => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/')}$`);

function upload(config) {
  if (!config) return null;
  const found = String(config.size || '').toLowerCase().match(/(\d+)(kb|mb|gb)/);
  const amount = found ? Number(found[1]) * ({ kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[found[2]]) : 10 * 1024 ** 2;
  const storage = config.storage === 'memory' ? multer.memoryStorage() : multer.diskStorage({
    destination: path.join(process.cwd(), 'uploads'),
    filename: (_req, file, done) => done(null, `${Date.now()}-${file.originalname}`),
  });
  const instance = multer({ storage, limits: { fileSize: amount } });
  return config.quantity === 1 ? instance.single(config.field) : instance.array(config.field, config.quantity);
}

function createRuntimeModule(host) {
  const { express, app, scanRoutes, isolatedRunner, createContext, loadMiddlewareSnapshot, resolveMiddlewares, runMiddlewares, routeMountPath, recordOfflineRoutes, measurePhase, recordPhase, setPerformanceRoute, runAsPackage } = host.http;
  const routers = host.state('routers');
  const state = host.state('http');

  function mount() {
    let value = state.get('mount');
    if (!value) { value = express.Router(); state.set('mount', value); app().use('/', value); }
    return value;
  }
  function router(pkg) {
    if (!routers.has(pkg)) { const value = express.Router(); routers.set(pkg, value); mount().use('/', value); }
    return routers.get(pkg);
  }
  function replacePublic(pkg, routes) {
    const all = state.get('publicRoutes') || new Map();
    all.set(pkg, routes.filter(route => route.public === true).map(route => ({
      method: String(route.method || 'get').toLowerCase(), matcher: matcher(routeMountPath(pkg, route.path)),
    })));
    state.set('publicRoutes', all);
  }
  function isPublic(requestPath, requestMethod = 'GET') {
    const method = String(requestMethod).toLowerCase(); const target = normalize(requestPath);
    for (const routes of (state.get('publicRoutes') || new Map()).values()) if (routes.some(route => route.method === method && route.matcher.test(target))) return true;
    return false;
  }
  async function routesFor(pkg) {
    const isolated = isolatedRunner(pkg.folder);
    return isolated?.surfaces?.routes.map(route => ({ ...route, handler: (req, _res, _next, context) => isolated.invoke(route.id, [{ body: req.body, rawBody: req.rawBody, query: req.query, params: req.params, headers: req.headers, method: req.method, path: req.path }], context) })) || scanRoutes(pkg.folder);
  }
  async function mountPackage(pkg, target) {
    let routes; try { routes = await routesFor(pkg); } catch { return []; }
    const destination = target || router(pkg.folder); const snapshot = await loadMiddlewareSnapshot(pkg.folder); const mounted = [];
    for (const raw of routes) {
      const decision = await host.pipeline('route:registering', { pkg: pkg.folder, route: raw });
      const route = decision?.route || raw; if (decision?.skip) continue;
      const handlers = []; const body = upload(route.upload); if (body) handlers.push(body);
      const credentials = host.state('credential').get('buildGuard'); if (route.credentialRequired && credentials) handlers.push(credentials(pkg.folder));
      handlers.push(async (req, res, next) => runAsPackage(pkg.folder, async () => {
        setPerformanceRoute(req, routeMountPath(pkg.folder, route.path));
        const context = createContext({ req, res, pkg }); host.emit('http:request', { pkg: pkg.folder, path: route.path, method: route.method });
        try {
          const middleware = await measurePhase(req, 'predicates', () => resolveMiddlewares(pkg.folder, context, snapshot));
          await runMiddlewares(middleware, context, async () => {
            if (route.streaming) return measurePhase(req, 'handler', () => route.handler(req, res, next, context));
            const payload = await measurePhase(req, 'handler', () => route.handler(req, res, next, context)); const started = performance.now();
            try { const { status = 200, headers, body, data } = payload && typeof payload === 'object' ? payload : {}; if (headers) for (const [key, value] of Object.entries(headers)) res.setHeader(key, value); if (body !== undefined) return res.status(status).send(body); if (data !== undefined) return res.status(status).json(data); return res.status(200).json(payload); }
            finally { recordPhase(req, 'serialize', started); }
          });
        } catch (error) { next(error); }
      }));
      destination[route.method](routeMountPath(pkg.folder, route.path), ...handlers); mounted.push(route);
    }
    if (!target) { recordOfflineRoutes(pkg.folder, mounted); replacePublic(pkg.folder, mounted); }
    return mounted;
  }
  const api = { getPackageMount: mount, getOrCreateRouter: router, clearRouter(pkg) { const value = routers.get(pkg); if (value) value.stack = []; (state.get('publicRoutes') || new Map()).delete(pkg); }, isRegisteredPublicRoute: isPublic, mountPackageRoutes: mountPackage, replaceRegisteredPublicRoutes: replacePublic };
  return { name: 'http', phase: 'wire', after: ['env', 'credential'], api, install() { mount(); const publicDir = host.config()?.http?.public; if (publicDir) app().use(require('express').static(path.isAbsolute(publicDir) ? publicDir : path.resolve(path.dirname(process.cwd()), publicDir))); host.on('package:wiring', ({ pkg }) => mountPackage(pkg), { priority: 50 }); } };
}
module.exports = { createRuntimeModule };
