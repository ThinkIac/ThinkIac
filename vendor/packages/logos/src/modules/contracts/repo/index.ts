import { Container, LogosModule } from '../../../kernel/container';
import { RepoPaths } from './paths';
import { SshServerHandle } from './ssh';
import { BranchManager, BranchesConfig } from './branches';
import { DeployMode } from './deploy';
import { ExposeMode } from './proxy';
export interface RepoRuntimeConfig {
    enabled: boolean;
    admin: {
        token: string;
    };
    ssh: {
        enabled: boolean;
        port: number;
        host: string;
        delegationPublicKey: string;
        machineCode: string;
    };
    main: {
        branch: string;
        onPush: DeployMode;
    };
    branches: BranchesConfig & {
        enabled: boolean;
        expose: ExposeMode;
    };
    hookTimeoutMs: number;
}
/** '10m' / '45s' / 90000 → milliseconds. */
export declare function parseDuration(value: string | number | undefined, fallback: number): number;
export declare function normalizeConfig(raw: any): RepoRuntimeConfig;
/** Constant-time comparison for the private control-plane HTTP surface. */
export declare function isAuthorizedAdminRequest(req: any, token: string): boolean;
export interface RepoState {
    config: RepoRuntimeConfig;
    paths: RepoPaths;
    branches: BranchManager | null;
    ssh: SshServerHandle | null;
    secret: string;
    /** Branch names known to git, refreshed on push and on demand. */
    knownBranches(): string[];
    close(): Promise<void>;
}
export declare function isBranchInstance(): boolean;
export declare function getRepoState(container: Container): RepoState | null;
export declare const repoModule: LogosModule;
export { repoPaths, slugify } from './paths';
export type { BranchInstance } from './branches';
