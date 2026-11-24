import { afterEach, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { makeWorkspace } from './helpers';
import { Container } from '../src/kernel/container';
import { externalApi, installExternalModules } from '../src/kernel/external-modules';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture(config: any = {}) {
  const container = new Container({ workspace: '/tmp/logos-http-module', port: 0, host: '127.0.0.1', http: { performance: false }, ...config });
  installExternalModules(container, config.externalModules ?? ['http']);
  const api = externalApi<any>(container, 'http');
  const app = api.createApplication();
  container.app = app;
  await container.installPhase('wire');
  const server = api.createServer();
  cleanup.push(async () => {
    const hub = container.state('ws').get('hub');
    if (hub?.wss) {
      for (const socket of hub.wss.clients) socket.terminate();
      await new Promise<void>(resolve => hub.wss.close(() => resolve()));
    }
    await api.close();
  });
  await api.listen();
  const send = (path: string, body?: string, contentType = 'application/json') => new Promise<any>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: (server.address() as any).port, path,
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': contentType } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: res.headers['content-type']?.includes('application/json') ? JSON.parse(text) : text }));
    });
    req.on('error', reject);
    req.end(body);
  });
  return { container, api, app, server, send };
}

describe('external HTTP application lifecycle', () => {
  it('creates one application/server and retains health and readiness responses', async () => {
    const { container, api, app, server, send } = await fixture();
    expect(api.createApplication()).toBe(app);
    expect(api.createServer()).toBe(server);
    expect((await send('/__health')).body).toMatchObject({ ok: true, runtime: 'logos' });
    expect((await send('/__ready')).status).toBe(503);
    container.state('views').set('readiness', { ready: true });
    const ready = await send('/__ready');
    expect(ready.status).toBe(200);
    expect(ready.headers['cache-control']).toBe('no-store');
    expect((await send('/__debug/performance')).body).toEqual({ enabled: false, workers: { enabled: false } });
  });

  it('preserves signed JSON bytes, URL-encoded forms, CORS and global middleware order', async () => {
    const { app, send } = await fixture({ cors: true, middleware: [(req: any, _res: any, next: any) => {
      req.body.middleware = 'applied'; next();
    }] });
    app.post('/echo', (req: any, res: any) => res.json({ body: req.body, rawBody: req.rawBody }));
    const raw = '{ "signed": true }';
    const json = await send('/echo', raw);
    expect(json.body).toEqual({ body: { signed: true, middleware: 'applied' }, rawBody: raw });
    expect(json.headers['access-control-allow-origin']).toBe('*');
    const form = await send('/echo', 'field=value', 'application/x-www-form-urlencoded');
    expect(form.body.body).toEqual({ field: 'value', middleware: 'applied' });
  });

  it('preserves JSON 404s, view recovery and the late activation callback', async () => {
    const { api, send } = await fixture();
    let activate: any = null;
    api.finalizeApplication(() => activate);
    api.finalizeApplication(() => { throw new Error('duplicate finalization'); });
    expect(await send('/missing')).toMatchObject({ status: 404, body: { error: 'Not found', path: '/missing' } });
    const view = await send('/view/demo');
    expect(view.status).toBe(404);
    expect(view.body).toContain('Esta página não está disponível.');
    expect((await send('/_logos/view-recovery', JSON.stringify({ path: '/other' }))).status).toBe(400);
    const payload = JSON.stringify({ path: '/view/demo' });
    expect((await send('/_logos/view-recovery', payload)).status).toBe(503);
    activate = async () => ({ ok: false, error: 'unavailable' });
    expect((await send('/_logos/view-recovery', payload)).status).toBe(404);
    activate = async (folder: string, source: string) => {
      expect(folder).toBe('demo'); expect(source).toBe('view-recovery');
      return { ok: true, activated: true };
    };
    expect(await send('/_logos/view-recovery', payload)).toMatchObject({ status: 200,
      body: { ok: true, redirect: '/view/demo', package: 'demo', activated: true } });
  });

  it('keeps error responses after package handlers', async () => {
    const { app, api, send } = await fixture();
    app.get('/error', (_req: any, _res: any, next: any) => next(Object.assign(new Error('example'), { status: 418 })));
    api.finalizeApplication(() => null);
    expect(await send('/error')).toMatchObject({ status: 418, body: { error: 'example' } });
  });

  it('rejects an occupied port without disturbing the existing server', async () => {
    const first = await fixture();
    await expect(fixture({ port: (first.server.address() as any).port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect((await first.send('/__health')).status).toBe(200);
  });

  it('supports no listener and closes repeatedly without retaining a port', async () => {
    const { api, server } = await fixture({ port: false });
    expect(server.listening).toBe(false);
    expect(await api.listen()).toBe(null);
    await api.close();
    await api.close();
  });

  it('installs WebSocket before cold package wiring even when declared before HTTP', async () => {
    const ws = makeWorkspace();
    cleanup.push(async () => ws.cleanup());
    ws.pkg('stream', {
      'package.json': JSON.stringify({ name: 'stream' }),
      'routes.js': `/**
       * @register_router echo
       * @stream
       * @channel echo
       */
      exports.echo = function echo(socket, context, message) { socket.send(JSON.stringify({ type: 'echo', value: message.value })); };`,
    });
    const { container, server } = await fixture({ workspace: ws.root, externalModules: ['websocket-runtime', 'http'] });
    const hub = container.state('ws').get('hub');
    expect(hub.wss).toBeTruthy();
    await container.bus.emit('package:wiring', { pkg: container.registry.getPackage('stream') });
    expect(hub.handlerCount('echo')).toBe(1);
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/ws?session=test-cold-stream`);
    try {
      expect(JSON.parse((await once(client, 'message'))[0].toString()).type).toBe('connected');
      const reply = once(client, 'message');
      client.send(JSON.stringify({ channel: 'echo', value: 42 }));
      expect(JSON.parse((await reply)[0].toString())).toEqual({ type: 'echo', value: 42 });
    } finally {
      client.terminate();
      await container.disposeAllScopes('test_finished');
    }
  });

  it('keeps instrumentation available through the module-owned application', async () => {
    const { api, container, send } = await fixture({ http: { performance: true } });
    expect(container.state('http').get('performance')).toBeTruthy();
    const health = await send('/__health');
    expect(health.headers['x-request-id']).toBeTruthy();
    await api.close();
    await api.close();
  });
});
