// tests/hotreload.test.ts — modos de hot-reload das views.
//
// A invariante que importa: uma página só recarrega sozinha se ALGUÉM pediu
// isso explicitamente. O default é `prompt` — mudar um .svelte não pode
// derrubar estado vivo (terminal com socket aberto, formulário preenchido) de
// toda página aberta, que era o efeito do `location.reload()` incondicional.

import { describe, it, expect } from 'vitest';
import { resolveHotReloadMode } from '../src/modules/views';
import { hmrClientScript, isHotReloadMode, HOT_RELOAD_MODES } from '../../modules/svelte';

/** Container mínimo: só o que resolveHotReloadMode consulta. */
function fakeContainer(opts: { pkgManifest?: any; config?: any } = {}) {
  return {
    config: opts.config ?? {},
    registry: { getPackage: () => opts.pkgManifest ?? {} },
  } as any;
}

describe('resolveHotReloadMode', () => {
  it('default é auto — atualiza silenciosamente em uma janela segura', () => {
    expect(resolveHotReloadMode(fakeContainer(), 'terminal')).toBe('auto');
  });

  it('config do bootstrap define a política do runtime', () => {
    const container = fakeContainer({ config: { views: { hotReload: { mode: 'always' } } } });
    expect(resolveHotReloadMode(container, 'qualquer')).toBe('always');
  });

  it('o pacote se declara e ganha da config do runtime', () => {
    const container = fakeContainer({
      config: { views: { hotReload: { mode: 'always' } } },
      pkgManifest: { runtime: { hotReload: { mode: 'manual' } } },
    });
    expect(resolveHotReloadMode(container, 'terminal')).toBe('manual');
  });

  it('?hmr= na URL ganha de todo o resto', () => {
    const container = fakeContainer({
      config: { views: { hotReload: { mode: 'manual' } } },
      pkgManifest: { runtime: { hotReload: { mode: 'manual' } } },
    });
    expect(resolveHotReloadMode(container, 'terminal', { hmr: 'always' })).toBe('always');
  });

  it('valor inválido é ignorado e cai na camada seguinte', () => {
    const container = fakeContainer({ config: { views: { hotReload: { mode: 'always' } } } });
    expect(resolveHotReloadMode(container, 'x', { hmr: 'sim-por-favor' })).toBe('always');
    expect(resolveHotReloadMode(fakeContainer({ pkgManifest: { runtime: { hotReload: { mode: 42 } } } }), 'x'))
      .toBe('auto');
  });

  it('sobrevive a um registry sem o pacote', () => {
    const container = { config: {}, registry: {} } as any;
    expect(resolveHotReloadMode(container, 'fantasma')).toBe('auto');
  });
});

describe('isHotReloadMode', () => {
  it('aceita os quatro modos', () => {
    for (const mode of HOT_RELOAD_MODES) expect(isHotReloadMode(mode)).toBe(true);
    for (const bad of ['ALWAYS', '', null, undefined, 1, {}]) expect(isHotReloadMode(bad)).toBe(false);
  });
});

describe('hmrClientScript', () => {
  it('só chama location.reload() direto no modo always', () => {
    const always = hmrClientScript('pkg__page', { mode: 'always', badge: true });
    expect(always).toContain("mode = \"always\"");
    // Nos outros modos o reload existe, mas atrás do gesto do usuário.
    expect(always).toContain("if (mode === 'always') return api.reload()");
  });

  it('expõe a API e o evento para a aplicação desenhar a própria UI', () => {
    const script = hmrClientScript('pkg__page', { mode: 'prompt', badge: true });
    expect(script).toContain('window.LogosHMR = api');
    expect(script).toContain("'logos:views-changed'");
  });

  it('no modo auto acumula, respeita hold/dirty e aplica sem badge', () => {
    const script = hmrClientScript('pkg__page', { mode: 'auto', badge: false });
    expect(script).toContain("'auto'");
    expect(script).toContain('hold: function');
    expect(script).toContain('markDirty: function');
    expect(script).toContain('scheduleAutoApply');
    expect(script).toContain('if (!badge || isEmbedded()');
  });

  it('badge desligado não injeta o botão flutuante', () => {
    const semBadge = hmrClientScript('pkg__page', { mode: 'prompt', badge: false });
    expect(semBadge).toContain('badge = false');
    expect(semBadge).toContain("if (!badge || isEmbedded() || document.getElementById('logos-hmr-badge')) return");
  });

  it('badge some em iframe (só a página top-level anuncia) e fala inglês', () => {
    const script = hmrClientScript('pkg__page', { mode: 'prompt', badge: true });
    expect(script).toContain('window.self !== window.top');
    expect(script).toContain('Update available');
    expect(script).not.toContain('Atualiza');
  });

  it('o nome do componente entra escapado como JSON', () => {
    expect(hmrClientScript('a"b', { mode: 'manual', badge: false })).toContain('component = "a\\"b"');
  });
});
