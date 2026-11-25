import path from 'node:path';
import { externalModulePath } from './module-resolution';

/** Compatibility exports resolve capabilities only when used. */
export function capabilityImplementation(module: string, file: string): any {
  return require(path.join(externalModulePath(module), file));
}
export function lazyCapabilityClass(module: string, file: string, name: string): any {
  const resolve = () => capabilityImplementation(module, file)[name];
  const proxy = new Proxy(function () {}, {
    construct: (_target, args, newTarget) => Reflect.construct(resolve(), args, newTarget === proxy ? resolve() : newTarget),
    get: (_target, key) => key === Symbol.hasInstance
      ? (value: any) => value instanceof resolve()
      : Reflect.get(resolve(), key),
  });
  return proxy;
}
