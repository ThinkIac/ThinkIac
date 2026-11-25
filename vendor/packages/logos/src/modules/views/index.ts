// Compatibility facade. Concrete resources are owned by external modules.
import { legacyModule, lazyLegacyClass } from '../../kernel/legacy-module-compat';
import type * as Contract from '../contracts/views/index';
export type { HotReloadMode, RenderOptions, ResolvedView, ViewRenderPayload } from '../contracts/views/index';
export const isWidgetPath: typeof Contract.isWidgetPath = (...args: any[]) => legacyModule('modules/views/index').isWidgetPath(...args);
export const resolveHotReloadMode: typeof Contract.resolveHotReloadMode = (...args: any[]) => legacyModule('modules/views/index').resolveHotReloadMode(...args);
export const getEngine: typeof Contract.getEngine = (...args: any[]) => legacyModule('modules/views/index').getEngine(...args);
export const resolveViewSource: typeof Contract.resolveViewSource = (...args: any[]) => legacyModule('modules/views/index').resolveViewSource(...args);
export const resolveEntryView: typeof Contract.resolveEntryView = (...args: any[]) => legacyModule('modules/views/index').resolveEntryView(...args);
export const isRegisteredPublicView: typeof Contract.isRegisteredPublicView = (...args: any[]) => legacyModule('modules/views/index').isRegisteredPublicView(...args);
export const setViewsGlobalData: typeof Contract.setViewsGlobalData = (...args: any[]) => legacyModule('modules/views/index').setViewsGlobalData(...args);
export const getViewsGlobalData: typeof Contract.getViewsGlobalData = (...args: any[]) => legacyModule('modules/views/index').getViewsGlobalData(...args);
export const setViewsTheme: typeof Contract.setViewsTheme = (...args: any[]) => legacyModule('modules/views/index').setViewsTheme(...args);
export const setViewsTailwind: typeof Contract.setViewsTailwind = (...args: any[]) => legacyModule('modules/views/index').setViewsTailwind(...args);
export const rebuildWidgetRegistry: typeof Contract.rebuildWidgetRegistry = (...args: any[]) => legacyModule('modules/views/index').rebuildWidgetRegistry(...args);
export const getWidgetComponentPath: typeof Contract.getWidgetComponentPath = (...args: any[]) => legacyModule('modules/views/index').getWidgetComponentPath(...args);
export const prewarmViews: typeof Contract.prewarmViews = (...args: any[]) => legacyModule('modules/views/index').prewarmViews(...args);
export const viewsModule: typeof Contract.viewsModule = legacyModule('modules/views/index').viewsModule;
