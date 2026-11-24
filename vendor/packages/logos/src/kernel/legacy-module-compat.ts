import path from 'node:path';
import { externalModulePath } from './module-resolution';
import { modulePrimitives } from './module-primitives';

export function legacyModule(name: string): any {
  return require(path.join(externalModulePath('runtime-compat'), 'legacy-library.cjs'))
    .createLegacyLibrary(modulePrimitives(), externalModulePath)(name);
}
export function lazyLegacyClass(module: string, name: string): any {
  const resolve = () => legacyModule(module)[name];
  const proxy = new Proxy(function () {}, {
    construct: (_target, args, newTarget) => Reflect.construct(resolve(), args, newTarget === proxy ? resolve() : newTarget),
    get: (_target, key) => key === Symbol.hasInstance
      ? (value: any) => value instanceof resolve()
      : Reflect.get(resolve(), key),
  });
  return proxy;
}
