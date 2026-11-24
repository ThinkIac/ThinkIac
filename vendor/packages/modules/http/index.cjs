'use strict';

// HTTP is a capability module.  The host supplies framework-neutral ports and
// lifecycle primitives; this package owns Express routers, route declarations
// and the public-route registry.
const path = require('node:path');
const http = require('node:http');
const express = require('express');
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

/** Only a clean package-view URL can opt into the recovery UI. */
function missingViewTarget(requestPath) {
  const pathOnly = String(requestPath || '').split('?')[0];
  const match = pathOnly.match(/^\/view\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9_-]+)?\/?$/);
  return match ? { pkg: match[1], path: pathOnly } : null;
}

function missingViewPage(target) {
  // target is derived by missingViewTarget, whose grammar excludes HTML-significant characters.
  const pathJson = JSON.stringify(target.path).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página indisponível</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap');
    [data-theme="dark"] { --tk-bg:#111111; --tk-surface:#181818; --tk-border:rgba(255,255,255,.09); --tk-border-hi:rgba(255,255,255,.16); --tk-text:#f5f5f5; --tk-muted:#888888; --tk-accent:#f5f5f5; --tk-on-accent:#111111; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; }
    [data-theme="light"] { --tk-bg:#ffffff; --tk-surface:#f5f5f5; --tk-border:rgba(0,0,0,.10); --tk-border-hi:rgba(0,0,0,.18); --tk-text:#1a1a1a; --tk-muted:#666666; --tk-accent:#111111; --tk-on-accent:#ffffff; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; }
    * { box-sizing:border-box; } body { margin:0; min-height:100dvh; background:var(--tk-bg); color:var(--tk-text); font-family:var(--tk-font); }
    header { height:64px; display:flex; align-items:center; padding:0 clamp(20px, 5vw, 56px); border-bottom:1px solid var(--tk-border); } .brand { color:var(--tk-text); font-size:15px; font-weight:500; letter-spacing:-.03em; }
    main { width:min(100% - 40px, 520px); min-height:calc(100dvh - 64px); display:flex; flex-direction:column; justify-content:center; padding:80px 0; } .mark { width:34px; height:34px; display:grid; place-items:center; margin-bottom:28px; border:1px solid var(--tk-border-hi); border-radius:50%; color:var(--tk-muted); } .mark svg { width:17px; fill:none; stroke:currentColor; stroke-width:1.5; }
    h1 { margin:0; font-size:clamp(1.7rem, 5vw, 2.3rem); font-weight:400; letter-spacing:-.045em; } p { margin:14px 0 0; color:var(--tk-muted); font-size:14px; line-height:1.6; } .actions { display:flex; align-items:center; gap:14px; margin-top:30px; } button { min-height:42px; padding:0 16px; border:0; border-radius:var(--tk-radius-md); background:var(--tk-accent); color:var(--tk-on-accent); cursor:pointer; font:500 13px/1 var(--tk-font); transition:opacity 220ms ease-out,transform 220ms ease-out; } button:hover:not(:disabled) { opacity:.86; transform:translateY(-1px); } button:disabled { cursor:wait; opacity:.55; } #status { min-height:1.6em; margin:0; font-size:13px; } .attempts { color:var(--tk-muted); font-size:11px; } .final #status { color:var(--tk-text); font-size:15px; } .final .attempts { display:none; }
    @media (prefers-reduced-motion:reduce) { button { transition:none; } }
  </style>
</head>
<body>
  <header><span class="brand">ThinkIac</span></header>
  <main aria-labelledby="title">
    <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 7v5m0 4h.01M5.1 19h13.8a1.8 1.8 0 0 0 1.56-2.7L13.56 4.4a1.8 1.8 0 0 0-3.12 0L3.54 16.3A1.8 1.8 0 0 0 5.1 19Z"/></svg></div>
    <h1 id="title">Esta página não está disponível.</h1>
    <p>Vamos tentar encontrá-la novamente.</p>
    <div class="actions"><button type="button" id="retry">Tentar novamente</button><span class="attempts" id="attempts"></span></div>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script>
    (() => {
      const path = ${pathJson};
      const button = document.getElementById('retry');
      const status = document.getElementById('status');
      const attempts = document.getElementById('attempts');
      const maxAttempts = 3;
      let count = 0;
      try { document.documentElement.dataset.theme = localStorage.getItem('agent:theme') === 'light' ? 'light' : 'dark'; } catch (_) {}
      async function recover() {
        count += 1;
        button.disabled = true;
        status.textContent = 'Procurando a página…';
        attempts.textContent = count < maxAttempts ? count + ' de ' + maxAttempts : '';
        try {
          const response = await fetch('/_logos/view-recovery', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ path }) });
          const result = await response.json();
          if (response.ok && result.ok) return location.assign(result.redirect);
        } catch (_) {
          // O estado de ausência é intencionalmente neutro: não revelar detalhes internos.
        }
        if (count >= maxAttempts) {
          document.querySelector('main').classList.add('final');
          button.remove();
          status.textContent = 'Parece que não há nada por aqui.';
          return;
        }
        status.textContent = 'Ainda não foi possível abrir esta página.';
        button.disabled = false;
      }
      button.addEventListener('click', recover);
      // A primeira abertura de um pacote que acabou de ser criado não deve
      // exigir uma interação extra. A recuperação continua limitada e o botão
      // permanece disponível para novas tentativas caso a ativação falhe.
      void recover();
    })();
  </script>
</body>
</html>`;
}

function createRuntimeModule(host) {
  const { app, scanRoutes, isolatedRunner, createContext, loadMiddlewareSnapshot, resolveMiddlewares, runMiddlewares, routeMountPath, recordOfflineRoutes, runAsPackage } = host.http;
  const { HttpPerformance, measurePhase, recordPhase, setPerformanceRoute } = require('./performance.cjs');
  const routers = host.state('routers');
  const state = host.state('http');

  function createApplication() {
    if (state.has('application')) return state.get('application');
    const config = host.config();
    const application = express();
    const instrumentation = config.http?.performance === false ? null : new HttpPerformance();
    state.set('performance', instrumentation);
    if (instrumentation) application.use(instrumentation.middleware);
    // Integrações assinadas (por exemplo, Meta Webhooks) precisam verificar os
    // bytes recebidos, não uma nova serialização de req.body. O conteúdo segue
    // não sendo logado e continua disponível normalmente em req.body.
    application.use(express.json({
      limit: '50mb',
      verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); },
    }));
    application.use(express.urlencoded({ extended: true, limit: '50mb' }));

    if (config.cors) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const cors = require('cors');
        application.use(cors(typeof config.cors === 'object' ? config.cors : undefined));
      } catch {
        console.warn('[logos] cors requested but "cors" is not installed — skipping');
      }
    }
    for (const mw of config.middleware || []) application.use((req, res, next) => {
      const start = performance.now();
      let ended = false;
      const finish = () => { if (!ended) { ended = true; recordPhase(req, 'globalMiddleware', start); } };
      res.once('finish', finish);
      res.once('close', finish);
      const proceed = (err) => { finish(); res.removeListener('finish', finish); res.removeListener('close', finish); next(err); };
      try { Promise.resolve(mw(req, res, proceed)).catch(proceed); } catch (error) { proceed(error); }
    });

    // Protected by the same global gate as existing debug endpoints.
    application.get('/__debug/performance', (_req, res) => res.set('Cache-Control', 'no-store').json({
      ...(state.get('performance')?.snapshot() ?? { enabled: false }), workers: host.state('runtime').get('workers')?.snapshot() ?? { enabled: false },
    }));

    // Debug + health endpoints (v1 parity).
    application.get('/__debug/errors', (_req, res) => res.json(host.http.getErrors()));
    application.get('/__ready', (_req, res) => {
      const readiness = host.state('views').get('readiness') ?? { ready: host.state('runtime').get('ready') === true };
      res.status(readiness.ready ? 200 : 503).set('Cache-Control', 'no-store').json(readiness);
    });
    application.get('/__health', (_req, res) => res.json({
      ok: true, runtime: 'logos', packages: host.http.packageSnapshot(),
    }));

    state.set('application', application);
    host.http.setApp?.(application);
    return application;
  }
  function createServer() {
    if (!state.has('server')) state.set('server', http.createServer(createApplication()));
    host.http.setServer?.(state.get('server'));
    return state.get('server');
  }

  function finalizeApplication(getActivation) {
    if (state.get('finalized')) return;
    const application = createApplication();
    // A view can belong to a package created after boot. Give only those URLs a
    // recovery path; ordinary API and asset 404s retain their JSON contract.
    application.post('/_logos/view-recovery', async (req, res) => {
      const target = missingViewTarget(req.body?.path);
      if (!target) return res.status(400).json({ ok: false, error: 'A valid view address is required.' });
      const activatePackage = getActivation();
      if (!activatePackage) return res.status(503).json({ ok: false, error: 'Package recovery is not ready yet. Please try again.' });
      const result = await activatePackage(target.pkg, 'view-recovery');
      if (!result?.ok) return res.status(404).json({ ok: false, error: result?.error || 'This package could not be restored.' });
      return res.json({ ok: true, redirect: target.path, package: target.pkg, activated: Boolean(result.activated) });
    });

    // 404 + error handler last.
    application.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      const target = missingViewTarget(req.path);
      if (target) return res.status(404).type('html').send(missingViewPage(target));
      return next();
    });
    application.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
    application.use((err, _req, res, next) => {
      // A downstream handler may have completed the response before reporting an
      // asynchronous error. Express cannot write a second response in that case.
      if (res.headersSent) return next(err);
      res.status(err.status || 500).json({ error: err.message || 'Internal error' });
    });

    state.set('finalized', true);
  }

  async function listen() {
    const config = host.config();
    const port = config.port === false ? null : (config.port ?? 5040);
    if (port === null) return null;
    const server = createServer();
    if (!server.listening) await new Promise((resolve, reject) => {
      const onError = error => { server.removeListener('listening', onListening); reject(error); };
      const onListening = () => { server.removeListener('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, config.host);
    });
    host.log(`\n⬢ Lógos runtime listening on http://localhost:${port}`);
    return server.address()?.port ?? port;
  }

  async function close() {
    state.get('performance')?.close();
    const server = state.get('server');
    if (server) await new Promise(resolve => server.close(() => resolve()));
  }

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
  const api = { createApplication, createServer, finalizeApplication, listen, close, getPackageMount: mount, getOrCreateRouter: router, clearRouter(pkg) { const value = routers.get(pkg); if (value) value.stack = []; (state.get('publicRoutes') || new Map()).delete(pkg); }, isRegisteredPublicRoute: isPublic, mountPackageRoutes: mountPackage, replaceRegisteredPublicRoutes: replacePublic };
  return { name: 'http', phase: 'wire', after: ['env', 'credential'], api,
    prepare() { finalizeApplication(() => host.state('runtime').get('activatePackage')); },
    async start() { host.state('runtime').set('port', await listen()); },
    close,
    install() { require('./staging.cjs').installStaging(host, api); createApplication(); mount(); createServer(); const publicDir = host.config()?.http?.public; if (publicDir) app().use(require('express').static(path.isAbsolute(publicDir) ? publicDir : path.resolve(path.dirname(process.cwd()), publicDir))); host.on('package:wiring', ({ pkg }) => mountPackage(pkg), { priority: 50 }); } };
}
module.exports = { createRuntimeModule };

// Compatibility factories resolve their SDK from their own dependency graph.
module.exports.createHost = (...args) => requireCapabilityDependency('@thinkiac/module-runtime-compat', '../runtime-compat').createHost(...args);

function requireCapabilityDependency(name, local) {
  let entry;
  try { entry = require.resolve(name); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    entry = require.resolve(local);
  }
  return require(entry);
}
