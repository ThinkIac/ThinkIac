'use strict';

function smokeDispatch(router, method, url, timeout) {
  return new Promise(resolve => {
    let timer;
    let done = false;
    const finish = status => { if (!done) { done = true; clearTimeout(timer); resolve(status); } };
    const req = { method: method.toUpperCase(), url, originalUrl: url, headers: {}, body: {}, query: {}, params: {} };
    const res = {
      statusCode: 200, headersSent: false,
      setHeader() { return this; }, set() { return this; }, getHeader() {},
      status(code) { this.statusCode = code; return this; },
      json() { finish(this.statusCode); }, send() { finish(this.statusCode); },
      end() { finish(this.statusCode); }, redirect() { finish(302); },
    };
    timer = setTimeout(() => finish(0), timeout); timer.unref?.();
    try { router.handle(req, res, error => finish(error ? 500 : 404)); } catch { finish(500); }
  });
}

function installStaging(host, api) {
  host.on('logos:package:staging', async ({ pkg, checks, artifacts }) => {
    const router = host.http.express.Router();
    let routes;
    try {
      routes = await api.mountPackageRoutes(pkg, router);
      checks.push({ name: 'routes:mount', ok: true, detail: `${routes.length} route(s)` });
    } catch (error) {
      checks.push({ name: 'routes:mount', ok: false, detail: error.message }); throw error;
    }
    const stability = pkg.runtime?.stability || {};
    for (const name of stability.routes || []) {
      const route = routes.find(route => route.path === name) || { method: 'get', path: name };
      const status = await smokeDispatch(router, route.method || 'get', `/${pkg.folder}/${name}`, stability.timeout ?? 10000);
      const ok = status >= 200 && status < 400;
      checks.push({ name: `smoke:${name}`, ok, detail: `status ${status || 'timeout'}` });
      if (!ok) throw new Error(`smoke test "${name}" returned ${status || 'timeout'}`);
    }
    artifacts.set('http', { router, routes });
  });
  host.on('logos:package:swapping', ({ pkg, artifacts }) => {
    const candidate = artifacts.get('http');
    if (!candidate) return;
    api.getOrCreateRouter(pkg.folder).stack = candidate.router.stack;
    api.replaceRegisteredPublicRoutes(pkg.folder, candidate.routes);
  });
  host.on('logos:package:stopping', ({ package: folder }) => api.clearRouter(folder));
}

module.exports = { installStaging };
