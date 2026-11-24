export interface RepoPaths {
    /** Project root — parent of the packages/ workspace. */
    root: string;
    /** <root>/.logos */
    home: string;
    /** Bare repository. */
    gitDir: string;
    authorizedKeys: string;
    hostKey: string;
    worktrees: string;
    registry: string;
}
export declare function repoPaths(workspace: string): RepoPaths;
/**
 * A branch name is not URL- or hostname-safe (`feature/x`, `fix_ç`). The slug
 * is what appears in `/@<slug>/`, in `<slug>.host`, and as the worktree
 * directory name; `branchFromSlug` on the registry maps it back.
 */
export declare function slugify(branch: string): string;
