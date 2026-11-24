// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/hooks';
export const wirePackageHooks: typeof Contract.wirePackageHooks = (...args: any[]) => legacyModule('modules/hooks').wirePackageHooks(...args);
export const hooksModule: typeof Contract.hooksModule = legacyModule('modules/hooks').hooksModule;
