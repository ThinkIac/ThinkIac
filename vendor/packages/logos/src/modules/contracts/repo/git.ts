import { RepoPaths } from './paths';
export interface GitResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    code: number | null;
}
export declare function git(gitDir: string, args: string[], opts?: {
    workTree?: string;
    cwd?: string;
    input?: string;
    env?: NodeJS.ProcessEnv;
}): GitResult;
export declare function gitAvailable(): boolean;
export interface HookConfig {
    mainBranch: string;
    /** Where post-receive calls the runtime back. */
    hookUrl: string;
    /** Shared secret proving the call came from our own hook. */
    secret: string;
}
/**
 * Creates the bare repository if absent and makes sure it has a first commit
 * (seeded from whatever is already in the project root). Idempotent.
 */
export declare function ensureRepo(paths: RepoPaths, mainBranch: string, log: (msg: string) => void): {
    created: boolean;
    seeded: boolean;
};
export declare function hasCommits(gitDir: string, branch: string): boolean;
export declare function writeHooks(paths: RepoPaths, cfg: HookConfig & {
    timeoutMs?: number;
}): void;
export interface BranchRef {
    branch: string;
    sha: string;
    subject: string;
    author: string;
    committedAt: string;
}
export declare function listBranches(gitDir: string): BranchRef[];
export declare function commitLog(gitDir: string, ref: string, limit?: number): Array<{
    sha: string;
    subject: string;
    author: string;
    date: string;
}>;
/** Paths touched between two revisions, relative to the repository root. */
export declare function changedPaths(gitDir: string, oldSha: string, newSha: string): string[];
/** Workspace package folders touched by a set of repository-relative paths. */
export declare function changedPackages(paths: string[], workspaceDirName: string): string[];
/** Materialises `branch` into the project root (the live work tree). */
export declare function checkoutInto(paths: RepoPaths, branch: string): GitResult;
/**
 * Everything in the work tree that differs from the deployed commit.
 *
 * A Lógos work tree is not a passive checkout: agents rewrite packages while
 * the runtime is running, and someone may well have edited a file on the box.
 * `checkout -f` would delete all of that without a word.
 */
export declare function workTreeDirty(paths: RepoPaths): string[];
/**
 * Commits the current work tree to a ref nobody checks out
 * (`refs/logos/worktree/<timestamp>`) so a deploy can overwrite it without
 * destroying anything. Returns the sha, or null when there was nothing to
 * save. Recover with:
 *
 *   git --git-dir=.logos/repo.git show <sha>:packages/foo/routes.js
 */
export declare function backupWorkTree(paths: RepoPaths, reason: string): string | null;
export declare function updateRef(gitDir: string, ref: string, sha: string): GitResult;
export declare function addWorktree(paths: RepoPaths, dir: string, branch: string): GitResult;
export declare function removeWorktree(paths: RepoPaths, dir: string): GitResult;
export declare function pruneWorktrees(paths: RepoPaths): void;
