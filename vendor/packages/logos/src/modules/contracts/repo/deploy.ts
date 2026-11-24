import { RepoPaths } from './paths';
export type DeployMode = 'stabilize' | 'restart' | 'checkout' | 'off';
export interface DeployRef {
    oldSha: string;
    newSha: string;
    ref: string;
}
export interface DeployResult {
    ok: boolean;
    /** Lines relayed to the pusher's terminal by the post-receive hook. */
    messages: string[];
    packages: Array<{
        pkg: string;
        ok: boolean;
        error?: string;
        rolledBack?: boolean;
    }>;
    files: string[];
    restartRequired: boolean;
    reverted: boolean;
}
export interface DeployContext {
    paths: RepoPaths;
    workspaceDirName: string;
    mainBranch: string;
    mode: DeployMode;
    stabilizer: any;
    log: (msg: string) => void;
    emit: (event: string, payload: any) => void;
}
export declare function deployMain(ctx: DeployContext, push: DeployRef): Promise<DeployResult>;
/** Refs that are not main: stored, never deployed. */
export declare function describeBranchPush(ctx: DeployContext, push: DeployRef): string;
