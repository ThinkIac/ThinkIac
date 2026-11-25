import fs from 'node:fs';
import { installResourceContracts } from './resource-types';
import path from 'node:path';
import type { Container } from './container';
import { nativeModuleContext } from './module-context';
import { modulePrimitives } from './module-primitives';
import { externalModulePath } from './module-resolution';

/** Collect structural declarations before sealing. The returned descriptor is data,
 * not an imported Logos API. Capability ports preserve the distribution's adapters.
 */
export async function collectStructuralDeclaration(container: Container, entry: any, identity: string, subscriptions = new Set<() => void>()) {
  const { declaration, handler } = entry;
  if (!declaration.name) throw new Error(`[logos] ${declaration.type} requires a name (${identity})`);
  let directory = path.dirname(fs.realpathSync(entry.file));
  while (!fs.existsSync(path.join(directory, 'package.json')) && path.dirname(directory) !== directory) directory = path.dirname(directory);
  const legacyConsumer = !entry.file.endsWith('.type') && declaration.type === 'type' && declaration.tags.provider?.[0] !== 'descriptor';
  const kind = legacyConsumer ? 'legacy-type' : 'provider';
  const key = `${directory}:${handler.name}:${declaration.type}:${declaration.name}`;
  const collected = container.state('runtime:structural-declarations');
  if (collected.has(key)) return;
  if (container.modulesSealed) throw new Error(`[logos] module catalog is sealed; structural declaration ${declaration.type} ${declaration.name} requires a new boot (${entry.file})`);
  collected.set(key, true);
  const name = declaration.name;
  const owners = container.state(`runtime:declaration-owners:${kind}`);
  const previous = owners.get(name);
  if (previous && previous.key !== key) throw new Error(`[logos] duplicate ${declaration.type} "${name}": ${previous.identity} and ${identity}`);
  owners.set(name, { key, identity });
  const cleanups = container.state('runtime:entrypoints');
  cleanups.set(key, () => { for (const off of subscriptions) off(); subscriptions.clear(); });
  const native = nativeModuleContext(container, identity, subscriptions);
  const tags = { ...declaration.tags };
  for (const key of ['requires', 'after']) if (tags[key]) tags[key] = tags[key].flatMap((value: string) => value.split(/\s+/)).filter(Boolean);
  const { register: _register, ...ports } = native.context;
  let context: any = Object.freeze(ports);
  if (tags.context?.[0] === 'capability') {
    const exported = require(entry.file);
    const adapt = exported.createHost ?? require(externalModulePath('runtime-compat')).createHost;
    context = adapt(container, modulePrimitives(), subscriptions);
  }
  await native.collect(async () => {
    if (legacyConsumer) {
      if (container.modules.has(`type.${name}`)) throw new Error(`[logos] type module name already registered: type.${name} (${identity})`);
      // A type handler is the consumer itself. Transactional providers declare
      // @transactional and return a generation with commit/rollback/dispose.
      const consumer = tags.transactional ? { prepare: (snapshot: any, generation: any) => handler(snapshot, context, generation) }
        : (resource: any) => handler(resource, context);
      container.use({ name: `type.${name}`, phase: 'wire', requires: tags.requires ?? [],
        resources: { [name]: consumer }, install() {},
        close() { for (const off of subscriptions) off(); subscriptions.clear(); },
      }, identity);
      return;
    }
    const definition = await handler(context);
    if (!definition || typeof definition !== 'object') throw new Error(`[logos] @register module ${name} must return a module descriptor (${entry.file})`);
    if (definition.name && definition.name !== name) throw new Error(`[logos] module name differs from declaration: ${name} (${entry.file})`);
    if (container.modules.has(name)) throw new Error(`[logos] duplicate module "${name}" (${identity}, ${entry.file})`);
    for (const type of tags.accepts?.flatMap((value: string) => value.split(/\s+/)) ?? []) container.state('runtime:accepted-types').set(type, name);
    installResourceContracts(container, definition, entry.file.endsWith('.type') || tags.provider?.[0] === 'descriptor', identity);
    const close = definition.close;
    const descriptor = { ...definition, name, phase: definition.phase ?? tags.phase?.[0] ?? 'wire',
      requires: definition.requires ?? tags.requires ?? [], after: definition.after ?? tags.after ?? [],
      install: definition.install ? () => definition.install(context) : () => {},
      async close() { try { await close?.call(definition); } finally { for (const off of subscriptions) off(); subscriptions.clear(); } },
    };
    // Capability adapters already close over scoped ports; legacy install may
    // still expect its container facade, supplied by the adapter itself.
    if (tags.context?.[0] === 'capability') descriptor.install = () => definition.install?.(container);
    container.use(descriptor, identity);
  });
}
