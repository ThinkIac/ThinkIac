// tests/newpackage.test.ts — um pacote criado com o runtime JÁ DE PÉ tem que
// funcionar na hora, sem restart.
//
// Três regressões distintas moram aqui, e as três davam o mesmo sintoma
// ("criei o pacote e nada acontece até reiniciar"):
//
//   1. o router do pacote entrava na stack do Express DEPOIS do 404 catch-all,
//      então a rota existia mas nunca era alcançada;
//   2. a detecção olhava o package.json no instante do `addDir` — como a pasta
//      nasce antes do manifesto, o pacote nunca era detectado;
//   3. a lista de tools do MCP era um snapshot do boot.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { bootstrap } from '../src/index';
import { scanCache } from '../src/kernel/scan';
import { makeWorkspace, FixtureWorkspace } from './helpers';

let ws: FixtureWorkspace;
const running: any[] = [];

beforeEach(() => { ws = makeWorkspace(); scanCache.clear(); });
afterEach(async () => {
  for (const instance of running.splice(0)) await instance.close();
  ws.cleanup();
});

const port = () => 35000 + Math.floor(Math.random() * 2000);

/** Espera até `check` passar (ou estourar o prazo) — o watcher é assíncrono. */
async function until<T>(check: () => Promise<T | null>, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch { /* ainda não */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout esperando o pacote novo entrar em serviço');
}

const routeSource = (folder: string) => [
  '/**',
  ' * @register_router ping',
  ' * @method GET',
  ' */',
  `exports.ping = function ping() { return { pong: '${folder}' }; };`,
].join('\n');

async function boot(options: any = {}) {
  // Pelo menos um pacote no boot: é o cenário real (workspace populado) e
  // garante que o mount dos pacotes já existe antes da cauda 404.
  ws.pkg('seed', { 'package.json': JSON.stringify({ name: 'seed' }), 'routes.js': routeSource('seed') });
  const p = port();
  const instance = await bootstrap({ workspace: ws.root, port: p, views: { enabled: false }, ...options });
  running.push(instance);
  await instance.stabilizer.workspaceReady;
  return { instance, base: `http://127.0.0.1:${p}` };
}

describe('pacote criado com o runtime de pé', () => {
  it('mostra uma tela recuperável para uma view de pacote ainda não descoberto', async () => {
    const { base } = await boot({ views: { enabled: true } });

    const missing = await fetch(`${base}/view/lateview/Widget`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('text/html');
    const page = await missing.text();
    expect(page).toContain('Esta página não está disponível.');
    expect(page).toContain('Parece que não há nada por aqui.');
    expect(page).toContain('const maxAttempts = 3;');
    expect(page).toContain('void recover();');
    expect(page).not.toContain('package.json was not found.');

    const ordinary404 = await fetch(`${base}/missing-api`);
    expect(ordinary404.headers.get('content-type')).toContain('application/json');
    await expect(ordinary404.json()).resolves.toMatchObject({ error: 'Not found', path: '/missing-api' });

    const absent = await fetch(`${base}/_logos/view-recovery`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/view/lateview/Widget' }),
    });
    expect(absent.status).toBe(404);
    await expect(absent.json()).resolves.toMatchObject({ ok: false, error: 'package.json was not found.' });
  });

  it('recupera somente o pacote pedido por uma view ausente', async () => {
    const { instance, base } = await boot({ views: { enabled: true } });
    ws.pkg('lateview', {
      'package.json': JSON.stringify({ name: 'lateview' }),
      // A request do teste não tem sessão; .public mantém o teste focado na
      // recuperação, não no gate de autenticação das views.
      'views/Widget.public.svelte': '<h1>Recovered view</h1>',
    });

    const retry = await fetch(`${base}/_logos/view-recovery`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/view/lateview/Widget' }),
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ ok: true, redirect: '/view/lateview/Widget', package: 'lateview' });
    expect(instance.container.registry.getState('lateview')?.state).toBe('active');

    const restored = await fetch(`${base}/view/lateview/Widget`);
    expect(restored.status).toBe(200);
    await expect(restored.text()).resolves.toContain('Recovered view');
  });

  it('responde na rota nova sem restart', async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/seed/ping`)).status).toBe(200);

    ws.pkg('novo', { 'package.json': JSON.stringify({ name: 'novo' }), 'routes.js': routeSource('novo') });

    const body = await until(async () => {
      const res = await fetch(`${base}/novo/ping`);
      return res.status === 200 ? await res.json() : null;
    });
    expect(body).toEqual({ pong: 'novo' });
  });

  it('é detectado mesmo quando a pasta nasce antes do package.json', async () => {
    const { base } = await boot();

    // Exatamente o que create_runtime_package faz: mkdir primeiro, manifesto
    // depois. O `addDir` chega com a pasta ainda vazia.
    const dir = path.join(ws.root, 'tardio');
    fs.mkdirSync(dir);
    await new Promise(r => setTimeout(r, 400));
    fs.writeFileSync(path.join(dir, 'routes.js'), routeSource('tardio'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'tardio' }));

    const body = await until(async () => {
      const res = await fetch(`${base}/tardio/ping`);
      return res.status === 200 ? await res.json() : null;
    });
    expect(body).toEqual({ pong: 'tardio' });
  });

  it('publica as tools do pacote novo no MCP sem restart', async () => {
    const { instance } = await boot();
    const namesBefore = (await instance.mcp.listTools()).map((t: any) => t.name);
    expect(namesBefore).not.toContain('saudar');

    ws.pkg('comtool', {
      'package.json': JSON.stringify({ name: 'comtool' }),
      'tools.js': [
        '/**',
        ' * @register_tool saudar',
        ' * @description diz oi',
        ' */',
        "exports.saudar = function saudar() { return 'oi'; };",
      ].join('\n'),
    });

    await until(async () => {
      const names = (await instance.mcp.listTools()).map((t: any) => t.name);
      return names.includes('saudar') ? names : null;
    });
    expect(await instance.mcp.callTool('saudar', {})).toBe('oi');
  });

  it('marca o pacote novo como active no registry', async () => {
    const { instance } = await boot();
    ws.pkg('estado', { 'package.json': JSON.stringify({ name: 'estado' }), 'routes.js': routeSource('estado') });

    const state = await until(async () => {
      const s = instance.container.registry.getState('estado');
      return s?.state === 'active' ? s : null;
    });
    expect(state.state).toBe('active');
  });

  it('descobre e ativa pacote novo quando hot reload está desligado', async () => {
    const { base } = await boot({ hotReload: { enabled: false } });

    ws.pkg('producao', {
      'package.json': JSON.stringify({ name: 'producao' }),
      'routes.js': routeSource('producao'),
    });

    const body = await until(async () => {
      const res = await fetch(`${base}/producao/ping`);
      return res.status === 200 ? await res.json() : null;
    });
    expect(body).toEqual({ pong: 'producao' });
  });

  it('recupera um pacote novo pela ativação explícita se o watcher perder o evento', async () => {
    const { instance, base } = await boot();

    // Simula o único fallback que um criador de pacote precisa: os arquivos já
    // existem, mas nenhum evento do filesystem chegou ao watcher.
    ws.pkg('recuperado', {
      'package.json': JSON.stringify({ name: 'recuperado' }),
      'routes.js': routeSource('recuperado'),
    });

    const activate = instance.container.state('runtime').get('activatePackage');
    await expect(activate('recuperado', 'creator')).resolves.toMatchObject({
      ok: true,
      pkg: 'recuperado',
      state: 'active',
    });
    expect((await fetch(`${base}/recuperado/ping`)).status).toBe(200);
  });
});
