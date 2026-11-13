'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { mountPackageViews } = require('../index.cjs');

test('registers views once, preserves auth and query, and serves cache', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'views-routes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'demo');
  fs.mkdirSync(path.join(dir, 'views'), { recursive: true });
  fs.writeFileSync(path.join(root, 'asset.mjs'), 'export default 1');
  const app = express();
  app.use((req, _res, next) => { if (req.headers.authorization) req.user = {}; next(); });
  const state = new Map();
  const container = { workspace: root, config: {}, state: () => state, log() {} };
  let registry = 0, publicUpdates = 0;
  const dependencies = {
    getEngine: () => ({ cacheDir: root, buildWidgetRegistry() { registry++; } }),
    getPackageMount: () => app,
    replacePublicViews() { publicUpdates++; },
    resolveEntryView: (_dir, authenticated) => authenticated ? { page: 'Private' } : { page: 'Public' },
    renderPage: (_container, pkg, page, query, res, authenticated) => res.json({ pkg, page, query, authenticated }),
    staticAssets: express.static,
  };
  const pkg = { dir, folder: 'demo' };
  mountPackageViews(container, pkg, dependencies);
  mountPackageViews(container, pkg, dependencies);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/view/demo?x=1`)).json(), { pkg: 'demo', page: 'Public', query: { x: '1' }, authenticated: false });
  assert.deepEqual(await (await fetch(`${base}/view/demo`, { headers: { authorization: 'test' } })).json(), { pkg: 'demo', page: 'Private', query: {}, authenticated: true });
  assert.equal((await (await fetch(`${base}/view/demo/Other`)).json()).page, 'Other');
  assert.equal((await fetch(`${base}/svelte-cache/asset.mjs`)).status, 200);
  assert.equal(registry, 1);
  assert.equal(publicUpdates, 2);
});
