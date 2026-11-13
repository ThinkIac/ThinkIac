export type HotReloadMode = 'always' | 'auto' | 'prompt' | 'manual';

export interface RenderOptions {
  hotReloadMode?: HotReloadMode;
  hotReloadBadge?: boolean;
  offlineClient?: string;
  clientScripts?: string[];
}

export const HOT_RELOAD_MODES: HotReloadMode[];
export function isHotReloadMode(value: unknown): value is HotReloadMode;
export function hmrClientScript(componentName: string, options: { mode: HotReloadMode; badge: boolean }): string;
export function filePickerProtocolClientScript(): string;
export class SvelteEngine {
  constructor(cacheDir?: string, validationIntervalMs?: number);
  cacheDir: string;
  widgetRegistryPath: string;
  widgetComponentPath: string;
  optionalStubPath: string;
  render(source: string, componentName: string, props: Record<string, unknown>, workspace: string, options?: RenderOptions): Promise<string>;
  prewarm(source: string, componentName: string, workspace: string): Promise<void>;
  buildWidgetRegistry(workspace: string): void;
  affectedComponents(file: string): string[];
  validateComponents(components: string[], workspace: string): Promise<void>;
}
export class FileDigests {
  invalidate(file: string): void;
  hash(file: string): Promise<string>;
  graph(files: string[]): Promise<Record<string, string>>;
}
export class TailwindStyles {
  constructor(cacheDir: string, pluginPath?: string);
  build(manifest: unknown, theme: Record<string, string>, workspace: string): Promise<string | null>;
}
export function precompressAssets(files: string[]): Promise<void>;
export function compressedAssets(cacheDir: string): unknown;
export const versionedAsset: (name: string) => boolean;
