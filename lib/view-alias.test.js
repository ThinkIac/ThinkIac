import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { normalizeViewAlias } from './view-alias.js';

test('alias reaches authorization and routing as the canonical view, preserving query', async () => {
  const app = express();
  app.use(normalizeViewAlias);
  app.use((req, res, next) => {
    if (req.path === '/view/private/Index' && !req.headers.authorization) return res.sendStatus(401);
    next();
  });
  app.get('/view/:pkg/:page', (req, res) => res.json({ path: req.path, originalUrl: req.originalUrl }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/view/private/Index', '/v/private/Index']) {
      assert.equal((await fetch(base + path)).status, 401);
      const response = await fetch(`${base}${path}?x=1`, { headers: { authorization: 'test' } });
      assert.deepEqual(await response.json(), { path: '/view/private/Index', originalUrl: '/view/private/Index?x=1' });
    }
    assert.equal((await fetch(base + '/vicious/private/Index')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
