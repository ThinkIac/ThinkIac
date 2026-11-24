// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/proc';
export const startProcessModule: typeof Contract.startProcessModule = (...args: any[]) => legacyModule('modules/proc').startProcessModule(...args);
export const stopProcessModule: typeof Contract.stopProcessModule = (...args: any[]) => legacyModule('modules/proc').stopProcessModule(...args);
