// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/views/offline';
export type { OfflineMode, OfflineReload, OfflineViews, OfflinePolicy, OfflineManifest } from '../contracts/views/offline';
export const resolveOfflinePolicy: typeof Contract.resolveOfflinePolicy = (...args: any[]) => legacyModule('modules/views/offline').resolveOfflinePolicy(...args);
export const recordOfflineRoutes: typeof Contract.recordOfflineRoutes = (...args: any[]) => legacyModule('modules/views/offline').recordOfflineRoutes(...args);
export const getOfflineRoutes: typeof Contract.getOfflineRoutes = (...args: any[]) => legacyModule('modules/views/offline').getOfflineRoutes(...args);
export const routePatternToRegex: typeof Contract.routePatternToRegex = (...args: any[]) => legacyModule('modules/views/offline').routePatternToRegex(...args);
export const buildOfflineManifest: typeof Contract.buildOfflineManifest = (...args: any[]) => legacyModule('modules/views/offline').buildOfflineManifest(...args);
export const serviceWorkerScript: typeof Contract.serviceWorkerScript = (...args: any[]) => legacyModule('modules/views/offline').serviceWorkerScript(...args);
export const offlineClientScript: typeof Contract.offlineClientScript = (...args: any[]) => legacyModule('modules/views/offline').offlineClientScript(...args);
export const OFFLINE_MODES: typeof Contract.OFFLINE_MODES = legacyModule('modules/views/offline').OFFLINE_MODES;
export const DEFAULT_OFFLINE_POLICY: typeof Contract.DEFAULT_OFFLINE_POLICY = legacyModule('modules/views/offline').DEFAULT_OFFLINE_POLICY;
