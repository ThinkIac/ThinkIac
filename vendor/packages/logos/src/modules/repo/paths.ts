// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/paths';
export type { RepoPaths } from '../contracts/repo/paths';
export const repoPaths: typeof Contract.repoPaths = (...args: any[]) => legacyModule('modules/repo/paths').repoPaths(...args);
export const slugify: typeof Contract.slugify = (...args: any[]) => legacyModule('modules/repo/paths').slugify(...args);
