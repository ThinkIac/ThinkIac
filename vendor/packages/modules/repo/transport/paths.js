// External repo transport — where the auto-repository keeps its things.
//
// Everything lives under <project>/.logos, next to `packages/`:
//
//   .logos/repo.git/          bare repository the SSH server serves
//   .logos/authorized_keys    public keys allowed to clone/push
//   .logos/ssh_host_key       host key, generated on first boot
//   .logos/worktrees/<slug>/  checkout of an ephemeral branch (transient)
//   .logos/branches.json      registry of live branch instances
//
// The project root is the parent of the workspace (the folder holding
// `packages/`), which is how every other module locates project-level files.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.repoPaths = repoPaths;
exports.slugify = slugify;
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
function repoPaths(workspace) {
    const root = path_1.default.dirname(workspace);
    const home = path_1.default.join(root, '.logos');
    return {
        root,
        home,
        gitDir: path_1.default.join(home, 'repo.git'),
        authorizedKeys: path_1.default.join(home, 'authorized_keys'),
        hostKey: path_1.default.join(home, 'ssh_host_key'),
        worktrees: path_1.default.join(home, 'worktrees'),
        registry: path_1.default.join(home, 'branches.json'),
    };
}
/**
 * A branch name is not URL- or hostname-safe (`feature/x`, `fix_ç`). The slug
 * is what appears in `/@<slug>/`, in `<slug>.host`, and as the worktree
 * directory name; `branchFromSlug` on the registry maps it back.
 */
function slugify(branch) {
    const readable = branch
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // "ção" → "cao", not "-o-"
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'branch';
    // The readable portion alone is not an identity: feature/a and feature-a
    // used to share a worktree and could be routed to one another. Keep URLs
    // friendly while making the mapping injective for practical Git ref names.
    const suffix = crypto_1.default.createHash('sha256').update(branch).digest('hex').slice(0, 8);
    return `${readable}-${suffix}`;
}
//# sourceMappingURL=paths.js.map
