// modules/repo/deploy.ts — what `git push logos main` actually does.
//
// Nothing restarts. The refs land, the work tree is updated in place, and
// every touched package goes through the stabilizer that already guards
// human and agent edits: staged in a ghost router, health-checked, swapped
// atomically, rolled back to the last checkpoint if it misbehaves.
//
// If the deploy fails, the branch ref is moved back to where it was. The push
// itself already succeeded from git's point of view (post-receive runs after
// the ref update), so the pusher is told in plain words that the ref was
// reverted and that the previous code is still serving.
//
// Files outside packages/ (server.js, root config) cannot be hot-swapped by
// anyone; they are reported as needing a restart rather than pretended away.

'use strict';

import { RepoPaths } from './paths';
import { changedPaths, changedPackages, checkoutInto, updateRef, git, workTreeDirty, backupWorkTree } from './git';

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
  packages: Array<{ pkg: string; ok: boolean; error?: string; rolledBack?: boolean }>;
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

export async function deployMain(ctx: DeployContext, push: DeployRef): Promise<DeployResult> {
  const result: DeployResult = {
    ok: true, messages: [], packages: [], files: [], restartRequired: false, reverted: false,
  };

  if (ctx.mode === 'off') {
    result.messages.push('refs stored; automatic deploy is off (repo.main.onPush = "off")');
    return result;
  }

  result.files = changedPaths(ctx.paths.gitDir, push.oldSha, push.newSha);
  const folders = changedPackages(result.files, ctx.workspaceDirName);
  const outsideWorkspace = result.files.filter(f => !f.startsWith(`${ctx.workspaceDirName}/`));

  // 1. Materialise the new code in the live work tree.
  //
  // The work tree is live: an agent may have rewritten a package minutes ago
  // and a human may have edited a file on the box. `checkout -f` deletes all
  // of it. So anything uncommitted is first parked on a ref of its own — the
  // deploy still wins, but nothing is lost silently and the pusher is told
  // where the old state went.
  const dirty = workTreeDirty(ctx.paths);
  if (dirty.length) {
    const backup = backupWorkTree(ctx.paths, `deploy of ${push.newSha.slice(0, 8)}`);
    if (backup) {
      result.messages.push(
        `${dirty.length} uncommitted file(s) in the work tree saved as ${backup.slice(0, 8)} ` +
        `(git --git-dir=.logos/repo.git show ${backup.slice(0, 8)}:<path>)`);
      ctx.emit('repo:worktree:backed_up', { sha: backup, files: dirty });
    } else {
      result.messages.push(`WARNING: ${dirty.length} uncommitted file(s) could not be saved and will be overwritten`);
    }
    ctx.log(`[repo] work tree had ${dirty.length} uncommitted file(s) — parked at ${backup?.slice(0, 8) ?? 'nowhere'}`);
  }

  const checkout = checkoutInto(ctx.paths, ctx.mainBranch);
  if (!checkout.ok) {
    revert(ctx, push, result, `checkout failed: ${checkout.stderr || checkout.stdout}`);
    return result;
  }
  ctx.log(`[repo] ${ctx.mainBranch} → ${push.newSha.slice(0, 8)} (${result.files.length} file(s), ${folders.length} package(s))`);
  ctx.emit('repo:deploy:started', { sha: push.newSha, files: result.files, packages: folders });

  if (ctx.mode === 'checkout') {
    result.messages.push(`work tree updated to ${push.newSha.slice(0, 8)} — nothing reloaded (repo.main.onPush = "checkout")`);
    return result;
  }

  if (ctx.mode === 'restart') {
    result.messages.push(`work tree updated to ${push.newSha.slice(0, 8)} — restarting the runtime`);
    result.restartRequired = true;
    ctx.emit('repo:deploy:restarting', { sha: push.newSha });
    return result;
  }

  // 2. Stabilize each touched package. The stabilizer owns rollback per
  //    package; we only decide what the push as a whole is worth.
  for (const folder of folders) {
    try {
      const commit = await ctx.stabilizer.commit(folder, 'git-push');
      if (commit?.ok) {
        result.packages.push({ pkg: folder, ok: true });
        result.messages.push(`✓ ${folder} reloaded`);
      } else {
        result.ok = false;
        result.packages.push({ pkg: folder, ok: false, error: commit?.error, rolledBack: !!commit?.rolledBack });
        result.messages.push(`✗ ${folder}: ${commit?.error ?? 'staging refused the new version'}`);
      }
    } catch (err: any) {
      result.ok = false;
      result.packages.push({ pkg: folder, ok: false, error: err.message });
      result.messages.push(`✗ ${folder}: ${err.message}`);
    }
  }

  if (!folders.length) {
    result.messages.push('no package touched — nothing to reload');
  }

  if (outsideWorkspace.length) {
    result.restartRequired = true;
    result.messages.push(
      `${outsideWorkspace.length} file(s) outside ${ctx.workspaceDirName}/ changed ` +
      `(${outsideWorkspace.slice(0, 3).join(', ')}${outsideWorkspace.length > 3 ? ', …' : ''}) — these need a restart`);
  }

  // 3. A failed package means the pushed commit is not what is serving.
  //    Move the ref back so the repository keeps telling the truth.
  if (!result.ok) {
    revert(ctx, push, result, 'one or more packages failed to load');
    return result;
  }

  result.messages.push(`deployed ${push.newSha.slice(0, 8)}`);
  ctx.emit('repo:deploy:ok', { sha: push.newSha, packages: folders, restartRequired: result.restartRequired });
  return result;
}

function revert(ctx: DeployContext, push: DeployRef, result: DeployResult, reason: string): void {
  result.ok = false;
  result.messages.push(`deploy refused: ${reason}`);

  const zero = /^0+$/.test(push.oldSha || '');
  if (zero) {
    result.messages.push('first push on this branch — nothing to revert to; the runtime kept its previous code');
    ctx.emit('repo:deploy:failed', { sha: push.newSha, reason, reverted: false });
    return;
  }

  const back = updateRef(ctx.paths.gitDir, push.ref, push.oldSha);
  if (back.ok) {
    const restored = checkoutInto(ctx.paths, ctx.mainBranch);
    result.reverted = true;
    result.messages.push(`${ctx.mainBranch} moved back to ${push.oldSha.slice(0, 8)} — pull before pushing again`);
    if (!restored.ok) {
      result.messages.push(`WARNING: work tree could not be restored: ${restored.stderr}`);
    } else {
      // Re-stage the restored code so the process serves what the ref says.
      for (const entry of result.packages) {
        ctx.stabilizer.commit(entry.pkg, 'git-revert').catch(() => { /* checkpoint rollback already covers this */ });
      }
    }
  } else {
    result.messages.push(`WARNING: could not move ${ctx.mainBranch} back: ${back.stderr}`);
  }
  ctx.log(`[repo] deploy refused (${reason})`);
  ctx.emit('repo:deploy:failed', { sha: push.newSha, reason, reverted: result.reverted });
}

/** Refs that are not main: stored, never deployed. */
export function describeBranchPush(ctx: DeployContext, push: DeployRef): string {
  const branch = push.ref.replace(/^refs\/heads\//, '');
  if (/^0+$/.test(push.newSha)) return `branch "${branch}" deleted`;
  const subject = git(ctx.paths.gitDir, ['log', '-1', '--format=%s', push.newSha]).stdout;
  return `branch "${branch}" stored (${push.newSha.slice(0, 8)}${subject ? ` — ${subject}` : ''}); it boots on first request`;
}

