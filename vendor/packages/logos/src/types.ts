// src/types.ts — public type surface for Lógos v2.
//
// atomic / docker / os-context / cognites / contexts are intentionally gone
// (see MIGRATION.md). The atomic & docker keys are still ACCEPTED by
// bootstrap() for source compatibility, but only produce a warning.

'use strict';

/** Options accepted by the external MCP HTTP capability. Kept here so the
 * public Lógos types do not depend on an implementation module. */
export interface McpHttpOptions {
  host?: string;
  allowRemote?: boolean;
  sessionTtlMs?: number;
  maxRequestsPerMinute?: number;
  auth?: any;
}

export interface ViewsIndexConfig {
  package: string;
  page: string;
}

export interface ViewsConfig {
  /** Compile initial Tailwind CSS in a worker; retain browser compilation for dynamic plugins. */
  precompileCss?: boolean;
  /** Essential assets compiled before HTTP starts listening. Missing optional packages are skipped. */
  warmup?: ViewsIndexConfig[];
  /** Graph reconciliation interval; HMR invalidates immediately. 0 checks every request. Default 1000ms. */
  validationIntervalMs?: number;
  enabled?: boolean;
  /**
   * CSS variables injected into every rendered page.
   * When `tailwind` is off, these land in a plain `:root { ... }` block.
   * When `tailwind` is on, the same variables land inside a Tailwind v4
   * `@theme { ... }` block instead, so they also generate real utilities
   * (e.g. `--color-primary` → `bg-primary`, `text-primary`, `border-primary`).
   */
  theme?: Record<string, string>;
  /** Bootstrap 5 CDN tags (default true; set false to opt out). */
  bootstrap5?: boolean;
  /**
   * Tailwind CSS v4 via the official browser/runtime build
   * (`@tailwindcss/browser`, the CDN successor to the old Play CDN).
   * No build step: utility classes just work in any `.svelte` view.
   * Default false. Can be combined with `bootstrap5`, though most projects
   * pick one or the other.
   */
  tailwind?: boolean;
  /** Data merged into every page's props. */
  globalData?: Record<string, any>;
  /** Page served at "/" — a redirect string, or a package+page pair. */
  index?: string | ViewsIndexConfig;
}

export interface HttpConfig {
  /** Bounded HTTP timings exposed through the existing authenticated debug surface. Default true. */
  performance?: boolean;
  /** Static directory served at "/" (path relative to the project root). */
  public?: string;
}

export interface WorkersConfig {
  /** Number of reusable worker threads. Defaults to min(4, UV_THREADPOOL_SIZE || 4). */
  size?: number;
  /** Maximum waiting tasks. New work is rejected when full. Defaults to size * 8. */
  maxQueue?: number;
  /** Default deadline per task. Defaults to 30 seconds. */
  taskTimeoutMs?: number;
}

export interface HotReloadConfig {
  /** Master switch. Default: on in dev, off in prod unless HOT_RELOAD_ENABLED. */
  enabled?: boolean;
  /** Quiet window (ms) that closes a human edit transaction. Default 2000. */
  quiescenceMs?: number;
}

export interface McpConfig extends McpHttpOptions {
  /** Start the standalone MCP HTTP transport. */
  http?: boolean;
  port?: number;
}

export interface StorageConfig {
  /** Root used for stable object keys; defaults to LOGOS_DATA_DIR or workspace. */
  root?: string;
  /** Durable catalogue/outbox directory. */
  dataDir?: string;
  /** Provider injected by the host; packages never receive its credentials. */
  provider?: any;
  /** Declarative S3-compatible data-plane provider, resolved by Lógos at boot. */
  s3?: {
    name?: string; endpoint: string; region?: string; bucket: string; prefix?: string;
    accessKeyId: string; secretAccessKey: string;
  };
  /** Suggested retry interval when a frozen object cannot be restored. */
  retryAfterMs?: number;
}

/**
 * Optional self-hosted Git surface. Main deploys through the stabilizer;
 * other branches are isolated, short-lived previews.
 */
export interface RepoConfig {
  enabled?: boolean;
  admin?: { token?: string };
  ssh?: { enabled?: boolean; port?: number; host?: string };
  main?: { branch?: string; onPush?: 'stabilize' | 'checkout' | 'restart' | 'off' };
  branches?: {
    enabled?: boolean;
    expose?: 'path' | 'subdomain' | 'port-only';
    ports?: [number, number];
    idleTTL?: string | number;
    max?: number;
    bootTimeout?: string | number;
    entry?: string;
    runner?: { command: string; args?: string[] };
    db?: 'empty' | 'clone';
    env?: { allow?: string[] };
  };
  hookTimeout?: string | number;
}

export interface BootstrapConfig {
  /** Workspace path. Defaults to PACKAGES_PATH or <cwd>/packages. */
  workspace?: string;
  /** HTTP port. Default 5040. `false` disables the HTTP server (CLI mode). */
  port?: number | false;
  /** Bind address for the HTTP server. Defaults to the Node server default. */
  host?: string;
  http?: HttpConfig;
  /** Bounded pool for trusted CPU-bound modules. Set false to disable it. */
  workers?: WorkersConfig | false;
  views?: ViewsConfig;
  hotReload?: HotReloadConfig;
  mcp?: McpConfig;
  storage?: StorageConfig;
  /** User-governed delivery between packages. Undeclared events remain emit-capable. */
  eventGovernance?: import('./kernel/event-governance').EventGovernanceOptions;
  /** Git over SSH, stabilized main deploys and on-demand branch previews. */
  repo?: RepoConfig | boolean;
  /** Resolver of Lógos Package dependencies through an npm-compatible registry. */
  logosDependencies?: { registry?: string };
  cors?: boolean | Record<string, any>;
  /** Extra express middleware run before package routers. */
  middleware?: Function[];

  /** @deprecated removed in v2 — accepted with a warning, ignored. */
  atomic?: any;
  /** @deprecated removed in v2 — accepted with a warning, ignored. */
  docker?: any;

  [key: string]: any;
}

export interface RuntimeContext {
  req?: any;
  res?: any;
  ws?: any;
  pkg?: any;
  sessionId?: string;
  [key: string]: any;
}

export interface RegisteredTool {
  name: string;
  description: string | null;
  inputSchema: any;
  condition: any;
  handler: (args: any, context?: RuntimeContext) => Promise<any>;
}

export interface LogosInstance {
  app: any;
  server: any;
  container: any;
  stabilizer: any;
  mcp: any;
  bus: any;
  workers: import('./kernel/cpu-pool').CpuWorkerPool | null;
  workspace: string;
  close(): Promise<void>;
}
