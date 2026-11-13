import type { Container } from './container';
import { registerDeclarations } from './scan';
import { getIsolatedRunner } from '../core/isolated/bridge';
import { runAsPackage } from './authority-context';

/** Deliver a serializable declaration and a separately mediated callable to modules. */
export async function emitPackageDeclarations(container: Container, pkg: any): Promise<void> {
  const runner = getIsolatedRunner(container, pkg.folder);
  if ((pkg.isolated === true || pkg.runtime?.mode === 'isolated') && !runner?.surfaces) {
    throw new Error(`Isolated package ${pkg.folder} has no running runner`);
  }
  const entries = runner?.surfaces
    ? runner.surfaces.declarations.map(entry => ({ ...entry, handler: (...args: any[]) => runner.invoke(entry.id, args) }))
    : await registerDeclarations(pkg.folder);
  for (const entry of entries) {
    const handler = (...args: any[]) => runAsPackage(container.authority, pkg.folder, () => entry.handler(...args));
    await container.bus.emit(`register:${entry.declaration.type}`, {
      declaration: entry.declaration, file: entry.file, package: pkg.folder, handler,
    });
  }
}
