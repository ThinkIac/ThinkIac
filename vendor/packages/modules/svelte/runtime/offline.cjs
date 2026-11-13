// modules/views/offline.ts — reconhecedor de pacotes offline.
//
// Um pacote declara `runtime.offline` no package.json e marca com `@offline
// cache` os GETs cujo conteúdo pode ser servido do cache. Daí saem três coisas:
//
//   GET /_logos/offline   política computada em JSON (introspecção e diagnóstico)
//   GET /logos-sw.js      o Service Worker, com a política embutida no corpo
//   <script> na página    registra o SW, desenha "Offline mode" e oferece reload
//
// Por que a política vai EMBUTIDA no corpo do SW e não é buscada por ele: o
// `fetch` do Service Worker precisa decidir de forma SÍNCRONA se intercepta um
// pedido (respondWith não pode ser chamado depois de um await). Um SW que busca
// a própria política perde essa decisão nos primeiros pedidos após cada start
// frio — justamente quando o aparelho está offline e a página precisa do cache.
// Embutida, a decisão é sempre síncrona; e como o browser troca o SW quando os
// BYTES do script mudam, alterar a política publica o SW novo de graça.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_OFFLINE_POLICY = exports.OFFLINE_MODES = void 0;
exports.resolveOfflinePolicy = resolveOfflinePolicy;
exports.recordOfflineRoutes = recordOfflineRoutes;
exports.getOfflineRoutes = getOfflineRoutes;
exports.routePatternToRegex = routePatternToRegex;
exports.buildOfflineManifest = buildOfflineManifest;
exports.serviceWorkerScript = serviceWorkerScript;
exports.offlineClientScript = offlineClientScript;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const utils_1 = require("./views-bridge.cjs");
exports.OFFLINE_MODES = ['off', 'shell'];
exports.DEFAULT_OFFLINE_POLICY = {
    mode: 'off',
    badge: true,
    views: 'visited',
    reload: 'prompt',
};
function isMode(value) {
    return exports.OFFLINE_MODES.indexOf(value) !== -1;
}
function isReload(value) {
    return value === 'prompt' || value === 'manual';
}
function isViews(value) {
    return value === 'all' || value === 'visited' ||
        (Array.isArray(value) && value.every(v => typeof v === 'string'));
}
/**
 * Precedência, do mais específico ao mais geral:
 *
 *   1. `runtime.offline` do package.json   (o pacote se declara)
 *   2. `views.offline` do bootstrap        (política do runtime)
 *   3. mode 'off'                          (default: nenhum Service Worker)
 *
 * O default é `off` de propósito. Um Service Worker de escopo raiz muda o
 * comportamento de rede do app inteiro; isso não pode acontecer porque alguém
 * esqueceu de desligar.
 */
function resolveOfflinePolicy(container, pkgFolder) {
    const declared = container.registry?.getPackage?.(pkgFolder)?.runtime?.offline;
    const configured = container.config?.views?.offline;
    const merged = { ...exports.DEFAULT_OFFLINE_POLICY };
    for (const source of [configured, declared]) {
        if (!source || typeof source !== 'object')
            continue;
        if (isMode(source.mode))
            merged.mode = source.mode;
        if (typeof source.badge === 'boolean')
            merged.badge = source.badge;
        if (isViews(source.views))
            merged.views = source.views;
        if (isReload(source.reload))
            merged.reload = source.reload;
    }
    return merged;
}
// ── Rotas cacheáveis ────────────────────────────────────────────────────────
//
// O http module grava aqui, no mount, os caminhos já montados das rotas que
// declararam `@offline cache`. Ler daqui (em vez de reescanear o pacote) mantém
// UMA fonte: o que o SW cacheia é exatamente o que o Express serve.
const OFFLINE_STATE = 'offline';
function recordOfflineRoutes(container, pkgFolder, routes) {
    const paths = routes
        .filter(r => r?.offline === 'cache')
        .map(r => (0, utils_1.routeMountPath)(pkgFolder, r.path));
    container.state(OFFLINE_STATE).set(pkgFolder, paths);
}
function getOfflineRoutes(container, pkgFolder) {
    return container.state(OFFLINE_STATE).get(pkgFolder) || [];
}
/**
 * `/lectio/api/documents/:id/blocks` → `^/lectio/api/documents/[^/]+/blocks$`
 *
 * A conversão acontece aqui, no servidor, e não no Service Worker: o formato
 * Express é conhecido de um lado só, e duplicar a tradução no cliente cria duas
 * gramáticas para divergir.
 */
function routePatternToRegex(mountPath) {
    const body = mountPath
        .split('/')
        .map(segment => segment.startsWith(':')
        ? '[^/]+'
        : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('/');
    return `^${body}$`;
}
// ── Manifesto ───────────────────────────────────────────────────────────────
/** Views de primeiro nível do pacote (widgets/ e lib/ não são páginas). */
function listViewPages(pkgDir) {
    const viewsDir = path_1.default.join(pkgDir, 'views');
    if (!fs_1.default.existsSync(viewsDir))
        return [];
    return fs_1.default.readdirSync(viewsDir, { withFileTypes: true })
        .filter(e => e.isFile() && /\.(svelte|svx)$/i.test(e.name))
        .map(e => e.name.replace(/\.(svelte|svx)$/i, ''));
}
function viewUrls(pkgDir, folder, views) {
    if (views === 'visited')
        return [];
    const pages = views === 'all' ? listViewPages(pkgDir) : views;
    return pages.map(page => `/view/${folder}/${page}`);
}
function buildOfflineManifest(container) {
    const packages = {};
    for (const pkg of container.registry?.discover?.() ?? []) {
        const policy = resolveOfflinePolicy(container, pkg.folder);
        if (policy.mode === 'off')
            continue;
        packages[pkg.folder] = {
            mode: policy.mode,
            badge: policy.badge,
            reload: policy.reload,
            views: viewUrls(pkg.dir, pkg.folder, policy.views),
            cache: getOfflineRoutes(container, pkg.folder).map(routePatternToRegex),
        };
    }
    // A página montada em `/` só entra se pertencer a um pacote offline.
    const configured = container.config?.views?.index;
    const indexPkg = configured && typeof configured === 'object' ? configured.package : null;
    const index = indexPkg && packages[indexPkg] ? '/' : null;
    const version = crypto_1.default.createHash('md5')
        .update(JSON.stringify({ packages, index }))
        .digest('hex')
        .slice(0, 12);
    return { version, index, packages };
}
// ── Service Worker ──────────────────────────────────────────────────────────
/**
 * O SW é gerado com o manifesto embutido. Trocar a política troca os bytes do
 * script, e o browser trata bytes diferentes como versão nova — a atualização
 * do SW sai de graça do mecanismo que já existe.
 */
function serviceWorkerScript(manifest) {
    return `// logos-sw.js — gerado pelo Lógos. Não editar: o corpo carrega a política.
'use strict';

var MANIFEST = ${JSON.stringify(manifest)};
var CACHE_PREFIX = 'logos-offline-';
var CACHE_NAME = CACHE_PREFIX + MANIFEST.version;

// Padrões compilados no escopo do módulo: o fetch decide sem await (ver o
// comentário no topo de offline.ts).
var VIEW_RE = [];
var CACHE_RE = [];
var PRECACHE = [];

Object.keys(MANIFEST.packages).forEach(function (folder) {
  var pkg = MANIFEST.packages[folder];
  VIEW_RE.push(new RegExp('^/view/' + folder + '/[^/]+$'));
  pkg.cache.forEach(function (source) { CACHE_RE.push(new RegExp(source)); });
  pkg.views.forEach(function (url) { PRECACHE.push(url); });
});
if (MANIFEST.index) PRECACHE.push(MANIFEST.index);

function isViewPath(pathname) {
  if (MANIFEST.index && pathname === MANIFEST.index) return true;
  return VIEW_RE.some(function (re) { return re.test(pathname); });
}

function isContentPath(pathname) {
  return CACHE_RE.some(function (re) { return re.test(pathname); });
}

/**
 * Resposta que pode ir para o cache. Só 2xx: guardar um 401 ou um 500 faria o
 * app servir o erro de volta offline como se fosse o conteúdo. E \`no-store\`
 * do servidor é respeitado — é como uma rota diz "isto não se guarda".
 */
function cacheable(res) {
  if (!res || !res.ok || res.type === 'opaque') return false;
  var control = res.headers.get('cache-control') || '';
  return control.indexOf('no-store') === -1;
}

async function cacheFirst(request) {
  var cached = await caches.match(request);
  if (cached) return cached;
  var res = await fetch(request);
  if (cacheable(res)) {
    var cache = await caches.open(CACHE_NAME);
    cache.put(request, res.clone());
  }
  return res;
}

/** Views: com rede a página é sempre a atual; sem rede, a última que funcionou. */
async function networkFirst(request) {
  try {
    var res = await fetch(request);
    if (cacheable(res)) {
      var cache = await caches.open(CACHE_NAME);
      cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    var cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

/** Conteúdo: responde já com o que tem e corrige atrás. */
async function staleWhileRevalidate(request) {
  var cached = await caches.match(request);
  var network = fetch(request).then(function (res) {
    if (cacheable(res)) {
      caches.open(CACHE_NAME).then(function (cache) { cache.put(request, res.clone()); });
    }
    return res;
  }).catch(function (err) {
    if (cached) return cached;
    throw err;
  });
  return cached || network;
}

/**
 * Pré-cacheia a página E os bundles que ela importa. Só o HTML não bastaria: a
 * página monta com \`import '/svelte-cache/<hash>.mjs'\` e sem esse arquivo ela
 * abre offline em branco, que é pior que não abrir.
 */
async function precacheView(cache, url) {
  var res = await fetch(url, { credentials: 'same-origin' });
  if (!cacheable(res)) return;
  var html = await res.clone().text();
  await cache.put(url, res);

  var assets = html.match(/\\/svelte-cache\\/[A-Za-z0-9._-]+/g) || [];
  var unique = assets.filter(function (a, i) { return assets.indexOf(a) === i; });
  await Promise.allSettled(unique.map(function (a) { return cache.add(a); }));
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE_NAME);
    // allSettled: uma view que falha não pode abortar a instalação inteira e
    // deixar o pacote sem NENHUM cache.
    await Promise.allSettled(PRECACHE.map(function (url) { return precacheView(cache, url); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (key) {
      // Versão nova limpa as antigas — SW preso em precache velho é o modo de
      // falha clássico desse tipo de recurso.
      if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) return caches.delete(key);
      return null;
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;

  // Fora do alcance, sempre: o WebSocket do HMR e do terminal, o próprio SW e a
  // rota de introspecção (que precisa dizer a verdade sobre a rede).
  if (url.pathname === '/logos-sw.js' || url.pathname === '/_logos/offline') return;
  if (url.pathname === '/ws' || url.pathname.indexOf('/ws/') === 0) return;

  // Bundle é content-hash no nome: mesmo nome ⇒ mesmo conteúdo, então cache
  // primeiro nunca serve nada velho.
  if (url.pathname.indexOf('/svelte-cache/') === 0) return event.respondWith(cacheFirst(request));

  if (isViewPath(url.pathname)) return event.respondWith(networkFirst(request));
  if (isContentPath(url.pathname)) return event.respondWith(staleWhileRevalidate(request));

  // Não declarado, não interceptado. Silêncio nunca vira promessa.
});

self.addEventListener('message', function (event) {
  var data = event.data || {};

  // "O build mudou enquanto eu estava offline?" — comparar o HTML servido com o
  // que está em cache responde isso para a página em que o usuário está, que é
  // a pergunta que o botão de recarregar precisa responder.
  if (data.type === 'logos-offline:check') {
    event.waitUntil((async function () {
      var changed = false;
      try {
        var fresh = await fetch(data.url, { cache: 'no-store', credentials: 'same-origin' });
        if (cacheable(fresh)) {
          var cached = await caches.match(data.url);
          if (cached) changed = (await cached.text()) !== (await fresh.clone().text());
          var cache = await caches.open(CACHE_NAME);
          await cache.put(data.url, fresh);
        }
      } catch (_) { changed = false; }
      (event.source ? [event.source] : await self.clients.matchAll()).forEach(function (client) {
        client.postMessage({ type: 'logos-offline:checked', changed: changed });
      });
    })());
  }

  // Purga explícita. Conteúdo autenticado servido do cache continua legível
  // depois do logout se ninguém apagar — quem sabe que houve logout é o app.
  if (data.type === 'logos-offline:purge') {
    event.waitUntil((async function () {
      var keys = await caches.keys();
      await Promise.all(keys
        .filter(function (key) { return key.indexOf(CACHE_PREFIX) === 0; })
        .map(function (key) { return caches.delete(key); }));
    })());
  }
});
`;
}
// ── Cliente injetado na página ──────────────────────────────────────────────
/**
 * Registra o SW e desenha o estado da rede.
 *
 * O badge cinza "Offline mode" é novo; o azul "↻ Update available" é o mesmo do
 * hot-reload, reusado de propósito — dois botões de recarregar desenhados
 * diferente é pior que um.
 */
function offlineClientScript(policy) {
    return `<script>
(function () {
  if (!('serviceWorker' in navigator)) return;

  var badge = ${policy.badge ? 'true' : 'false'};
  var reloadMode = ${JSON.stringify(policy.reload)};
  var api = {
    online: navigator.onLine,
    mode: ${JSON.stringify(policy.mode)},
    reload: function () { location.reload(); },
    purge: function () {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'logos-offline:purge' });
      }
    },
  };
  window.LogosOffline = api;

  function isEmbedded() {
    // Dentro de iframe o badge fica por conta da página top-level, para o aviso
    // aparecer uma vez só.
    try { return window.self !== window.top; } catch (_) { return true; }
  }

  function pill(id, text, background) {
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('button');
    el.id = id;
    el.type = 'button';
    el.textContent = text;
    el.setAttribute('style', [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'padding:10px 16px', 'border:0', 'border-radius:999px',
      'font:600 13px/1 system-ui,sans-serif', 'color:#fff', 'background:' + background,
      'box-shadow:0 4px 16px rgba(0,0,0,.28)', 'cursor:default',
    ].join(';'));
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function remove(id) {
    var el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showOffline() {
    if (!badge || isEmbedded()) return;
    pill('logos-offline-badge', '\\u25cf Offline mode', '#6b7280');
  }

  // SW novo não cria UI global: a navegação/HMR automática converge em uma
  // fronteira segura, sem o antigo botão azul.
  function showUpdate() {}

  function emit(online) {
    try {
      document.dispatchEvent(new CustomEvent('logos:offline-changed', { detail: { online: online } }));
    } catch (_) {}
  }

  function goOffline() {
    api.online = false;
    showOffline();
    emit(false);
  }

  function goOnline() {
    api.online = true;
    remove('logos-offline-badge');
    emit(true);
    // Só oferece recarregar se o servidor tiver mesmo algo diferente: botão que
    // aparece sem nada novo atrás ensina o usuário a ignorá-lo.
    if (reloadMode !== 'prompt') return;
    if (!navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: 'logos-offline:check',
      url: location.href,
    });
  }

  navigator.serviceWorker.addEventListener('message', function (event) {
    var data = event.data || {};
    if (data.type === 'logos-offline:checked' && data.changed) showUpdate();
  });

  window.addEventListener('offline', goOffline);
  window.addEventListener('online', goOnline);

  navigator.serviceWorker.register('/logos-sw.js', { scope: '/' }).catch(function (err) {
    console.warn('[logos:offline] service worker não registrou:', err);
  });

  if (!navigator.onLine) goOffline();
})();
</script>`;
}
//# sourceMappingURL=offline.js.map