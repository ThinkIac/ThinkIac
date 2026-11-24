// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/tools';
export const toolToMcp: typeof Contract.toolToMcp = (...args: any[]) => legacyModule('modules/tools').toolToMcp(...args);
export const kernelTools: typeof Contract.kernelTools = (...args: any[]) => legacyModule('modules/tools').kernelTools(...args);
export const loadMcpTools: typeof Contract.loadMcpTools = (...args: any[]) => legacyModule('modules/tools').loadMcpTools(...args);
export const toolsModule: typeof Contract.toolsModule = legacyModule('modules/tools').toolsModule;
