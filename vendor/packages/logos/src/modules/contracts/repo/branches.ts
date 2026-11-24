import { RepoPaths } from './paths';
export type BranchStatus = 'booting' | 'live' | 'stopping' | 'failed';
export interface BranchInstance {
    branch: string;
    slug: string;
    port: number;
    pid: number | null;
    dir: string;
    status: BranchStatus;
    sha: string | null;
    startedAt: number;
    lastHit: number;
    /** Requests currently in flight through the proxy (a reaper veto). */
    inFlight: number;
    error?: string;
    /** Tail of the child's stdout/stderr, for the admin view. */
    output: string[];
}
export interface BranchesConfig {
    /** Inclusive port range for ephemeral instances. */
    ports: [number, number];
    /** Milliseconds without a hit before an instance is reaped. */
    idleTTLms: number;
    /** Hard cap on simultaneous instances; the least-recently-used is evicted. */
    max: number;
    /** How long to wait for /__health before giving up. */
    bootTimeoutMs: number;
    /** Entry script; defaults to the file that started this runtime. */
    entry?: string;
    runner?: {
        command: string;
        args: string[];
    };
    /** empty = fresh; clone = copy each package's .database. */
    db: 'empty' | 'clone' | 'shared';
    /** Always false: branch worktrees never receive .env files. */
    secrets: boolean;
    /** Environment variables passed through to instances. */
    envAllow: string[];
    /** Always false: branch runners never inherit the parent environment. */
    envInherit: boolean;
}
export interface BranchManagerOptions {
    paths: RepoPaths;
    config: BranchesConfig;
    workspaceDirName: string;
    log: (msg: string) => void;
    emit: (event: string, payload: any) => void;
}
export declare class BranchManager {
    private instances;
    private children;
    private booting;
    private reaper;
    private opts;
    constructor(opts: BranchManagerOptions);
    private get paths();
    private get config();
    list(): BranchInstance[];
    get(slug: string): BranchInstance | null;
    /** Marks an instance as in use — this is what keeps the reaper away. */
    touch(slug: string): void;
    hold(slug: string): void;
    release(slug: string): void;
    /**
     * Returns a live instance for `branch`, booting one if needed. Concurrent
     * callers during a cold start share the same boot promise, so a burst of
     * requests spawns exactly one process.
     */
    ensure(branch: string): Promise<BranchInstance>;
    private boot;
    /** git worktree + node_modules + optional database/secrets. */
    private materialise;
    /** Databases and .env files, according to policy. */
    private provisionData;
    private resolveEntry;
    private buildEnv;
    private spawnRuntime;
    private waitForHealth;
    stop(slug: string, reason: string): Promise<boolean>;
    private cleanupWorktree;
    stopAll(reason: string): Promise<void>;
    startReaper(intervalMs?: number): void;
    stopReaper(): void;
    /** Reaps every instance that is idle, quiet and not serving anything. */
    sweep(): Promise<string[]>;
    private enforceCap;
    private allocatePort;
    private persist;
    /**
     * A previous runtime may have been killed without reaping its children.
     * Their pids are in branches.json; they are not our children any more, so
     * signal them directly and clear the worktrees they left behind.
     */
    private recoverOrphans;
}
