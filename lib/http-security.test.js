import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import cors from 'cors';
import express from 'express';
import { corsOptions, setSecurityHeaders } from './http-security.js';
import { normalizeViewAlias } from './view-alias.js';

test('CORS requires explicit serialized HTTP origins', () => {
  assert.equal(corsOptions(), false);
  assert.equal(corsOptions(' , '), false);
  for (const origin of ['*', 'null', 'file://', 'https://portal.example/path', 'https://*.example']) {
    assert.throws(() => corsOptions(origin), /exact HTTP/);
  }
});

test('HTTP preflight, login views and package pages receive the intended policies', async t => {
  const app = express();
  const portal = 'https://portal.example';
  app.use(cors(corsOptions(portal + ', http://localhost:5173')));
  app.use(normalizeViewAlias, setSecurityHeaders);
  app.use((_req, res) => res.send('OK'));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;

  for (const origin of [portal, 'http://localhost:5173', 'https://portal.example.invalid', 'null']) {
    const response = await fetch(base + '/auth/login', { method: 'OPTIONS', headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin === portal || origin === 'http://localhost:5173' ? origin : null);
    assert.match(response.headers.get('Vary'), /Origin/);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  }

  for (const path of ['/view/auth/Login', '/v/auth/Login?erro=example', '/view/auth/%4Cogin/']) {
    const response = await fetch(base + path);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Content-Security-Policy'), /object-src 'none'/);
  }

  const otherView = await fetch(base + '/view/shell/Index');
  assert.equal(otherView.headers.get('Content-Security-Policy'), null);
  assert.equal(otherView.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
});
