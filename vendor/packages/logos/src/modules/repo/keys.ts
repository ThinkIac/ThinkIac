// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/keys';
export type { KeyRole, AuthorizedKey } from '../contracts/repo/keys';
export const parseAuthorizedKeys: typeof Contract.parseAuthorizedKeys = (...args: any[]) => legacyModule('modules/repo/keys').parseAuthorizedKeys(...args);
export const loadAuthorizedKeys: typeof Contract.loadAuthorizedKeys = (...args: any[]) => legacyModule('modules/repo/keys').loadAuthorizedKeys(...args);
export const appendAuthorizedKey: typeof Contract.appendAuthorizedKey = (...args: any[]) => legacyModule('modules/repo/keys').appendAuthorizedKey(...args);
