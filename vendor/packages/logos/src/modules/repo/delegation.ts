// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/delegation';
export type { DelegatedIdentity } from '../contracts/repo/delegation';
export const verifyDelegatedCredential: typeof Contract.verifyDelegatedCredential = (...args: any[]) => legacyModule('modules/repo/delegation').verifyDelegatedCredential(...args);
export const DELEGATION_PREFIX: typeof Contract.DELEGATION_PREFIX = legacyModule('modules/repo/delegation').DELEGATION_PREFIX;
