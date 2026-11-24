import { Container, LogosModule } from '../../../kernel/container';
export type HotReloadMode = 'always' | 'auto' | 'prompt' | 'manual';
export interface RenderOptions {
    hotReloadMode?: HotReloadMode;
    hotReloadBadge?: boolean;
    offlineClient?: string;
    clientScripts?: string[];
}
/**
 * Includes widget files and the widgets directory itself. Directory removals
 * arrive from chokidar without an extension, but still invalidate the global
 * registry just like a removed .svelte/.svx widget does.
 */
export declare function isWidgetPath(filePath: string): boolean;
/**
 * Precedência do modo de hot-reload de uma página, do mais específico ao mais
 * geral:
 *
 *   1. `?hmr=always|prompt|manual` na URL      (depuração pontual)
 *   2. `runtime.hotReload.mode` do package.json (o pacote se declara)
 *   3. `views.hotReload.mode` do bootstrap      (política do runtime)
 *   4. 'auto'                                   (default: janela segura e silenciosa)
 *
 * O default `auto` nunca recarrega uma interação ativa, mas converge sem UI
 * quando a página fica ociosa.
 */
export declare function resolveHotReloadMode(container: Container, pkgFolder: string, query?: any): HotReloadMode;
export declare function getEngine(container: Container): any;
export type ResolvedView = {
    page: string;
    file: string;
    sourcePath: string;
    public: boolean;
};
/** Payload transformado por extensões antes da renderização de uma view. */
export type ViewRenderPayload = {
    packageName: string;
    viewName: string;
    source: 'public' | 'private';
    clientScripts: string[];
};
/** Resolves a clean URL page name to a private or .public source file. */
export declare function resolveViewSource(viewsDir: string, page: string, authenticated?: boolean): ResolvedView | null;
/** The package root follows the declared Index → Home priority. */
export declare function resolveEntryView(viewsDir: string, authenticated?: boolean): ResolvedView | null;
/** True only for the clean URL of a currently-discovered .public view. */
export declare function isRegisteredPublicView(container: Container, requestPath: string): boolean;
export declare const viewsModule: LogosModule;
export declare function setViewsGlobalData(container: Container, data: Record<string, any>): void;
export declare function getViewsGlobalData(container: Container): Record<string, any>;
export declare function setViewsTheme(container: Container, theme: Record<string, string>): void;
/**
 * Toggles the Tailwind v4 CDN runtime at runtime. Combine freely with
 * setViewsTheme() — the same theme variables feed Tailwind's `@theme` block
 * once this is on.
 */
export declare function setViewsTailwind(container: Container, enabled: boolean): void;
export declare function rebuildWidgetRegistry(container: Container): void;
export declare function getWidgetComponentPath(container: Container): string;
/** Serial warmup keeps cold builds from competing with one another. */
export declare function prewarmViews(container: Container): Promise<{
    ready: boolean;
    failed: string[];
}>;
