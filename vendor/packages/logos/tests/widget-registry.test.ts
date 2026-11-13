// Regressão: o registry global não pode preservar imports de widgets que
// desapareceram do workspace entre duas reconstruções.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SvelteEngine } from '../../modules/svelte';
import { isWidgetPath } from '../src/modules/views';

const temporary: string[] = [];

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('widget registry', () => {
  it('injeta scripts fornecidos por extensões de renderização', async () => {
    const workspace = temp('logos-view-scripts-workspace-');
    const cache = temp('logos-view-scripts-cache-');
    const views = path.join(workspace, 'pkg', 'views');
    fs.mkdirSync(views, { recursive: true });
    fs.writeFileSync(path.join(views, 'Home.svelte'), '<p>view body</p>');

    const html = await new SvelteEngine(cache).render(path.join(views, 'Home.svelte'), 'pkg__Home', {}, workspace, {
      clientScripts: ['<script>window.extensionLoaded = true;</script>'],
    });

    expect(html).toContain('window.extensionLoaded = true');
  });

  it('elimina imports de um pacote apagado na próxima reconstrução', () => {
    const workspace = temp('logos-widgets-workspace-');
    const cache = temp('logos-widgets-cache-');
    const surviving = path.join(workspace, 'surviving', 'views', 'widgets');
    const removed = path.join(workspace, 'removed', 'views', 'widgets');
    fs.mkdirSync(surviving, { recursive: true });
    fs.mkdirSync(removed, { recursive: true });
    fs.writeFileSync(path.join(surviving, 'Live.svelte'), '<p>live</p>');
    fs.writeFileSync(path.join(removed, 'Stale.svelte'), '<p>stale</p>');

    const engine = new SvelteEngine(cache);
    engine.buildWidgetRegistry(workspace);
    expect(fs.readFileSync(engine.widgetRegistryPath, 'utf8')).toContain('Stale.svelte');

    fs.rmSync(path.join(workspace, 'removed'), { recursive: true, force: true });
    engine.buildWidgetRegistry(workspace);

    const registry = fs.readFileSync(engine.widgetRegistryPath, 'utf8');
    expect(registry).toContain('Live.svelte');
    expect(registry).not.toContain('Stale.svelte');
    expect(engine.getWidgetIndex()).not.toHaveProperty('removed__Stale');
  });

  it('reconhece adição e remoção de arquivos e diretórios de widgets, incluindo svx', () => {
    expect(isWidgetPath('/workspace/pkg/views/widgets/Card.svelte')).toBe(true);
    expect(isWidgetPath('/workspace/pkg/views/widgets/Card.svx')).toBe(true);
    expect(isWidgetPath('/workspace/pkg/views/widgets')).toBe(true);
    expect(isWidgetPath('/workspace/pkg/views/Home.svelte')).toBe(false);
  });

  it('reconstrói o registry e repete o build uma vez quando o cache aponta para widget removido', async () => {
    const workspace = temp('logos-widgets-workspace-');
    const cache = temp('logos-widgets-cache-');
    const widgetDir = path.join(workspace, 'pkg', 'views', 'widgets');
    const pageDir = path.join(workspace, 'pkg', 'views');
    fs.mkdirSync(widgetDir, { recursive: true });
    fs.writeFileSync(path.join(widgetDir, 'Live.svelte'), '<p>live widget</p>');
    fs.writeFileSync(path.join(pageDir, 'Home.svelte'), '<Widget name="Live" />');

    const engine = new SvelteEngine(cache);
    engine.buildWidgetRegistry(workspace);
    const healthyRegistry = fs.readFileSync(engine.widgetRegistryPath, 'utf8');
    fs.writeFileSync(
      engine.widgetRegistryPath,
      healthyRegistry.replace('Live.svelte', 'Removed.svelte'),
    );

    const html = await engine.render(path.join(pageDir, 'Home.svelte'), 'pkg__Home', {}, workspace);

    expect(html).toContain('live widget');
    expect(fs.readFileSync(engine.widgetRegistryPath, 'utf8')).toContain('Live.svelte');
    expect(fs.readFileSync(engine.widgetRegistryPath, 'utf8')).not.toContain('Removed.svelte');
  });

  it('não oculta um erro de compilação de widget existente', async () => {
    const workspace = temp('logos-widgets-workspace-');
    const cache = temp('logos-widgets-cache-');
    const widgetDir = path.join(workspace, 'pkg', 'views', 'widgets');
    const pageDir = path.join(workspace, 'pkg', 'views');
    fs.mkdirSync(widgetDir, { recursive: true });
    fs.writeFileSync(path.join(widgetDir, 'Broken.svelte'), '<script>let = ;</script>');
    fs.writeFileSync(path.join(pageDir, 'Home.svelte'), '<Widget name="Broken" />');

    const engine = new SvelteEngine(cache);
    engine.buildWidgetRegistry(workspace);

    await expect(engine.render(path.join(pageDir, 'Home.svelte'), 'pkg__Home', {}, workspace))
      .rejects.toThrow();
    expect(fs.readFileSync(engine.widgetRegistryPath, 'utf8')).toContain('Broken.svelte');
  });
});
