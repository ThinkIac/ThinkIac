// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/deploy';
export type { DeployMode, DeployRef, DeployResult, DeployContext } from '../contracts/repo/deploy';
export const deployMain: typeof Contract.deployMain = (...args: any[]) => legacyModule('modules/repo/deploy').deployMain(...args);
export const describeBranchPush: typeof Contract.describeBranchPush = (...args: any[]) => legacyModule('modules/repo/deploy').describeBranchPush(...args);
