export declare class CheckpointStore {
    workspace: string;
    private logosDir;
    private gitDir;
    private stateFile;
    private mode;
    constructor(workspace: string);
    private git;
    private gitAvailable;
    private initShadow;
    private readState;
    private writeState;
    /** Records a stable checkpoint. pkg = null means "whole workspace stable". */
    commitStable(pkg: string | null, reason?: string): string | null;
    private prune;
    lastStable(pkg: string | null): {
        ref: string;
        ts: number;
        mode: string;
    } | null;
    /** Restores one package to its last stable checkpoint. Returns the diff (git mode). */
    rollbackPackage(pkg: string): {
        ok: boolean;
        diff?: string;
        ts?: number;
    };
    /** Restores the whole workspace (crash-loop recovery). */
    rollbackWorkspace(): {
        ok: boolean;
        ts?: number;
    };
    snapshotDatabase(pkg: string): string | null;
    restoreDatabase(pkg: string): {
        ok: boolean;
        ts?: number;
    };
}
