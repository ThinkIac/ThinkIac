// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/index';
export type { RepoRuntimeConfig, RepoState } from '../contracts/repo/index';
export const parseDuration: typeof Contract.parseDuration = (...args: any[]) => legacyModule('modules/repo/index').parseDuration(...args);
export const normalizeConfig: typeof Contract.normalizeConfig = (...args: any[]) => legacyModule('modules/repo/index').normalizeConfig(...args);
export const isAuthorizedAdminRequest: typeof Contract.isAuthorizedAdminRequest = (...args: any[]) => legacyModule('modules/repo/index').isAuthorizedAdminRequest(...args);
export const isBranchInstance: typeof Contract.isBranchInstance = (...args: any[]) => legacyModule('modules/repo/index').isBranchInstance(...args);
export const getRepoState: typeof Contract.getRepoState = (...args: any[]) => legacyModule('modules/repo/index').getRepoState(...args);
export const repoModule: typeof Contract.repoModule = legacyModule('modules/repo/index').repoModule;
export { repoPaths, slugify } from './paths';
export type { BranchInstance } from './branches';
