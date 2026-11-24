// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/branches';
export type { BranchStatus, BranchInstance, BranchesConfig, BranchManagerOptions } from '../contracts/repo/branches';
export type BranchManager = Contract.BranchManager;
export const BranchManager: typeof Contract.BranchManager = lazyLegacyClass('modules/repo/branches', 'BranchManager');
