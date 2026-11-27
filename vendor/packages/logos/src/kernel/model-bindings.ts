import { currentAuthority } from './authority-context';
import { expressionValidator, modelCatalog } from './model-catalog';
import type { Container } from './container';
import path from 'node:path';
import fs from 'node:fs';

const runtimes = new WeakMap<object, Container>();
export function registerModelRuntime(container: Container) { runtimes.set(container.authority, container); }

/** Resolve at every operation, never retain a privileged database/table proxy.
 * Captured methods and records receive the same checks as the initial lookup. */
export function modelBinding(root: string, name: string): any {
  const authorize = (reading = false) => {
    const { access, principal } = currentAuthority();
    const container = access && runtimes.get(access);
    if (!container) throw new Error(`MODEL_AUTHORITY_REQUIRED: ${name}`);
    const relative = path.relative(fs.realpathSync(container.workspace), fs.realpathSync(root));
    const pkg = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? container.registry.getPackage(relative) : null;
    if (!pkg || !fs.existsSync(path.join(pkg.dir, 'package.json'))) throw new Error(`MODEL_PACKAGE_UNAVAILABLE: ${root}`);
    if (reading && principal.kind === 'package' && principal.id !== pkg.folder) throw new Error('Tenant does not match the current package');
    const decision = access!.enforce({
      principal, surface: 'database', operation: 'access', resource: pkg.folder,
      ...(reading ? { metadata: { model: name, operation: 'readPrimaryKey' } } : {}),
    });
    if (reading && !decision.declared) throw new Error('Explicit database permission required');
    const db: any = container.modules.get('db')?.api;
    if (!reading && !db?.getProxy) throw new Error(`MODEL_PERSISTENCE_PROVIDER_MISSING: db required for ${name}`);
    return { db, tenant: pkg.folder };
  };
  const resolve = () => { const { db, tenant } = authorize(); return db.getProxy(tenant)[name]; };
  function guard(value: any): any {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || value instanceof Date) return value;
    if (typeof value.then === 'function') return Promise.resolve(value).then(guard);
    return new Proxy(value, {
      get(target, key) { authorize(); const child = Reflect.get(target, key, target); return typeof child === 'function' ? (...args: any[]) => { authorize(); return guard(Reflect.apply(child, target, args)); } : guard(child); },
      set(target, key, item) { authorize(); return Reflect.set(target, key, item, target); },
      deleteProperty(target, key) { authorize(); return Reflect.deleteProperty(target, key); },
      ownKeys(target) { authorize(); return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, key) {
        authorize();
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return descriptor && descriptor.configurable && 'value' in descriptor ? { ...descriptor, value: guard(descriptor.value) } : descriptor;
      },
    });
  }
  async function readPrimaryKey(key: unknown) {
    let runtime;
    try {
      runtime = authorize(true);
    } catch (cause) {
      throw Object.assign(new Error(`Cannot read ${name} in the current authority context`, { cause }), { code: 'SCRIBA_READ_DENIED' });
    }
    const catalog = modelCatalog(root);
    const model = catalog.models[name];
    const invalid = () => Object.assign(new TypeError(`Invalid primary key for ${name}`), { code: 'SCRIBA_INVALID_KEY' });
    if (!model?.primaryKey) throw invalid();
    const { fields, composite } = model.primaryKey;
    if (composite && (!key || typeof key !== 'object' || Array.isArray(key)
      || Reflect.ownKeys(key).length !== fields.length || fields.some((field: string) => !Object.hasOwn(key, field)))) throw invalid();
    const values = Object.fromEntries(fields.map((field: string) => {
      const value = composite ? Object.getOwnPropertyDescriptor(key, field)?.value : key;
      const schemaField = model.fields.find((item: any) => item.name === field);
      if (value == null || schemaField.isList) throw invalid();
      try {
        return [field, expressionValidator(schemaField.type, catalog, `${name}.${field}`)(value)];
      } catch {
        throw invalid();
      }
    }));
    const scriba = runtime.db?.getScriba?.();
    if (!scriba?.readByPrimaryKey) throw new Error('SCRIBA_PRIMARY_KEY_PROVIDER_MISSING');
    return scriba.readByPrimaryKey(runtime.tenant, name, values, model.fields
      .filter((field: any) => !field.relation && !catalog.models[field.type])
      .map((field: any) => field.name));
  }
  return new Proxy({}, {
    get(_target, key) {
      if (key === '__logosReadPrimaryKey') return readPrimaryKey;
      const table = resolve();
      const value = Reflect.get(table, key, table);
      return typeof value === 'function' ? (...args: any[]) => { const current = resolve(); return guard(Reflect.apply(current[key], current, args)); } : guard(value);
    },
    set(_target, key, value) { const table = resolve(); return Reflect.set(table, key, value); },
    deleteProperty(_target, key) { const table = resolve(); return Reflect.deleteProperty(table, key); },
  });
}
