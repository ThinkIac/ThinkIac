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

import express from 'express';
import { performance } from 'perf_hooks';
import { measurePhase, recordPhase, setPerformanceRoute } from '../kernel/http-performance';
import multer from 'multer';
import path from 'path';
import { Container, LogosModule } from '../kernel/container';
import { registerRoutes as scanRoutes } from '../kernel/scan';
import { createRuntimeContext } from '../kernel/context';
import { loadMiddlewareSnapshot, resolveMiddlewares, runMiddlewares } from '../kernel/middleware';
import { routeMountPath } from '../kernel/utils';
import { recordOfflineRoutes } from './views/offline';
import { runAsPackage } from '../kernel/authority-context';
import { getIsolatedRunner } from '../core/isolated/bridge';

// ── Upload middleware (v1 parity) ───────────────────────────────────────────

function parseSize(size: string): number {
  const match = String(size).toLowerCase().match(/(\d+)(kb|mb|gb)/);
  if (!match) return 10 * 1024 * 1024;
  const value = Number(match[1]);
  if (match[2] === 'kb') return value * 1024;
  if (match[2] === 'mb') return value * 1024 * 1024;
  return value * 1024 * 1024 * 1024;
}

export function buildUploadMiddleware(config: any) {
  if (!config) return null;
  const limits = { fileSize: parseSize(config.size) };
  const storage = config.storage === 'memory'
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: path.join(process.cwd(), 'uploads'),
        filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
      });
  const upload = multer({ storage, limits });
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
export function getPackageMount(container: Container): any {
  const state = container.state('http');
  let mount = state.get('mount');
  if (!mount) {
    mount = express.Router();
    state.set('mount', mount);
    container.app.use('/', mount);
  }
  return mount;
}

export function getOrCreateRouter(container: Container, pkgFolder: string): any {
  const routers = container.state('routers');
  if (routers.has(pkgFolder)) return routers.get(pkgFolder);
  const router = express.Router();
  routers.set(pkgFolder, router);
  getPackageMount(container).use('/', router); // mounted once; stack swaps on reload
  return router;
}

export function clearRouter(container: Container, pkgFolder: string): void {
  const router = container.state('routers').get(pkgFolder);
  if (router) router.stack = [];
  container.state('http').get('publicRoutes')?.delete(pkgFolder);
}

type PublicRoute = { path: string; method: string; matcher: RegExp };

function normalPath(value: string): string {
  const requestPath = String(value || '').split('?')[0] || '/';
  return requestPath.length > 1 ? requestPath.replace(/\/+$/, '') : requestPath;
}

function compilePathTemplate(template: string): RegExp {
  const segments = normalPath(template).split('/');
  const pattern = segments.map(segment => {
    if (segment.startsWith(':')) return '[^/]+';
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return new RegExp(`^${pattern}$`);
}

/** True only for an already-mounted route explicitly declared with @public. */
export function isRegisteredPublicRoute(container: Container, requestPath: string, requestMethod = 'GET'): boolean {
  const routesByPackage: Map<string, PublicRoute[]> | undefined = container.state('http').get('publicRoutes');
  const method = String(requestMethod || 'GET').toLowerCase();
  const normalized = normalPath(requestPath);
  for (const routes of routesByPackage?.values() ?? []) {
    if (routes.some(route => route.method === method && route.matcher.test(normalized))) return true;
  }
  return false;
}

function replacePublicRoutes(container: Container, pkgFolder: string, routes: any[]): void {
  const routesByPackage: Map<string, PublicRoute[]> = container.state('http').get('publicRoutes') ?? new Map();
  routesByPackage.set(pkgFolder, routes
    .filter(route => route.public === true)
    .map(route => ({ path: routeMountPath(pkgFolder, route.path), method: String(route.method || 'get').toLowerCase(), matcher: compilePathTemplate(routeMountPath(pkgFolder, route.path)) })));
  container.state('http').set('publicRoutes', routesByPackage);
}

// ── Route mounting ──────────────────────────────────────────────────────────
//
// `targetRouter` lets the stabilizer build routes into a GHOST router for
// health checks, then swap stacks — the live router is untouched on failure.

export async function mountPackageRoutes(container: Container, pkg: any, targetRouter?: any): Promise<any[]> {
  let routes: any[] = [];
  const isolated = getIsolatedRunner(container, pkg.folder);
  try {
    routes = isolated?.surfaces?.routes.map(route => ({
      ...route,
      handler: (req: any, _res: any, _next: any, context: any) => isolated.invoke(route.id, [{
        body: req.body, rawBody: req.rawBody, query: req.query, params: req.params, headers: req.headers, method: req.method, path: req.path,
      }], context),
    })) ?? await scanRoutes(pkg.folder);
  } catch { return []; }
  if (!routes.length) return [];

  const router = targetRouter ?? getOrCreateRouter(container, pkg.folder);
  const buildCredentialGuard = container.state('credential').get('buildGuard');
  const mounted: any[] = [];
  // Captured by the router closures: ghost validation cannot alter live middleware.
  const middlewareSnapshot = await loadMiddlewareSnapshot(pkg.folder);

  for (const rawRoute of routes) {
    // Packages may transform or drop routes here.
    const decision = await container.bus.pipeline('route:registering', { pkg: pkg.folder, route: rawRoute });
    if (decision?.skip) continue;
    const route = decision?.route ?? rawRoute;

    const handlers: any[] = [];
    const uploadMw = buildUploadMiddleware(route.upload);
    if (uploadMw) handlers.push(uploadMw);
    if (route.credentialRequired && buildCredentialGuard) handlers.push(buildCredentialGuard(pkg.folder));

    handlers.push(async (req: any, res: any, next: any) => {
      await runAsPackage(container.authority, pkg.folder, async () => {
        setPerformanceRoute(req, routeMountPath(pkg.folder, route.path));
        const context = createRuntimeContext({ req, res, pkg });
        container.bus.emit('http:request', { pkg: pkg.folder, path: route.path, method: route.method });
        try {
          const middlewares = await measurePhase(req, 'predicates', () => resolveMiddlewares(pkg.folder, context, middlewareSnapshot));
          await runMiddlewares(middlewares, context, async () => {
            if (route.streaming) {
              await measurePhase(req, 'handler', () => route.handler(req, res, next, context));
              return;
            }
            const payload = await measurePhase(req, 'handler', () => route.handler(req, res, next, context));
            const serializeStart = performance.now();
            try {
              if (payload && typeof payload === 'object') {
              const { status = 200, headers, body, data } = payload;
              if (headers && typeof headers === 'object') {
                Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v as any));
              }
              if (body !== undefined) { res.status(status).send(body); return; }
              if (data !== undefined) { res.status(status).json(data); return; }
            }
              res.status(200).json(payload);
            } finally { recordPhase(req, 'serialize', serializeStart); }
          });
        } catch (err) { next(err); }
      });
    });

    const mountPath = routeMountPath(pkg.folder, route.path);
    (router as any)[route.method](mountPath, ...handlers);
    mounted.push(route);
    container.log(
      `${pkg.name ?? pkg.folder} registered [${route.method.toUpperCase()}] ${mountPath}` +
      `${route.streaming ? ' [streaming]' : ''}${route.credentialRequired ? ' [credential]' : ''}` +
      `${route.offline === 'cache' ? ' [offline:cache]' : ''}`
    );
  }

  // O que o Service Worker pode cachear sai daqui, do mount real — assim a lista
  // é exatamente o que o Express serve. Só no mount ao vivo: um router ghost do
  // stabilizer pode nunca virar o ativo, e publicar a política de uma versão que
  // não entrou em serviço faria o SW cachear uma rota inexistente.
  if (!targetRouter) {
    recordOfflineRoutes(container, pkg.folder, mounted);
    replacePublicRoutes(container, pkg.folder, mounted);
  }

  return mounted;
}

/** Updates the access registry after a staged router swap has become live. */
export function replaceRegisteredPublicRoutes(container: Container, pkgFolder: string, routes: any[]): void {
  replacePublicRoutes(container, pkgFolder, routes);
}

// ── Module ──────────────────────────────────────────────────────────────────

export const httpModule: LogosModule = {
  name: 'http',
  phase: 'wire',
  after: ['env', 'credential'],
  install(container: Container) {
    // Reserva a posição dos pacotes na stack do app ANTES do 404 (ver
    // getPackageMount): o mount precisa existir mesmo que nenhum pacote tenha
    // rota no boot, senão o primeiro pacote criado em runtime cai atrás da cauda.
    getPackageMount(container);

    // Static /public directory next to /packages (bootstrap: http.public)
    const publicDir = container.config?.http?.public;
    if (publicDir) {
      const resolved = path.isAbsolute(publicDir)
        ? publicDir
        : path.resolve(path.dirname(container.workspace), publicDir);
      container.app.use(express.static(resolved));
      container.log(`[http] serving static "${resolved}" at /`);
    }

    container.bus.on('package:wiring', async (payload: any) => {
      await mountPackageRoutes(container, payload.pkg);
    }, { priority: 50 });
  },
};
