"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SvelteEngine = exports.HOT_RELOAD_MODES = void 0;
exports.isHotReloadMode = isHotReloadMode;
exports.hmrClientScript = hmrClientScript;
exports.filePickerProtocolClientScript = filePickerProtocolClientScript;
const tailwind_styles_1 = require("./tailwind-styles.cjs");
const assets_1 = require("./assets.cjs");
const file_digests_1 = require("./file-digests.cjs");
// modules/views/engine.ts — Svelte SSR + hydration engine, v3.
//
// v3 changes over v2: bundler swapped from Rollup to esbuild. Cold builds
// (first request for a page after a source change) dropped ~11x in
// benchmarks against a real tenant workspace (45 pages: 195.8s -> 16.4s
// total) — esbuild's native, Go-parallel resolution of node_modules/CJS
// interop is what Rollup's plugin chain (node-resolve + commonjs) paid for
// on every cold build. See packages/logos/spike-esbuild/REPORT.md (git
// history) for the full writeup, including a real esbuild/CJS-interop bug
// found and fixed along the way (a first-party CommonJS `.js` file bundled
// directly — not from node_modules — had its `module.exports=` hoisted to
// the top of the bundle by esbuild, clobbering the component's export; fix
// is to author first-party `views/*.js` helpers as ES modules).
//
// v2 changes over v1:
//   * NO global Module.prototype.require monkey-patch. Svelte 4 pinning is
//     done entirely inside the bundle graph via an esbuild resolve plugin —
//     the rest of the process is free to use any Svelte it wants.
//   * The build cache is keyed to the WHOLE import graph. After each build we
//     persist the graph's file hashes in a manifest; a change in ANY
//     imported component invalidates the page (fixes the v1 bug where editing
//     a component under Home never showed up).
//   * Theme layer: Bootstrap 5 (CDN, opt-out) and/or Tailwind CSS v4 (CDN,
//     opt-in) + CSS variables from bootstrap({ views: { theme } }) — mutable
//     at runtime via setViewsTheme() / setViewsTailwind().
//   * HMR client: every rendered page opens a WS to /ws and reloads when the
//     runtime broadcasts { type: 'views:hmr' } for one of its source files.
//
// Tailwind support: rather than a build step, we use the official browser
// runtime build (`@tailwindcss/browser`) — the CDN successor to the old
// "Play CDN". It scans the rendered HTML for utility classes and compiles
// them client-side. The same `views.theme` map that feeds the Bootstrap
// `:root` variables is reused: when Tailwind is on, those variables are
// emitted inside a Tailwind v4 `@theme { ... }` block instead, so they also
// generate real utilities (e.g. `--color-primary` → `bg-primary`,
// `text-primary`, `border-primary`), not just custom properties.
'use strict';
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const utils_1 = { ensureDir: (dir) => fs_1.default.mkdirSync(dir, { recursive: true }) };
const CACHE_DIR = path_1.default.join(process.cwd(), '.svelte-cache');
const VIEW_MANIFEST_FORMAT = 4;
const TAILWIND_CDN_URL = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4';
function requireDep(name) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(name);
    }
    catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            throw new Error(`[views] "${name}" not installed. Run: npm install svelte esbuild esbuild-svelte`);
        }
        throw err;
    }
}
exports.HOT_RELOAD_MODES = ['always', 'auto', 'prompt', 'manual'];
function isHotReloadMode(value) {
    return exports.HOT_RELOAD_MODES.indexOf(value) !== -1;
}
/**
 * O cliente de hot-reload injetado em toda página renderizada.
 *
 * Em qualquer modo ele expõe `window.LogosHMR` ({ mode, pending, reload() })
 * e dispara `logos:views-changed` no documento, para que a aplicação possa
 * desenhar a própria UI de "há uma atualização" em vez da barra embutida.
 */
function hmrClientScript(componentName, options) {
    return `<script>
(function () {
  var component = ${JSON.stringify(componentName)};
  var mode = ${JSON.stringify(options.mode)};
  var badge = ${options.badge ? 'true' : 'false'};
  try {
    var override = new URLSearchParams(location.search).get('hmr');
    if (override === 'always' || override === 'auto' || override === 'prompt' || override === 'manual') mode = override;
  } catch (_) {}

  var holds = {};
  var dirty = false;
  var lastActivity = Date.now();
  var timer = null;
  var AUTO_IDLE_MS = 1500;
  var AUTO_MAX_MS = 5000;
  var pendingSince = 0;
  function noteActivity() { lastActivity = Date.now(); if (api.pending) scheduleAutoApply(); }
  function hasFocusedEditor() {
    var el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }
  function isSafe() {
    return document.visibilityState === 'visible' && !dirty && !hasFocusedEditor() && Object.keys(holds).length === 0;
  }
  function restoreableState() {
    return { scrollX: window.scrollX || 0, scrollY: window.scrollY || 0 };
  }
  function reload() {
    try { sessionStorage.setItem('__logos_hmr_restore__', JSON.stringify(restoreableState())); } catch (_) {}
    location.reload();
  }
  var api = {
    mode: mode, pending: false, changes: [], reload: reload,
    hold: function (reason) { holds[String(reason || 'anonymous')] = true; scheduleAutoApply(); },
    release: function (reason) { delete holds[String(reason || 'anonymous')]; scheduleAutoApply(); },
    markDirty: function () { dirty = true; scheduleAutoApply(); },
    clearDirty: function () { dirty = false; scheduleAutoApply(); },
    isHeld: function () { return Object.keys(holds).length > 0; },
  };
  window.LogosHMR = api;

  try {
    var saved = JSON.parse(sessionStorage.getItem('__logos_hmr_restore__') || 'null');
    sessionStorage.removeItem('__logos_hmr_restore__');
    if (saved) window.addEventListener('load', function () { window.scrollTo(saved.scrollX || 0, saved.scrollY || 0); }, { once: true });
  } catch (_) {}

  function reloadIframe() {
    // Uma view dentro de iframe é uma fronteira natural: só ela perde estado.
    if (!isEmbedded()) return false;
    try { window.location.reload(); return true; } catch (_) { return false; }
  }
  function scheduleAutoApply() {
    if (mode !== 'auto' || !api.pending) return;
    if (timer) clearTimeout(timer);
    var elapsed = Date.now() - pendingSince;
    var wait = Math.max(0, Math.min(AUTO_IDLE_MS, AUTO_MAX_MS - elapsed));
    timer = setTimeout(function attempt() {
      if (!api.pending) return;
      if (reloadIframe()) return;
      if (isSafe() && (Date.now() - lastActivity >= AUTO_IDLE_MS || Date.now() - pendingSince >= AUTO_MAX_MS)) reload();
      else scheduleAutoApply();
    }, wait || 50);
  }
  ['pointerdown', 'keydown', 'input', 'focusin', 'change'].forEach(function (event) { document.addEventListener(event, noteActivity, true); });
  document.addEventListener('visibilitychange', scheduleAutoApply);

  function isEmbedded() {
    // Dentro de iframe o badge fica por conta da página top-level — que
    // também recebe este script — para a atualização aparecer uma vez só.
    try { return window.self !== window.top; } catch (_) { return true; }
  }

  function showBadge() {
    if (!badge || isEmbedded() || document.getElementById('logos-hmr-badge')) return;
    var el = document.createElement('button');
    el.id = 'logos-hmr-badge';
    el.type = 'button';
    el.textContent = '\\u21bb Update available';
    el.setAttribute('style', [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'padding:10px 16px', 'border:0', 'border-radius:999px',
      'font:600 13px/1 system-ui,sans-serif', 'color:#fff', 'background:#2563eb',
      'box-shadow:0 4px 16px rgba(0,0,0,.28)', 'cursor:pointer',
    ].join(';'));
    el.onclick = function () { api.reload(); };
    (document.body || document.documentElement).appendChild(el);
  }

  function onChanged(msg) {
    api.pending = true;
    pendingSince = pendingSince || Date.now();
    if (msg && msg.files) api.changes = api.changes.concat(msg.files);
    try {
      document.dispatchEvent(new CustomEvent('logos:views-changed', {
        detail: { component: component, mode: mode, pkg: msg && msg.pkg, files: (msg && msg.files) || [] },
      }));
    } catch (_) {}
    if (mode === 'always') return api.reload();
    if (mode === 'auto') return scheduleAutoApply();
    if (mode === 'prompt') showBadge();
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var ws = new WebSocket(proto + location.host + '/ws?session=views-hmr');
    ws.onmessage = function (e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'views:hmr' &&
            (msg.all || (msg.components || []).indexOf(component) !== -1)) {
          onChanged(msg);
        }
      } catch (_) {}
    };
    ws.onclose = function () {
      // Sem rede não adianta reabrir de 1,5 em 1,5 segundo: era reconexão
      // infinita queimando bateria exatamente no cenário offline. Espera o
      // evento 'online' em vez de insistir no vazio.
      if (navigator.onLine === false) {
        window.addEventListener('online', function once() {
          window.removeEventListener('online', once);
          connect();
        });
        return;
      }
      setTimeout(connect, 1500);
    };
  }
  connect();
})();
</script>`;
}
/**
 * Browser contract for optional file-picker providers.
 *
 * Lógos never imports a package-specific picker. Instead every native file
 * input announces a cancellable request. An installed provider may cancel it
 * and populate the original input; without a provider the browser's picker is
 * left completely untouched. File Manager is one such provider.
 */
function filePickerProtocolClientScript() {
    return `<script>
(function () {
  if (window.LogosFilePicker) return;
  var EVENT = 'logos:file-picker:request';
  function isFileInput(node) {
    return node && node.nodeType === 1 && node.tagName === 'INPUT' &&
      String(node.type || '').toLowerCase() === 'file';
  }
  function request(input, trigger) {
    if (!isFileInput(input) || input.disabled || input.readOnly ||
        input.hasAttribute('data-logos-native-file-picker')) return false;
    var detail = {
      input: input,
      accept: input.accept || '',
      multiple: !!input.multiple,
      root: input.getAttribute('data-logos-file-root') || undefined,
      trigger: trigger || 'api',
    };
    var event = new CustomEvent(EVENT, { bubbles: true, cancelable: true, detail: detail });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }
  window.LogosFilePicker = { event: EVENT, request: request };
  document.addEventListener('click', function (event) {
    var input = event.target;
    if (!isFileInput(input)) return;
    if (request(input, 'click')) event.preventDefault();
  }, true);
})();
</script>`;
}
class SvelteEngine {
    validationIntervalMs;
    cacheDir;
    widgetRegistryPath;
    optionalStubPath;
    widgetComponentPath;
    widgetIndex = {};
    theme = {};
    bootstrap5 = true;
    tailwind = false;
    precompileCss = false;
    tailwindStyles;
    digests = new file_digests_1.FileDigests();
    graphChecks = new Map();
    svelteDir;
    // Builds em voo, por componentName: N requests simultâneos a uma página
    // fria compartilham UM build (esbuild SSR+DOM) em vez de dispararem N em
    // paralelo e saturarem CPU/RAM de um box pequeno (thundering herd).
    inflight = new Map();
    // Módulos SSR já carregados, por caminho do bundle. O nome do arquivo é
    // content-hash, então o caminho identifica o conteúdo unicamente: um
    // rebuild gera outro caminho e nunca colide. Evita reler/recompilar o
    // módulo do disco a cada render (antes: delete require.cache + require).
    ssrModuleCache = new Map();
    // Uma compilação que falhou na validação não deve derrubar a última versão
    // publicada em cada novo request. O próximo save limpa essa marca e tenta a
    // nova candidata de novo.
    failedComponents = new Set();
    // Semáforo de builds: limita esbuild concorrente ao nº de vCPUs para não
    // derrubar VPS fraca quando muitas páginas frias sobem juntas.
    buildSlots;
    buildQueue = [];
    // Validações HMR são promovidas em lote. Um render do mesmo componente
    // aguarda a decisão do lote; componentes alheios continuam livres.
    validationQueue = Promise.resolve();
    validationGates = new Map();
    constructor(cacheDir = CACHE_DIR, validationIntervalMs = 0) {
        this.validationIntervalMs = validationIntervalMs;
        this.cacheDir = cacheDir;
        this.tailwindStyles = new tailwind_styles_1.TailwindStyles(cacheDir);
        (0, utils_1.ensureDir)(this.cacheDir);
        this.widgetRegistryPath = path_1.default.join(this.cacheDir, 'WidgetRegistry.svelte');
        this.widgetComponentPath = path_1.default.join(this.cacheDir, 'Widget.svelte');
        this.optionalStubPath = path_1.default.join(this.cacheDir, 'OptionalMissing.svelte');
        // O runtime pode ser iniciado de outro diretório (por exemplo, a própria
        // pasta do pacote durante os testes). Resolva o Svelte instalado, em vez
        // de assumir que ele está em `cwd/node_modules`.
        this.svelteDir = path_1.default.dirname(require.resolve('svelte/package.json'));
        let cpus = 1;
        try {
            cpus = require('os').cpus().length || 1;
        }
        catch { /* keep 1 */ }
        // Reserve capacity for interactive HTTP; hosts can explicitly raise this limit.
        this.buildSlots = Math.max(1, Math.min(cpus, Number(process.env.LOGOS_VIEW_BUILD_CONCURRENCY) || 2));
    }
    /** Adquire um slot de build; resolve quando houver vaga (limite = vCPUs). */
    acquireBuildSlot() {
        if (this.buildSlots > 0) {
            this.buildSlots--;
            return Promise.resolve();
        }
        return new Promise((resolve) => this.buildQueue.push(resolve));
    }
    releaseBuildSlot() {
        const next = this.buildQueue.shift();
        if (next)
            next();
        else
            this.buildSlots++;
    }
    setTheme(theme, bootstrap5) {
        this.theme = theme && typeof theme === 'object' ? theme : {};
        if (bootstrap5 !== undefined)
            this.bootstrap5 = bootstrap5;
    }
    getTheme() { return { ...this.theme }; }
    setTailwind(enabled, precompileCss = this.precompileCss) {
        this.tailwind = Boolean(enabled);
        this.precompileCss = precompileCss;
    }
    getTailwind() { return this.tailwind; }
    hash(content) {
        return crypto_1.default.createHash('md5').update(content).digest('hex');
    }
    // ── Import-graph manifest ─────────────────────────────────────────────────
    //
    // <component>.manifest.json = { hash, files: { absPath: contentHash } }
    // Valid while every file in the last build's graph still hashes the same.
    manifestPath(componentName) {
        return path_1.default.join(this.cacheDir, `${componentName}.manifest.json`);
    }
    fileHash(file) {
        try {
            return this.hash(fs_1.default.readFileSync(file, 'utf-8'));
        }
        catch {
            return 'gone';
        }
    }
    readManifest(componentName) {
        try {
            return JSON.parse(fs_1.default.readFileSync(this.manifestPath(componentName), 'utf-8'));
        }
        catch {
            return null;
        }
    }
    async manifestValid(manifest) {
        if (!manifest?.files || manifest.format !== VIEW_MANIFEST_FORMAT)
            return false;
        const key = manifest.hash;
        const cached = this.graphChecks.get(key);
        if (cached?.pending)
            return cached.pending;
        if (cached && cached.until > Date.now())
            return cached.valid;
        const entry = { until: 0, valid: false, pending: undefined };
        const pending = this.digests.graph(Object.keys(manifest.files)).then(hashes => {
            const valid = Object.entries(manifest.files).every(([file, hash]) => hashes[file] === hash);
            entry.valid = valid;
            entry.until = Date.now() + this.validationIntervalMs;
            return valid;
        }).finally(() => { entry.pending = undefined; });
        entry.pending = pending;
        if (this.graphChecks.size > 512)
            this.graphChecks.clear();
        this.graphChecks.set(key, entry);
        return pending;
    }
    /** Returns component names whose graphs include `changedFile` (for HMR). */
    affectedComponents(changedFile) {
        this.digests.invalidate(changedFile);
        this.graphChecks.clear();
        const hits = [];
        if (!fs_1.default.existsSync(this.cacheDir))
            return hits;
        for (const entry of fs_1.default.readdirSync(this.cacheDir)) {
            if (!entry.endsWith('.manifest.json'))
                continue;
            try {
                const manifest = JSON.parse(fs_1.default.readFileSync(path_1.default.join(this.cacheDir, entry), 'utf-8'));
                if (manifest.files && manifest.files[changedFile] !== undefined) {
                    hits.push(entry.replace('.manifest.json', ''));
                }
            }
            catch { /* skip broken manifest */ }
        }
        return hits;
    }
    // ── Widget registry (unchanged behaviour, collision-safe) ────────────────
    buildWidgetRegistry(workspace) {
        this.widgetIndex = {};
        const imports = [];
        const mappings = [];
        const nameCollisions = {};
        if (fs_1.default.existsSync(workspace)) {
            for (const pkg of fs_1.default.readdirSync(workspace)) {
                const pkgPath = path_1.default.join(workspace, pkg);
                try {
                    if (!fs_1.default.statSync(pkgPath).isDirectory())
                        continue;
                }
                catch {
                    continue;
                }
                const viewsDir = path_1.default.join(pkgPath, 'views');
                if (!fs_1.default.existsSync(viewsDir))
                    continue;
                let viewEntries;
                try {
                    viewEntries = fs_1.default.readdirSync(viewsDir);
                }
                catch {
                    continue;
                }
                const widgetsDirName = viewEntries.find(d => d.toLowerCase() === 'widgets');
                if (!widgetsDirName)
                    continue;
                const widgetsDir = path_1.default.join(viewsDir, widgetsDirName);
                try {
                    if (!fs_1.default.statSync(widgetsDir).isDirectory())
                        continue;
                }
                catch {
                    continue;
                }
                let widgetFiles;
                try {
                    widgetFiles = fs_1.default.readdirSync(widgetsDir);
                }
                catch {
                    continue;
                }
                for (const file of widgetFiles) {
                    if (!file.endsWith('.svelte') && !file.endsWith('.svx'))
                        continue;
                    const sourcePath = path_1.default.join(widgetsDir, file);
                    // A remoção pode ocorrer durante esta varredura. Nunca grave um
                    // import para algo que já não existe: a próxima reconstrução parte
                    // do disco e fica saudável por si só.
                    try {
                        if (!fs_1.default.statSync(sourcePath).isFile())
                            continue;
                    }
                    catch {
                        continue;
                    }
                    const widgetName = file.replace(/\.(svelte|svx)$/, '');
                    const qualifiedName = `${pkg}__${widgetName}`;
                    const importName = `Widget_${qualifiedName}`.replace(/[^a-zA-Z0-9]/g, '_');
                    const safePath = sourcePath.replace(/\\/g, '/');
                    imports.push(`import ${importName} from '${safePath}';`);
                    mappings.push(`'${qualifiedName}': ${importName}`);
                    (nameCollisions[widgetName] ||= []).push({ pkg, importName, qualifiedName });
                    this.widgetIndex[qualifiedName] = { pkg, widgetName, importName };
                }
            }
        }
        const simpleAliases = [];
        for (const [widgetName, owners] of Object.entries(nameCollisions)) {
            if (owners.length === 1) {
                simpleAliases.push(`'${widgetName}': ${owners[0].importName}`);
                this.widgetIndex[widgetName] = this.widgetIndex[owners[0].qualifiedName];
            }
            else {
                console.warn(`[views] widget name collision: "${widgetName}" in [${owners.map(o => o.pkg).join(', ')}]. ` +
                    `Use the qualified name (e.g. "${owners[0].qualifiedName}").`);
            }
        }
        const registryBody = (extraMsg) => `<script>
  ${imports.join('\n  ')}
  const registry = { ${[...mappings, ...simpleAliases].join(', ')} };
  export let name = '';
  export let filter = '';
  export let max = null;
  $: limit = max ? parseInt(max, 10) : undefined;
  $: widgetKeys = Object.keys(registry)
    .filter(k => { if (k.includes('__')) return false; return filter ? k.toLowerCase().includes(filter.toLowerCase()) : true; })
    .slice(0, limit);
</script>
{#if name}
  {#if registry[name]}
    <svelte:component this={registry[name]} {...$$restProps} />
  {:else}
    <div style="color:red;border:1px dashed red;padding:.5rem;font-family:monospace;font-size:12px;">
      [views] Widget "{name}" not found. ${extraMsg}
    </div>
  {/if}
{:else if filter || max}
  {#each widgetKeys as widgetKey}
    <svelte:component this={registry[widgetKey]} {...$$restProps} />
  {/each}
{:else}
  <div style="color:orange;border:1px dashed orange;padding:.5rem;font-family:monospace;font-size:12px;">
    [views] &lt;Widget&gt; needs <code>name</code>, <code>filter</code> or <code>max</code>.
  </div>
{/if}`;
        fs_1.default.writeFileSync(this.widgetRegistryPath, registryBody('Try the qualified name (pkg__Widget).'));
        fs_1.default.writeFileSync(this.widgetComponentPath, registryBody('Check available widget names.'));
        // Substituto de uma view de outro pacote que não está instalado. Renderiza
        // nada de propósito: o recurso some da tela, em vez de derrubar a página.
        fs_1.default.writeFileSync(this.optionalStubPath, '<!-- pacote opcional ausente -->\n');
    }
    getWidgetIndex() { return { ...this.widgetIndex }; }
    // ── Build ─────────────────────────────────────────────────────────────────
    /**
     * MDSvex preprocessor for `.svx` pages (Markdown + Svelte). Its `markup()`
     * hook no-ops (returns undefined) for files that don't match its configured
     * extension (default `.svx`), so chaining it ahead of the widget-injector
     * preprocessor is safe for plain `.svelte` pages too. Lazily constructed so
     * projects that never use `.svx` never pay for requiring it.
     */
    mdsvexPreprocess() {
        let preprocessor;
        return {
            markup: async (input) => {
                if (!input.filename?.endsWith('.svx'))
                    return undefined;
                if (!preprocessor) {
                    try {
                        // TypeScript compiles import() to require() in CommonJS mode. Use
                        // the native loader explicitly so ESM-only mdsvex releases work
                        // while Lógos keeps its public CommonJS contract.
                        const nativeImport = new Function('specifier', 'return import(specifier)');
                        const mod = await nativeImport('mdsvex');
                        preprocessor = mod.mdsvex();
                    }
                    catch (err) {
                        if (err.code !== 'ERR_MODULE_NOT_FOUND' && err.code !== 'MODULE_NOT_FOUND')
                            throw err;
                        throw new Error('[views] "mdsvex" not installed. Run: npm install mdsvex');
                    }
                }
                return preprocessor.markup(input);
            },
        };
    }
    preprocess() {
        const registryPath = this.widgetRegistryPath;
        const importId = `'svelte-view-engine:registry'`;
        const importStmt = `import Widget from ${importId};`;
        return {
            markup: ({ content, filename }) => {
                if (filename === registryPath)
                    return { code: content };
                if (!content.includes('<Widget'))
                    return { code: content };
                if (content.includes(importId))
                    return { code: content };
                const scriptMatch = content.match(/<script([^>]*)>/);
                if (scriptMatch) {
                    return { code: content.replace(scriptMatch[0], `${scriptMatch[0]}\n  ${importStmt}`) };
                }
                return { code: `<script>\n  ${importStmt}\n</script>\n${content}` };
            },
        };
    }
    // esbuild's onResolve doesn't do Node-style directory-to-index.js
    // resolution on a path we hand it directly, so a subpath that lands on a
    // directory (e.g. modern-layout `svelte/internal`) needs the same
    // treatment require.resolve() would give it.
    resolveSvelteRuntimeSubpath(runtimeDir, subpath) {
        let candidate = path_1.default.join(runtimeDir, subpath);
        if (fs_1.default.existsSync(candidate) && fs_1.default.statSync(candidate).isDirectory()) {
            candidate = path_1.default.join(candidate, 'index.js');
        }
        else if (!fs_1.default.existsSync(candidate) && fs_1.default.existsSync(`${candidate}.js`)) {
            candidate += '.js';
        }
        return candidate;
    }
    plugins(isSSR, workspace) {
        const esbuildSvelte = requireDep('esbuild-svelte');
        const pkgRoot = this.svelteDir.replace(/\\/g, '/');
        // Svelte 3 shipped runtime subpaths (internal/, store/, ...) as physical
        // top-level folders. Svelte 4 moved them under src/runtime/ and only
        // exposes them via package.json "exports" — which this naive path-join
        // alias doesn't consult. Detect the layout instead of assuming v3.
        const isModernLayout = !fs_1.default.existsSync(path_1.default.join(this.svelteDir, 'internal'));
        const runtimeDir = `${pkgRoot}/src`;
        const exportsMap = require(path_1.default.join(pkgRoot, 'package.json')).exports;
        const bareEntry = isModernLayout ? `${runtimeDir}/${isSSR ? 'ssr.js' : 'index.js'}` : pkgRoot;
        const aliasPlugin = {
            name: 'view-engine-aliases',
            setup: (build) => {
                build.onResolve({ filter: /^svelte-view-engine:registry$/ }, () => ({
                    path: this.widgetRegistryPath,
                }));
                build.onResolve({ filter: /^@packages\// }, (args) => ({
                    path: path_1.default.join(workspace, args.path.slice('@packages/'.length)),
                }));
                // Svelte 4 pinning — contained in the bundle graph, no global patch.
                // Views de OUTRO pacote (../../<pkg>/...) são opcionais: cada tenant
                // instala um conjunto próprio de pacotes, e o que está no repositório
                // não é o que está na imagem. Sem isto, um import para um pacote
                // ausente derruba o build da view inteira —
                // "Could not resolve ../../file-manager/views/FilePicker.svelte" — e a
                // tela não abre, embora o recurso faltante seja acessório.
                //
                // Só age quando o arquivo realmente não existe: com o pacote presente,
                // a resolução é a normal e nada muda.
                build.onResolve({ filter: /^\.\.\/\.\.\/[^/]+\/.*\.svelte$/ }, (args) => {
                    const alvo = path_1.default.resolve(args.resolveDir, args.path);
                    if (fs_1.default.existsSync(alvo))
                        return null;
                    console.warn(`[views] pacote opcional ausente, seguindo sem ele: ${args.path}`);
                    return { path: this.optionalStubPath };
                });
                build.onResolve({ filter: /^svelte(?:\/.*)?$/ }, (args) => {
                    const key = args.path === 'svelte' ? '.' : './' + args.path.slice(7);
                    const entry = exportsMap[key];
                    const target = typeof entry === 'string' ? entry : entry && ((!isSSR && entry.browser) || entry.default);
                    if (!target) throw new Error('Unsupported Svelte export: ' + key);
                    return { path: path_1.default.join(pkgRoot, target) };
                });
            },
        };
        return [
            aliasPlugin,
            esbuildSvelte({
                compilerOptions: { generate: isSSR ? 'server' : 'client', css: isSSR ? 'external' : 'injected', compatibility: { componentApi: 4 } },
                // mdsvex runs first (markdown+components → Svelte markup for .svx,
                // no-op for .svelte), then the widget-injector runs on the result.
                preprocess: [this.mdsvexPreprocess(), this.preprocess()],
            }),
        ];
    }
    async build(sourcePath, componentName, hash, isSSR, workspace) {
        const esbuild = requireDep('esbuild');
        const ext = isSSR ? 'cjs' : 'mjs';
        const outPath = path_1.default.join(this.cacheDir, `${componentName}.${isSSR ? 'SSR' : 'DOM'}.${hash}.${ext}`);
        if (fs_1.default.existsSync(outPath))
            return { outPath, watchFiles: null };
        const result = await esbuild.build({
            stdin: { contents: isSSR ? `import Component from ${JSON.stringify(sourcePath)}; import { render } from 'svelte/server'; export default { render(props) { const result = render(Component, { props }); return { html: result.body, head: result.head, css: { code: '' } }; } };` : `import Component from ${JSON.stringify(sourcePath)}; import { createClassComponent } from 'svelte/legacy'; export default class LegacyComponent { constructor(options) { return createClassComponent({ component: Component, ...options }); } }`, resolveDir: this.cacheDir, sourcefile: 'svelte-entry.js', loader: 'js' },
            bundle: true,
            ...(isSSR ? { outfile: outPath } : {
                outdir: this.cacheDir, entryNames: path_1.default.basename(outPath, '.mjs'),
                outExtension: { '.js': '.mjs' },
                chunkNames: `${componentName}.${hash}.chunk.[hash]`, splitting: true, minify: true,
            }),
            format: isSSR ? 'cjs' : 'esm',
            // esbuild emits zero-byte chunks for empty dynamic imports. WebKitGTK
            // classifies those responses as text/plain even with a JavaScript header.
            // A module declaration keeps every chunk valid and changes its hash.
            ...(isSSR ? {} : { banner: { js: 'export {};' } }),
            platform: isSSR ? 'node' : 'browser',
            conditions: isSSR ? ['svelte', 'node'] : ['svelte', 'browser'],
            mainFields: ['svelte', 'browser', 'module', 'main'],
            metafile: true,
            write: true,
            legalComments: 'none',
            sourcemap: false,
            logLevel: 'silent',
            plugins: this.plugins(isSSR, workspace),
        });
        if (!isSSR && result.metafile)
            await (0, assets_1.precompressAssets)(Object.keys(result.metafile.outputs).map(file => path_1.default.resolve(file)));
        const watchFiles = result.metafile
            ? Object.keys(result.metafile.inputs).map((f) => path_1.default.resolve(f))
            : [];
        return { outPath, watchFiles };
    }
    evictOldBuilds(componentName, keepHash) {
        for (const entry of fs_1.default.readdirSync(this.cacheDir)) {
            if (entry.startsWith(`${componentName}.`) && !entry.includes(keepHash) && !entry.includes('.chunk.') && /\.(cjs|mjs)$/.test(entry)) {
                const full = path_1.default.join(this.cacheDir, entry);
                this.ssrModuleCache.delete(full);
                try {
                    fs_1.default.unlinkSync(full);
                }
                catch { /* ok */ }
            }
        }
    }
    async ensureBuilt(sourcePath, componentName, workspace) {
        const validation = this.validationGates.get(componentName);
        if (validation) {
            await validation;
            return this.ensureBuilt(sourcePath, componentName, workspace);
        }
        const manifest = this.readManifest(componentName);
        // Fast path: cache válido, sem build — não precisa dedupe nem slot.
        if (manifest && (this.failedComponents.has(componentName) || await this.manifestValid(manifest))) {
            const ssr = path_1.default.join(this.cacheDir, `${componentName}.SSR.${manifest.hash}.cjs`);
            const dom = path_1.default.join(this.cacheDir, `${componentName}.DOM.${manifest.hash}.mjs`);
            if (fs_1.default.existsSync(ssr) && fs_1.default.existsSync(dom))
                return { ssr, dom };
        }
        // Slow path: dedupe por componentName — um único build compartilhado.
        const existing = this.inflight.get(componentName);
        if (existing)
            return existing;
        const built = (async () => {
            await this.acquireBuildSlot();
            try {
                try {
                    return await this.compile(sourcePath, componentName, workspace);
                }
                catch (error) {
                    // Um registry em cache pode apontar para um widget removido entre a
                    // varredura e o build. Refaça-o a partir do disco e tente somente
                    // mais uma vez. Qualquer erro do widget existente continua subindo
                    // normalmente, sem esconder falhas reais de compilação.
                    if (!this.isMissingWidgetRegistryImport(error))
                        throw error;
                    this.buildWidgetRegistry(workspace);
                    return await this.compile(sourcePath, componentName, workspace);
                }
            }
            finally {
                this.releaseBuildSlot();
            }
        })().finally(() => this.inflight.delete(componentName));
        this.inflight.set(componentName, built);
        return built;
    }
    isMissingWidgetRegistryImport(error) {
        const message = error instanceof Error ? error.message : String(error);
        return /WidgetRegistry\.svelte[\s\S]*(Could not resolve|Could not read|ENOENT)|(?:Could not resolve|Could not read|ENOENT)[\s\S]*WidgetRegistry\.svelte/i.test(message);
    }
    async compile(sourcePath, componentName, workspace, promote = true) {
        const registrySource = fs_1.default.existsSync(this.widgetRegistryPath)
            ? fs_1.default.readFileSync(this.widgetRegistryPath, 'utf-8') : '';
        const source = fs_1.default.readFileSync(sourcePath, 'utf-8');
        // O widget registry é GLOBAL: dobrá-lo no hash de toda página fazia
        // instalar/remover um plugin invalidar o cache de TODAS as páginas (o
        // registry muda) — matando o warm-cache em qualquer tenant com pacotes
        // fora do padrão. Só páginas que usam <Widget> dependem do registry.
        const usesWidget = source.includes('<Widget');
        // Content hash seeds the filename; the manifest guards the whole graph.
        // O source da página não muda quando só um filho importado muda. A
        // compilação acontece apenas após manifest inválido; um nonce aqui garante
        // que esbuild não reutilize o bundle do pai com o filho antigo.
        const hash = this.hash(source + (usesWidget ? registrySource : '') + crypto_1.default.randomUUID());
        const ssrBuild = await this.build(sourcePath, componentName, hash, true, workspace);
        const domBuild = await this.build(sourcePath, componentName, hash, false, workspace);
        const graphFiles = new Set([sourcePath, ...(ssrBuild.watchFiles || []), ...(domBuild.watchFiles || [])]);
        // Só páginas com <Widget> ganham o registry no grafo do manifest — assim
        // uma troca de plugin não invalida (via manifestValid) páginas que nem o
        // usam.
        if (usesWidget)
            graphFiles.add(this.widgetRegistryPath);
        const files = await this.digests.graph([...graphFiles]);
        if (promote) {
            fs_1.default.writeFileSync(this.manifestPath(componentName), JSON.stringify({ format: VIEW_MANIFEST_FORMAT, hash, files }, null, 2));
            this.evictOldBuilds(componentName, hash);
        }
        return { ssr: ssrBuild.outPath, dom: domBuild.outPath, hash, files };
    }
    invalidate(componentName) {
        this.graphChecks.clear();
        this.failedComponents.delete(componentName);
        try {
            fs_1.default.unlinkSync(this.manifestPath(componentName));
        }
        catch { /* ok */ }
    }
    /**
     * Compila e renderiza SSR antes de anunciar uma alteração. Em falha, conserva
     * o manifest/bundle anterior para que a página aberta continue saudável.
     */
    async validateComponents(componentNames, workspace) {
        const validation = this.validationQueue.then(() => this.validateComponentsNow(componentNames, workspace), () => this.validateComponentsNow(componentNames, workspace));
        this.validationQueue = validation.catch(() => undefined);
        return validation;
    }
    async validateComponentsNow(componentNames, workspace) {
        this.graphChecks.clear();
        let releaseValidation;
        const gate = new Promise((resolve) => { releaseValidation = resolve; });
        for (const component of componentNames)
            this.validationGates.set(component, gate);
        const previous = new Map();
        const candidates = new Map();
        for (const component of componentNames) {
            const manifest = this.manifestPath(component);
            try {
                previous.set(component, fs_1.default.readFileSync(manifest, 'utf-8'));
            }
            catch {
                previous.set(component, null);
            }
        }
        try {
            for (const component of componentNames) {
                const [pkg, page] = component.split('__');
                const svelte = path_1.default.join(workspace, pkg, 'views', `${page}.svelte`);
                const svx = path_1.default.join(workspace, pkg, 'views', `${page}.svx`);
                const source = fs_1.default.existsSync(svelte) ? svelte : svx;
                if (!fs_1.default.existsSync(source))
                    continue;
                await this.acquireBuildSlot();
                let candidate;
                try {
                    try {
                        candidate = await this.compile(source, component, workspace, false);
                    }
                    catch (error) {
                        if (!this.isMissingWidgetRegistryImport(error))
                            throw error;
                        this.buildWidgetRegistry(workspace);
                        candidate = await this.compile(source, component, workspace, false);
                    }
                }
                finally {
                    this.releaseBuildSlot();
                }
                candidates.set(component, candidate);
                const { ssr } = candidate;
                let mod = this.ssrModuleCache.get(ssr);
                if (!mod) {
                    mod = require(require.resolve(ssr));
                    this.ssrModuleCache.set(ssr, mod);
                }
                const View = mod.default || mod;
                View.render({});
            }
            // A fila é uma transação: nenhum candidato fica visível (nem remove o
            // bundle anterior) antes de todos os componentes compilarem e passarem
            // pela renderização SSR.
            for (const [component, candidate] of candidates) {
                fs_1.default.writeFileSync(this.manifestPath(component), JSON.stringify({ format: VIEW_MANIFEST_FORMAT, hash: candidate.hash, files: candidate.files }, null, 2));
            }
            for (const [component, candidate] of candidates) {
                this.evictOldBuilds(component, candidate.hash);
                this.failedComponents.delete(component);
            }
        }
        catch (err) {
            for (const [component, candidate] of candidates) {
                this.ssrModuleCache.delete(candidate.ssr);
                try {
                    fs_1.default.unlinkSync(candidate.ssr);
                }
                catch { /* ok */ }
                try {
                    fs_1.default.unlinkSync(candidate.dom);
                }
                catch { /* ok */ }
            }
            for (const [component, saved] of previous) {
                const manifest = this.manifestPath(component);
                if (saved === null) {
                    try {
                        fs_1.default.unlinkSync(manifest);
                    }
                    catch { /* ok */ }
                }
                else {
                    fs_1.default.writeFileSync(manifest, saved);
                    this.failedComponents.add(component);
                }
            }
            throw err;
        }
        finally {
            for (const component of componentNames) {
                if (this.validationGates.get(component) === gate)
                    this.validationGates.delete(component);
            }
            this.graphChecks.clear();
            releaseValidation();
        }
    }
    /** Compile assets ahead of the first request without evaluating request-dependent SSR. */
    async prewarm(sourcePath, componentName, workspace) {
        await this.ensureBuilt(sourcePath, componentName, workspace);
        if (this.tailwind && this.precompileCss)
            await this.tailwindStyles.build(this.readManifest(componentName), this.theme, workspace);
    }
    // ── Render ────────────────────────────────────────────────────────────────
    /**
     * Tailwind v4 browser build. Loaded as a plain <script> tag — it scans the
     * rendered document for utility classes and compiles them client-side, no
     * build step required. Doesn't conflict with Bootstrap 5 if both are on;
     * most projects will only enable one of the two.
     */
    tailwindTag(cssFile) {
        if (!this.tailwind)
            return '';
        if (!cssFile)
            return `<script src="${TAILWIND_CDN_URL}"></script>`;
        // Initial CSS is local and ready. Keep dynamic/plugin-generated utilities
        // working through the existing compiler, loaded after the document parses.
        return `<link rel="stylesheet" href="/svelte-cache/${cssFile}">\n<script src="${TAILWIND_CDN_URL}" defer></script>`;
    }
    /**
     * The `views.theme` CSS variables. Plain `:root` custom properties by
     * default; when Tailwind is enabled they're emitted inside a v4
     * `@theme { ... }` block instead, so the exact same config also generates
     * real utility classes (e.g. `--color-primary` → `bg-primary`).
     */
    themeBlock() {
        const vars = Object.entries(this.theme)
            .map(([key, value]) => `  --${key.replace(/^--/, '')}: ${value};`)
            .join('\n');
        if (!vars)
            return '';
        if (this.tailwind) {
            return `<style type="text/tailwindcss">\n@theme {\n${vars}\n}\n</style>`;
        }
        return `<style>:root {\n${vars}\n}</style>`;
    }
    async render(sourcePath, componentName, props = {}, workspace, options = {}) {
        const { ssr, dom } = await this.ensureBuilt(sourcePath, componentName, workspace);
        // Bundle é content-hash no nome: mesmo caminho ⇒ mesmo conteúdo. Carrega
        // uma vez e reusa; um rebuild produz outro caminho e nunca colide, então
        // não há stale. Antes: delete require.cache + require a cada render (relia
        // o arquivo do disco a cada acesso, mesmo com cache quente).
        let SSRModule = this.ssrModuleCache.get(ssr);
        if (!SSRModule) {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            SSRModule = require(require.resolve(ssr));
            this.ssrModuleCache.set(ssr, SSRModule);
        }
        const SvelteSSR = SSRModule.default || SSRModule;
        const { html, css, head } = SvelteSSR.render(props);
        const serverCss = ssr.replace(/\.cjs$/, '.css');
        if (fs_1.default.existsSync(serverCss)) css.code += fs_1.default.readFileSync(serverCss, 'utf8');
        const clientFile = path_1.default.basename(dom);
        const cssFile = this.tailwind && this.precompileCss
            ? await this.tailwindStyles.build(this.readManifest(componentName), this.theme, workspace) : null;
        const bootstrapTags = this.bootstrap5
            ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">\n' +
                '<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" defer></script>'
            : '';
        const hmrClient = hmrClientScript(componentName, {
            mode: options.hotReloadMode ?? 'always',
            badge: options.hotReloadBadge !== false,
        });
        const filePickerProtocol = filePickerProtocolClientScript();
        const clientScripts = (options.clientScripts ?? []).filter(script => typeof script === 'string' && script.length > 0);
        return [
            '<!DOCTYPE html>',
            '<html>',
            '<head>',
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
            head,
            this.tailwindTag(cssFile),
            bootstrapTags,
            this.themeBlock(),
            // --- Suas novas injeções ---
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">',
            '<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>',
            '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">',
            // ---------------------------
            `<title>${componentName}</title>`,
            `<style>body { margin: 0; padding: 0; } ${css.code}</style>`,
            '</head>',
            '<body>',
            `<div id="app">${html}</div>`,
            '<script type="module">',
            `import Component from '/svelte-cache/${clientFile}';`,
            "new Component({ target: document.getElementById('app'), hydrate: true, props: " + JSON.stringify(props) + ' });',
            '</script>',
            filePickerProtocol,
            hmrClient,
            ...clientScripts,
            options.offlineClient ?? '',
            '</body>',
            '</html>',
        ].join('\n');
    }
}
exports.SvelteEngine = SvelteEngine;
//# sourceMappingURL=engine.js.map