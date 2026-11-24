// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../kernel/legacy-module-compat';
import type * as Contract from './contracts/http';
export const buildUploadMiddleware: typeof Contract.buildUploadMiddleware = (...args: any[]) => legacyModule('modules/http').buildUploadMiddleware(...args);
export const getPackageMount: typeof Contract.getPackageMount = (...args: any[]) => legacyModule('modules/http').getPackageMount(...args);
export const getOrCreateRouter: typeof Contract.getOrCreateRouter = (...args: any[]) => legacyModule('modules/http').getOrCreateRouter(...args);
export const clearRouter: typeof Contract.clearRouter = (...args: any[]) => legacyModule('modules/http').clearRouter(...args);
export const isRegisteredPublicRoute: typeof Contract.isRegisteredPublicRoute = (...args: any[]) => legacyModule('modules/http').isRegisteredPublicRoute(...args);
export const mountPackageRoutes: typeof Contract.mountPackageRoutes = (...args: any[]) => legacyModule('modules/http').mountPackageRoutes(...args);
export const replaceRegisteredPublicRoutes: typeof Contract.replaceRegisteredPublicRoutes = (...args: any[]) => legacyModule('modules/http').replaceRegisteredPublicRoutes(...args);
export const httpModule: typeof Contract.httpModule = legacyModule('modules/http').httpModule;
