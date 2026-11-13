// tests/offline.test.ts — reconhecedor de pacotes offline.
//
// A invariante que importa: um pacote só ganha comportamento offline se ALGUÉM
// declarou isso. Rota sem `@offline` é `online`, pacote sem `runtime.offline` é
// `off`, e caminho não declarado não é interceptado pelo Service Worker.
// Silêncio nunca vira promessa — porque uma promessa de offline que não se
// cumpre corrompe dado, e uma que se cumpre sem ser pedida cacheia conteúdo
// privado que ninguém mandou guardar.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseRoute, parseOffline, OFFLINE_POLICIES } from '../src/kernel/parsers';
import {
  resolveOfflinePolicy, buildOfflineManifest, routePatternToRegex,
  serviceWorkerScript, offlineClientScript, recordOfflineRoutes,
  DEFAULT_OFFLINE_POLICY,
} from '../src/modules/views/offline';

const fn = function handler() {};

// ── Parser ──────────────────────────────────────────────────────────────────

describe('@offline no parser', () => {
  it('rota sem anotação é online — o default é a ausência de promessa', () => {
    expect(parseOffline('@register_router x')).toBe('online');
    expect(parseRoute(fn, '@register_router ping')!.offline).toBe('online');
  });

  it('reconhece os dois valores suportados', () => {
    expect(parseOffline('@offline cache')).toBe('cache');
    expect(parseOffline('@offline online')).toBe('online');
    expect(OFFLINE_POLICIES).toEqual(['cache', 'online']);
  });

  it('chega no objeto da rota junto do resto', () => {
    const route = parseRoute(fn, '@register_router api/documents/:id/blocks\n@method get\n@offline cache');
    expect(route).toMatchObject({ path: 'api/documents/:id/blocks', method: 'get', offline: 'cache' });
  });

  it('valor desconhecido é erro de carregamento, não "online" silencioso', () => {
    expect(() => parseOffline('@offline talvez')).toThrow(/desconhecido/);
    expect(() => parseRoute(fn, '@register_router x\n@offline sim')).toThrow(/desconhecido/);
  });

  it('recusa `queue`: fila sem dedupe no servidor duplica registro no reenvio', () => {
    expect(() => parseOffline('@offline queue')).toThrow(/idempotência/);
  });

  it('recusa `cache` em mutação — servir POST do cache é responder a escrita que não houve', () => {
    expect(() => parseRoute(fn, '@register_router pay\n@method post\n@offline cache')).toThrow(/só vale para GET/);
    expect(() => parseOffline('@offline cache', 'delete')).toThrow(/só vale para GET/);
  });
});

// ── Política do pacote ──────────────────────────────────────────────────────

/** Container mínimo: só o que resolveOfflinePolicy e buildOfflineManifest leem. */
function fakeContainer(opts: { pkgManifest?: any; config?: any; packages?: any[] } = {}) {
  const state = new Map<string, Map<string, any>>();
  return {
    config: opts.config ?? {},
    registry: {
      getPackage: () => opts.pkgManifest ?? {},
      discover: () => opts.packages ?? [],
    },
    state(key: string) {
      if (!state.has(key)) state.set(key, new Map());
      return state.get(key)!;
    },
  } as any;
}

describe('resolveOfflinePolicy', () => {
  it('default é off — um SW de escopo raiz não sobe por esquecimento', () => {
    expect(resolveOfflinePolicy(fakeContainer(), 'lectio')).toEqual(DEFAULT_OFFLINE_POLICY);
    expect(resolveOfflinePolicy(fakeContainer(), 'lectio').mode).toBe('off');
  });

  it('o pacote se declara pelo package.json', () => {
    const container = fakeContainer({
      pkgManifest: { runtime: { offline: { mode: 'shell', views: 'all' } } },
    });
    expect(resolveOfflinePolicy(container, 'lectio')).toMatchObject({ mode: 'shell', views: 'all' });
  });

  it('o pacote ganha da config do runtime', () => {
    const container = fakeContainer({
      config: { views: { offline: { mode: 'shell', badge: true } } },
      pkgManifest: { runtime: { offline: { badge: false } } },
    });
    expect(resolveOfflinePolicy(container, 'x')).toMatchObject({ mode: 'shell', badge: false });
  });

  it('badge:false é o app offline-first — cacheia e fica calado', () => {
    const container = fakeContainer({ pkgManifest: { runtime: { offline: { mode: 'shell', badge: false } } } });
    const policy = resolveOfflinePolicy(container, 'mobile');
    expect(policy.mode).toBe('shell');
    expect(policy.badge).toBe(false);
    expect(offlineClientScript(policy)).toContain('var badge = false');
  });

  it('valor inválido é ignorado e cai na camada anterior', () => {
    const container = fakeContainer({ pkgManifest: { runtime: { offline: { mode: 'talvez', views: 42 } } } });
    expect(resolveOfflinePolicy(container, 'x')).toMatchObject({ mode: 'off', views: 'visited' });
  });
});

// ── Tradução de caminho ─────────────────────────────────────────────────────

describe('routePatternToRegex', () => {
  it('troca :param por um segmento e ancora as duas pontas', () => {
    const source = routePatternToRegex('/lectio/api/documents/:id/blocks');
    expect(source).toBe('^/lectio/api/documents/[^/]+/blocks$');

    const re = new RegExp(source);
    expect(re.test('/lectio/api/documents/abc123/blocks')).toBe(true);
    expect(re.test('/lectio/api/documents/abc123/notes')).toBe(false);
    // Ancorado: não casa prefixo de outra rota.
    expect(re.test('/lectio/api/documents/abc/blocks/extra')).toBe(false);
  });

  it('um :param não atravessa a barra', () => {
    const re = new RegExp(routePatternToRegex('/p/api/:id'));
    expect(re.test('/p/api/1')).toBe(true);
    expect(re.test('/p/api/1/2')).toBe(false);
  });

  it('escapa o que é literal no caminho', () => {
    const re = new RegExp(routePatternToRegex('/p/api/file.json'));
    expect(re.test('/p/api/file.json')).toBe(true);
    expect(re.test('/p/api/fileXjson')).toBe(false);
  });
});

// ── Manifesto ───────────────────────────────────────────────────────────────

function workspaceWithViews(pages: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-offline-'));
  fs.mkdirSync(path.join(dir, 'views', 'widgets'), { recursive: true });
  for (const page of pages) fs.writeFileSync(path.join(dir, 'views', `${page}.svelte`), '<h1>x</h1>');
  // Widget não é página: não pode entrar no precache como se fosse uma rota.
  fs.writeFileSync(path.join(dir, 'views', 'widgets', 'Card.svelte'), '<div/>');
  return dir;
}

describe('buildOfflineManifest', () => {
  it('ignora pacote com mode off', () => {
    const container = fakeContainer({ packages: [{ folder: 'terminal', dir: '/tmp/nope' }] });
    expect(buildOfflineManifest(container).packages).toEqual({});
  });

  it('views:"all" lista as páginas do pacote e deixa widgets de fora', () => {
    const dir = workspaceWithViews(['Index', 'Reader', 'Calibrate']);
    const container = fakeContainer({
      packages: [{ folder: 'lectio', dir }],
      pkgManifest: { runtime: { offline: { mode: 'shell', views: 'all' } } },
    });
    const views = buildOfflineManifest(container).packages.lectio.views;
    expect(views.sort()).toEqual(['/view/lectio/Calibrate', '/view/lectio/Index', '/view/lectio/Reader']);
    expect(views.some(v => v.includes('Card'))).toBe(false);
  });

  it('views:"visited" não pré-cacheia nada — o cache cresce com o uso', () => {
    const dir = workspaceWithViews(['Index']);
    const container = fakeContainer({
      packages: [{ folder: 'lectio', dir }],
      pkgManifest: { runtime: { offline: { mode: 'shell', views: 'visited' } } },
    });
    expect(buildOfflineManifest(container).packages.lectio.views).toEqual([]);
  });

  it('publica só as rotas que declararam cache, já como regex', () => {
    const dir = workspaceWithViews(['Index']);
    const container = fakeContainer({
      packages: [{ folder: 'lectio', dir }],
      pkgManifest: { runtime: { offline: { mode: 'shell' } } },
    });
    recordOfflineRoutes(container, 'lectio', [
      { path: 'api/documents/:id/blocks', offline: 'cache' },
      { path: 'api/sessions', offline: 'online' },
      { path: 'api/notes', offline: undefined },
    ]);
    expect(buildOfflineManifest(container).packages.lectio.cache)
      .toEqual(['^/lectio/api/documents/[^/]+/blocks$']);
  });

  it('a versão muda quando a política muda — é o que troca o SW no browser', () => {
    const dir = workspaceWithViews(['Index']);
    const make = (views: any) => buildOfflineManifest(fakeContainer({
      packages: [{ folder: 'lectio', dir }],
      pkgManifest: { runtime: { offline: { mode: 'shell', views } } },
    })).version;
    expect(make('all')).not.toBe(make('visited'));
    expect(make('all')).toBe(make('all'));
  });
});

// ── Service Worker ──────────────────────────────────────────────────────────

describe('serviceWorkerScript', () => {
  const manifest = {
    version: 'abc123',
    index: null,
    packages: {
      lectio: {
        mode: 'shell' as const, badge: true, reload: 'prompt' as const,
        views: ['/view/lectio/Reader'],
        cache: ['^/lectio/api/documents/[^/]+/blocks$'],
      },
    },
  };

  it('carrega o manifesto embutido — a decisão do fetch precisa ser síncrona', () => {
    const sw = serviceWorkerScript(manifest);
    expect(sw).toContain('var MANIFEST = ');
    expect(sw).toContain('"version":"abc123"');
    expect(sw).toContain('/view/lectio/Reader');
  });

  it('versiona o cache pela versão do manifesto e limpa as outras no activate', () => {
    const sw = serviceWorkerScript(manifest);
    expect(sw).toContain("CACHE_PREFIX + MANIFEST.version");
    expect(sw).toContain('caches.delete(key)');
  });

  it('deixa o WebSocket e o próprio SW fora do alcance', () => {
    const sw = serviceWorkerScript(manifest);
    expect(sw).toContain("url.pathname === '/ws'");
    expect(sw).toContain("url.pathname === '/logos-sw.js'");
    expect(sw).toContain("url.pathname === '/_logos/offline'");
  });

  it('não guarda resposta que não seja 2xx nem resposta marcada no-store', () => {
    const sw = serviceWorkerScript(manifest);
    expect(sw).toContain('if (!res || !res.ok');
    expect(sw).toContain("indexOf('no-store')");
  });

  it('é JavaScript válido', () => {
    // O SW é gerado por template string; um erro de sintaxe aqui só apareceria
    // no browser, em silêncio, com o registro falhando e o offline sumindo.
    expect(() => new Function(serviceWorkerScript(manifest))).not.toThrow();
  });
});

describe('offlineClientScript', () => {
  const policy = { mode: 'shell' as const, badge: true, views: 'all' as const, reload: 'prompt' as const };

  it('desenha "Offline mode" em cinza sem criar badge azul de update', () => {
    const script = offlineClientScript(policy);
    expect(script).toContain('Offline mode');
    expect(script).toContain('#6b7280');
    expect(script).not.toContain('logos-hmr-badge');
    expect(script).not.toContain('#2563eb');
  });

  it('só oferece reload depois de confirmar que o build mudou', () => {
    const script = offlineClientScript(policy);
    expect(script).toContain('logos-offline:check');
    expect(script).toContain('data.changed');
  });

  it('reload:manual não pergunta nada ao voltar a rede', () => {
    const script = offlineClientScript({ ...policy, reload: 'manual' });
    expect(script).toContain('var reloadMode = "manual"');
    expect(script).toContain("if (reloadMode !== 'prompt') return;");
  });

  it('expõe purge — conteúdo autenticado não pode sobreviver ao logout', () => {
    expect(offlineClientScript(policy)).toContain('logos-offline:purge');
  });

  it('é JavaScript válido dentro da tag', () => {
    const body = offlineClientScript(policy).replace(/^<script>/, '').replace(/<\/script>$/, '');
    expect(() => new Function(body)).not.toThrow();
  });
});
