import { currentAuthority } from './authority-context';
import type { Container } from './container';
import path from 'node:path';
import fs from 'node:fs';

const runtimes = new WeakMap<object, Container>();
export function registerModelRuntime(container: Container) { runtimes.set(container.authority, container); }

/** Resolve at every operation, never retain a privileged database/table proxy.
 * Captured methods and records receive the same checks as the initial lookup. */
export function modelBinding(root: string, name: string): any {
  const authorize = () => {
    const { access, principal } = currentAuthority();
    const container = access && runtimes.get(access);
    if (!container) throw new Error(`MODEL_AUTHORITY_REQUIRED: ${name}`);
    const relative = path.relative(fs.realpathSync(container.workspace), fs.realpathSync(root));
    const pkg = relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? container.registry.getPackage(relative) : null;
    if (!pkg || !fs.existsSync(path.join(pkg.dir, 'package.json'))) throw new Error(`MODEL_PACKAGE_UNAVAILABLE: ${root}`);
    access!.enforce({ principal, surface: 'database', operation: 'access', resource: pkg.folder });
    const db: any = container.modules.get('db')?.api;
    if (!db?.getProxy) throw new Error(`MODEL_PERSISTENCE_PROVIDER_MISSING: db required for ${name}`);
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
  return new Proxy({}, {
    get(_target, key) {
      const table = resolve();
      const value = Reflect.get(table, key, table);
      return typeof value === 'function' ? (...args: any[]) => { const current = resolve(); return guard(Reflect.apply(current[key], current, args)); } : guard(value);
    },
    set(_target, key, value) { const table = resolve(); return Reflect.set(table, key, value); },
    deleteProperty(_target, key) { const table = resolve(); return Reflect.deleteProperty(table, key); },
  });
}
