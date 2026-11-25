// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/views/shared-state';
export const transformSharedState: typeof Contract.transformSharedState = (...args: any[]) => legacyModule('modules/views/shared-state').transformSharedState(...args);
