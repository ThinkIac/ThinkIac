import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const logosRoot = path.dirname(require.resolve('logos/package.json'));
const engineUrl = pathToFileURL(path.join(logosRoot, 'dist/src/modules/views/engine.js')).href;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewPath = path.join(packageRoot, 'views/index.svelte');
const widgetPath = path.join(packageRoot, 'views/Widget.svelte');

test('renderiza a visão geral sem globais do navegador', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'system-monitor-ssr-'));
    try {
        const engineModule = await import(engineUrl);
        const { SvelteEngine } = engineModule.default ?? engineModule;
        const html = await new SvelteEngine(cacheDir).render(
            viewPath,
            'system_monitor__index_ssr',
            {},
            path.dirname(packageRoot),
        );
        assert.match(html, /CPU/);
        assert.match(html, /REDE/);
        assert.match(html, /aria-label="Abrir detalhes de CPU"/);
    } finally {
        rmSync(cacheDir, { recursive: true, force: true });
    }
});

test('expõe a mesma visão pela entrada compacta do Sidebar', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'system-monitor-widget-ssr-'));
    try {
        const engineModule = await import(engineUrl);
        const { SvelteEngine } = engineModule.default ?? engineModule;
        const html = await new SvelteEngine(cacheDir).render(
            widgetPath,
            'system_monitor__widget_ssr',
            {},
            path.dirname(packageRoot),
        );
        assert.match(html, /CPU/);
        assert.match(html, /REDE/);
    } finally {
        rmSync(cacheDir, { recursive: true, force: true });
    }
});

test('declara a navegação compacta, histórico limitado e hover no gráfico', () => {
    const view = readFileSync(viewPath, 'utf8');
    assert.match(view, /let selectedMode = null/);
    assert.match(view, /\[\.\.\.history, json\]\.slice\(-60\)/);
    assert.match(view, /aria-label="Voltar para visão geral"/);
    assert.match(view, /<title>/);
});

test('pinta a superfície própria do iframe e centraliza os medidores compactos', () => {
    const view = readFileSync(viewPath, 'utf8');
    assert.match(view, /:global\(html\), :global\(body\), :global\(#app\).*background: #111111/);
    assert.match(view, /function onShellContext/);
    assert.match(view, /document\.documentElement\.dataset\.theme = theme/);
    assert.match(view, /\.wrap \{[^}]*background: var\(--tk-bg\)/);
    assert.match(view, /\.row \{[^}]*height: 100%;[^}]*align-items: center/);
    assert.match(view, /\.gauge \{[^}]*margin: -7px -3px;[^}]*padding: 7px 3px/);
    assert.match(view, /\.gauge:hover, \.gauge:focus-visible \{[^}]*color-mix/);
});
