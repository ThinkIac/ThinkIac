import path from 'node:path';
import { typedResource } from './resource-types';
import type { Container } from './container';
import { registerDeclarations } from './scan';
import { getIsolatedRunner } from '../core/isolated/bridge';
import { runAsPackage } from './authority-context';
import { runtimeEvent } from './runtime-protocol';

/** Deliver a serializable declaration and a separately mediated callable to modules. */
export async function collectPackageDeclarations(container: Container, pkg: any): Promise<any[]> {
  const runner = getIsolatedRunner(container, pkg.folder);
  if ((pkg.isolated === true || pkg.runtime?.mode === 'isolated') && !runner?.surfaces) {
    throw new Error(`Isolated package ${pkg.folder} has no running runner`);
  }
  const entries = runner?.surfaces
    ? runner.surfaces.declarations.map(entry => ({ ...entry, handler: (...args: any[]) => runner.invoke(entry.id, args) }))
    : await registerDeclarations((pkg.dir ?? (path.isAbsolute(pkg.folder) ? pkg.folder : container.registry.getPackage(pkg.folder).dir)));
  for (const entry of entries) {
    const type = entry.declaration.type;
    if (entry.declaration.legacy || ['module', 'type'].includes(type)) continue;
    const available = [...container.modules.values()].some(mod => !!mod.resources?.[type])
      || container.state('runtime:accepted-types').has(type)
      || container.bus.listeners(`register:${type}`).length > 0;
    if (!available) throw new Error(`[logos] missing resource type "${type}" for package "${pkg.folder}" (${entry.file})`);
  }
  return entries.filter(entry => !['module', 'type'].includes(entry.declaration.type)).map(entry => ({
    declaration: entry.declaration, file: entry.file, package: pkg.folder,
    handler: (...args: any[]) => runAsPackage(container.authority, pkg.folder, () => entry.handler(...args)),
  })).map(resource => typedResource(container, resource));
}

export async function preparePackageResources(container: Container, pkg: any) {
  const transactional = [...container.modules.values()].some(mod =>
    Object.values(mod.resources || {}).some(consumer => typeof consumer !== 'function'));
  return container.resourceTransactions.prepare(pkg.folder, transactional ? await collectPackageDeclarations(container, pkg) : []);
}

export async function emitPackageDeclarations(container: Container, pkg: any): Promise<void> {
  const resources = await collectPackageDeclarations(container, pkg);
  const transaction = await container.resourceTransactions.prepare(pkg.folder, resources);
  try {
    for (const resource of resources) {
      await runtimeEvent(container, 'logos:resource:discovered', 'scan', resource);
      try {
        await runtimeEvent(container, 'logos:resource:registering', 'wire', resource);
        await container.bus.emitStrict(`register:${resource.declaration.type}`, resource);
        await runtimeEvent(container, 'logos:resource:registered', 'wire', resource);
      } catch (error) {
        await runtimeEvent(container, 'logos:resource:failed', 'wire', { ...resource, error });
        throw error;
      }
    }
    await transaction.commit();
    await transaction.finish();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
