import type { IsolatedRunner } from './index';
import type { Container } from '../../kernel/container';
import { externalApi } from '../../kernel/external-modules';

export function withStagedIsolated<T>(container: Container, folder: string, runner: IsolatedRunner, work: () => Promise<T>): Promise<T> {
  return externalApi<any>(container, 'isolation').withStagedIsolated(container, folder, runner, work);
}

/** Starts an isolated package before any public surface is wired. */
export async function isolatedRunnerFor(container: Container, pkg: any, publish = true): Promise<IsolatedRunner | null> {
  if (pkg?.isolated !== true && pkg?.runtime?.mode !== 'isolated') return null;
  return externalApi<any>(container, 'isolation').isolatedRunnerFor(container, pkg, publish);
}

export function getIsolatedRunner(container: Container, folder: string): IsolatedRunner | null {
  const provider = container.state('external-api').get('isolation');
  return provider?.getIsolatedRunner(container, folder) ?? container.state('isolated').get(folder) ?? null;
}

export async function stopIsolatedRunner(container: Container, folder: string, reason: string): Promise<void> {
  const provider = container.state('external-api').get('isolation');
  if (provider) return provider.stopIsolatedRunner(container, folder, reason);
  const runner = container.state('isolated').get(folder);
  container.state('isolated').delete(folder);
  await runner?.stop(reason);
}
