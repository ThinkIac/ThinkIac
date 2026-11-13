import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/index';
import { makeWorkspace } from './helpers';

describe('reusable built-in modules', () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(closers.splice(0).map(close => close()));
    delete process.env.RUNTIME_ENV_PACKAGE_ENV_AUTH_TOKEN;
  });

  it('loads a package .env through the reusable env module during bootstrap', async () => {
    const workspace = makeWorkspace('logos-module-packages-');
    workspace.pkg('runtime-env-package', {
      'package.json': JSON.stringify({ name: 'runtime-env-package' }),
      '.env': 'AUTH_TOKEN=from-module\n',
    });
    const runtime = await bootstrap({ workspace: workspace.root, port: false, views: { enabled: false } });
    closers.push(async () => { await runtime.close(); workspace.cleanup(); });

    expect(process.env.RUNTIME_ENV_PACKAGE_ENV_AUTH_TOKEN).toBe('from-module');
  });
});
