import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap, isPublicRoute } from '../src/index';
import { makeWorkspace } from './helpers';

describe('@public routes', () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

  it('exposes only an explicitly public live route, with its method and template', async () => {
    const workspace = makeWorkspace('logos-public-route-');
    workspace.pkg('catalog', {
      'package.json': JSON.stringify({ name: 'catalog' }),
      'routes.js': `
        export function publicProperty() { /** @register_router properties/:id @method GET @public */ return { ok: true }; }
        export function privateProperty() { /** @register_router properties/:id/edit @method GET */ return { ok: true }; }
        export function privatePost() { /** @register_router properties/:id @method POST */ return { ok: true }; }
      `,
    });
    const instance = await bootstrap({ workspace: workspace.root, port: false, views: { enabled: false } });
    closers.push(async () => { await instance.close(); workspace.cleanup(); });

    expect(isPublicRoute('/catalog/properties/42', 'GET')).toBe(true);
    expect(isPublicRoute('/catalog/properties/42/edit', 'GET')).toBe(false);
    expect(isPublicRoute('/catalog/properties/42', 'POST')).toBe(false);
    expect(isPublicRoute('/catalog/properties', 'GET')).toBe(false);
  });
});
