import { AsyncLocalStorage } from 'node:async_hooks';
import { IsolatedRunner } from './index';
import type { Container } from '../../kernel/container';
import { runAsPackage } from '../../kernel/authority-context';
import { externalApi } from '../../kernel/external-modules';

const stagingRunner = new AsyncLocalStorage<{ container: Container; folder: string; runner: IsolatedRunner }>();

export function withStagedIsolated<T>(container: Container, folder: string, runner: IsolatedRunner, work: () => Promise<T>): Promise<T> {
  return stagingRunner.run({ container, folder, runner }, work);
}

/** Starts an isolated package before any public surface is wired. */
export async function isolatedRunnerFor(container: Container, pkg: any, publish = true): Promise<IsolatedRunner | null> {
  if (pkg?.isolated !== true && pkg?.runtime?.mode !== 'isolated') return null;
  const runners = container.state('isolated');
  let runner = runners.get(pkg.folder) as IsolatedRunner | undefined;
  if (publish && runner?.running) return runner;
  runner = new IsolatedRunner({
    folder: pkg.folder,
    dir: pkg.dir,
    // Do not inherit host credentials or arbitrary environment values.
    env: { NODE_ENV: process.env.NODE_ENV ?? 'production' },
    onExit: event => {
      if (!event.expected && runners.get(pkg.folder) === runner) {
        void container.bus.emit('isolated:exit', { pkg: pkg.folder, ...event }).catch(error => container.log(error.message));
      }
    },
    onLog: message => container.log(`[isolated:${pkg.folder}] ${message}`),
    onEvent: async (event, payload) => runAsPackage(container.authority, pkg.folder, async () => {
      container.authority.enforce({ principal: { kind: 'package', id: pkg.folder }, surface: 'events', operation: 'publish', resource: event });
      await container.bus.emit(event, payload, { pkg });
      return undefined;
    }),
    onCapability: async request => {
      if (request.surface !== 'database') throw new Error(`Unsupported isolated capability: ${request.surface}`);
      if (request.tenant !== pkg.folder) throw new Error('An isolated package can only access its own database');
      if (typeof request.entity !== 'string' || typeof request.method !== 'string' || !Array.isArray(request.args)) throw new Error('Invalid database capability request');
      return runAsPackage(container.authority, pkg.folder, () => {
        const method = externalApi<any>(container, 'db').getProxy(pkg.folder)?.[request.entity]?.[request.method];
        if (typeof method !== 'function') throw new Error(`Unknown database operation: ${request.entity}.${request.method}`);
        return method(...request.args);
      });
    },
  });
  await runner.start();
  if (publish) runners.set(pkg.folder, runner);
  return runner;
}

export function getIsolatedRunner(container: Container, folder: string): IsolatedRunner | null {
  const staged = stagingRunner.getStore();
  if (staged?.container === container && staged.folder === folder) return staged.runner;
  return container.state('isolated').get(folder) ?? null;
}

export async function stopIsolatedRunner(container: Container, folder: string, reason: string): Promise<void> {
  const runner = getIsolatedRunner(container, folder);
  container.state('isolated').delete(folder);
  await runner?.stop(reason);
}
