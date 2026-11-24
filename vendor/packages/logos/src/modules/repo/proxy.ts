// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/repo/proxy';
export type { ExposeMode, ResolvedTarget } from '../contracts/repo/proxy';
export const resolveTarget: typeof Contract.resolveTarget = (...args: any[]) => legacyModule('modules/repo/proxy').resolveTarget(...args);
export const proxyRequest: typeof Contract.proxyRequest = (...args: any[]) => legacyModule('modules/repo/proxy').proxyRequest(...args);
export const installUpgradeProxy: typeof Contract.installUpgradeProxy = (...args: any[]) => legacyModule('modules/repo/proxy').installUpgradeProxy(...args);
