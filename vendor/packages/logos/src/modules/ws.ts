// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/ws';
export const getHub: typeof Contract.getHub = (...args: any[]) => legacyModule('modules/ws').getHub(...args);
export const wsModule: typeof Contract.wsModule = legacyModule('modules/ws').wsModule;
