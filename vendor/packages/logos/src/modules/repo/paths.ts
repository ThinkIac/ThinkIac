// modules/repo/paths.ts — where the auto-repository keeps its things.
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

import path from 'path';
import crypto from 'crypto';

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

export function repoPaths(workspace: string): RepoPaths {
  const root = path.dirname(workspace);
  const home = path.join(root, '.logos');
  return {
    root,
    home,
    gitDir: path.join(home, 'repo.git'),
    authorizedKeys: path.join(home, 'authorized_keys'),
    hostKey: path.join(home, 'ssh_host_key'),
    worktrees: path.join(home, 'worktrees'),
    registry: path.join(home, 'branches.json'),
  };
}

/**
 * A branch name is not URL- or hostname-safe (`feature/x`, `fix_ç`). The slug
 * is what appears in `/@<slug>/`, in `<slug>.host`, and as the worktree
 * directory name; `branchFromSlug` on the registry maps it back.
 */
export function slugify(branch: string): string {
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
  const suffix = crypto.createHash('sha256').update(branch).digest('hex').slice(0, 8);
  return `${readable}-${suffix}`;
}

