// Transitional facade for existing imports. The implementation and dependencies
// are owned by module-stabilizer; these are generic kernel execution primitives.
import path from 'node:path';
import { externalModulePath } from './module-resolution';
import * as utils from './utils';
import * as scan from './scan';
import * as contracts from './package-contract';
import * as wiring from './package-wiring';
import * as declarations from './declaration-events';
import * as debug from './debug-log';
import * as isolation from '../core/isolated/bridge';
import * as recovery from './package-fault-recovery';

export function stabilizationPorts() {
  return {
    '../kernel/utils': utils, '../kernel/scan': scan,
    '../kernel/package-contract': contracts, '../kernel/package-wiring': { ...wiring, validatePackageWiring: wiring.validatePackageContract },
    '../kernel/declaration-events': declarations, '../kernel/debug-log': debug,
    '../core/isolated/bridge': isolation, '../kernel/package-fault-recovery': recovery,
  };
}
let library: ((name: string) => any) | undefined;
export function stabilizationLibrary(name: string): any {
  if (!library) library = require(path.join(externalModulePath('stabilizer'), 'library.cjs')).createLibrary(stabilizationPorts());
  return library!(name);
}
export function lazyStabilizationClass(module: string, name: string): any {
  const resolve = () => stabilizationLibrary(module)[name];
  const proxy = new Proxy(function () {}, {
    construct: (_target, args, newTarget) => Reflect.construct(resolve(), args, newTarget === proxy ? resolve() : newTarget),
    get: (_target, key) => key === Symbol.hasInstance
      ? (value: any) => value instanceof resolve()
      : Reflect.get(resolve(), key),
  });
  return proxy;
}
