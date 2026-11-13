// modules/repo — the auto-repository.
//
// Turns a Lógos project into its own git host, with one long-lived branch and
// as many ephemeral ones as somebody happens to be looking at:
//
//   • SSH endpoint (ssh.ts)        git clone ssh://logos@host:2222/project
//   • main = the running runtime   a push is checked out in place and handed
//     (deploy.ts)                  to the stabilizer — staged, health-checked,
//                                  rolled back on failure, never restarted
//   • every other branch is inert  until requested; then it gets a worktree,
//     (branches.ts)                a port and a process, and is reaped when
//                                  nobody has touched it for idleTTL
//
// Enable it from bootstrap():
//
//   bootstrap({
//     repo: true,                                   // defaults for everything
//     repo: {                                       // …or spell it out
//       ssh:      { port: 2222 },
//       main:     { branch: 'main', onPush: 'stabilize' },
//       branches: { ports: [5100, 5199], idleTTL: '10m', expose: 'path' },
//     },
//   })
//
// A branch instance runs the same entry script with LOGOS_ROLE=branch, which
// keeps this module dormant inside it: no nested SSH server, no nested
// branches, and the port comes from the parent instead of the config.

'use strict';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Container, LogosModule } from '../../kernel/container';
import { repoPaths, slugify, RepoPaths } from './paths';
import { ensureRepo, writeHooks, listBranches, commitLog, gitAvailable, git } from './git';
import { loadAuthorizedKeys, appendAuthorizedKey, KeyRole } from './keys';
import { startSshServer, SshServerHandle } from './ssh';
import { BranchManager, BranchesConfig } from './branches';
import { deployMain, describeBranchPush, DeployMode, DeployRef } from './deploy';
import { resolveTarget, proxyRequest, installUpgradeProxy, ExposeMode } from './proxy';

export interface RepoRuntimeConfig {
  enabled: boolean;
  admin: { token: string };
  ssh: { enabled: boolean; port: number; host: string; delegationPublicKey: string; machineCode: string };
  main: { branch: string; onPush: DeployMode };
  branches: BranchesConfig & { enabled: boolean; expose: ExposeMode };
  hookTimeoutMs: number;
}

const DEFAULTS: RepoRuntimeConfig = {
  enabled: false,
  admin: { token: '' },
  ssh: { enabled: true, port: 2222, host: '0.0.0.0', delegationPublicKey: '', machineCode: '' },
  main: { branch: 'main', onPush: 'stabilize' },
  branches: {
    enabled: true,
    expose: 'path',
    ports: [5100, 5199],
    idleTTLms: 10 * 60_000,
    max: 8,
    bootTimeoutMs: 45_000,
    db: 'empty',
    secrets: false,
    envAllow: [],
    envInherit: false,
  },
  hookTimeoutMs: 180_000,
};

/** '10m' / '45s' / 90000 → milliseconds. */
export function parseDuration(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number') return value;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(String(value).trim());
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  return Math.round(amount * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000 })[unit]);
}

export function normalizeConfig(raw: any): RepoRuntimeConfig {
  if (raw === undefined || raw === null || raw === false) return { ...DEFAULTS, enabled: false };
  const input = raw === true ? {} : raw;

  return {
    enabled: input.enabled !== false,
    admin: { token: typeof input.admin?.token === 'string' ? input.admin.token : '' },
    ssh: {
      enabled: input.ssh?.enabled !== false,
      port: input.ssh?.port ?? DEFAULTS.ssh.port,
      host: input.ssh?.host ?? DEFAULTS.ssh.host,
      delegationPublicKey: typeof input.ssh?.delegationPublicKey === 'string' ? input.ssh.delegationPublicKey : '',
      machineCode: typeof input.ssh?.machineCode === 'string' ? input.ssh.machineCode : '',
    },
    main: {
      branch: input.main?.branch ?? DEFAULTS.main.branch,
      onPush: input.main?.onPush ?? DEFAULTS.main.onPush,
    },
    branches: {
      enabled: input.branches?.enabled !== false,
      expose: input.branches?.expose ?? DEFAULTS.branches.expose,
      ports: input.branches?.ports ?? DEFAULTS.branches.ports,
      idleTTLms: parseDuration(input.branches?.idleTTL, DEFAULTS.branches.idleTTLms),
      max: input.branches?.max ?? DEFAULTS.branches.max,
      bootTimeoutMs: parseDuration(input.branches?.bootTimeout, DEFAULTS.branches.bootTimeoutMs),
      entry: input.branches?.entry,
      runner: typeof input.branches?.runner?.command === 'string' && input.branches.runner.command
        ? { command: input.branches.runner.command, args: Array.isArray(input.branches.runner.args) ? input.branches.runner.args.map(String) : [] }
        : undefined,
      // Previews are untrusted. A runner may receive a cloned fixture DB, but
      // it never receives live databases, .env files, or the parent env.
      db: input.branches?.db === 'clone' ? 'clone' : 'empty',
      secrets: false,
      envAllow: input.branches?.env?.allow ?? [],
      envInherit: false,
    },
    hookTimeoutMs: parseDuration(input.hookTimeout, DEFAULTS.hookTimeoutMs),
  };
}

/** Constant-time comparison for the private control-plane HTTP surface. */
export function isAuthorizedAdminRequest(req: any, token: string): boolean {
  const supplied = String(req.get?.('x-logos-repo-token') || req.headers?.authorization?.replace(/^Bearer\s+/i, '') || '');
  if (!token || !supplied) return false;
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

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

function hookSecret(paths: RepoPaths): string {
  const file = path.join(paths.home, 'hook-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8').trim();
  const secret = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(paths.home, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function adminToken(paths: RepoPaths, configured: string): string {
  if (configured) return configured;
  const file = path.join(paths.home, 'admin-token');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8').trim();
  const token = crypto.randomBytes(32).toString('base64url');
  fs.mkdirSync(paths.home, { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

export function isBranchInstance(): boolean {
  return process.env.LOGOS_ROLE === 'branch';
}

export function getRepoState(container: Container): RepoState | null {
  return container.state('repo').get('state') ?? null;
}

// ── Module ──────────────────────────────────────────────────────────────────

export const repoModule: LogosModule = {
  name: 'repo',
  phase: 'wire',
  after: ['http', 'tools'],
  install(container: Container) {
    // ── Dormant mode: we are an ephemeral branch of somebody else ──────────
    if (isBranchInstance()) {
      const port = Number(process.env.LOGOS_PORT || process.env.PORT);
      if (Number.isFinite(port) && port > 0) {
        // container.config is the very object bootstrap() reads the port from,
        // so this wins over whatever the project hardcoded — an ephemeral
        // branch must never fight the parent for a port.
        container.config.port = port;
      }
      container.log(`[repo] branch instance "${process.env.LOGOS_BRANCH}" — repo module dormant`);
      return;
    }

    const config = normalizeConfig(container.config?.repo);
    if (!config.enabled) return;

    if (!gitAvailable()) {
      container.log('[repo] git is not installed — the auto-repository is disabled');
      return;
    }

    // Hosting a repository is a feature of the runtime, never a precondition
    // for it: anything that goes wrong here turns the feature off and leaves
    // the application booting.
    try {
      setup(container, config);
    } catch (err: any) {
      container.log(`[repo] disabled: ${err.message}`);
    }
  },
};

function setup(container: Container, config: RepoRuntimeConfig): void {
  {
    const paths = repoPaths(container.workspace);
    const workspaceDirName = path.basename(container.workspace);
    const log = (msg: string) => container.log(msg);
    const emit = (event: string, payload: any) => { container.bus.emit(event, payload); };

    ensureRepo(paths, config.main.branch, log);
    if (!fs.existsSync(paths.authorizedKeys)) {
      fs.writeFileSync(paths.authorizedKeys,
        '# One public key per line (OpenSSH format).\n' +
        '# Optional role prefix: logos-role=main|branch|read (default main).\n' +
        '#   logos-role=branch ssh-ed25519 AAAA… alice@laptop\n', { mode: 0o600 });
    }

    const secret = hookSecret(paths);
    config.admin.token = adminToken(paths, config.admin.token);
    const branches = config.branches.enabled
      ? new BranchManager({ paths, config: config.branches, workspaceDirName, log, emit })
      : null;

    const knownBranches = () => listBranches(paths.gitDir).map(b => b.branch);
    const state: RepoState = {
      config, paths, branches, secret, knownBranches,
      ssh: null,
      async close() {
        branches?.stopReaper();
        await branches?.stopAll('runtime-closing');
        await state.ssh?.close();
      },
    };
    container.state('repo').set('state', state);

    mountProxy(container, state);
    mountRoutes(container, state);
    registerRepoTools(container, state);
    registerBusApi(container, state);

    branches?.startReaper();

    // The callback URL is only knowable once we have a port, and the SSH
    // server should not accept pushes before the runtime can answer them.
    container.bus.on('runtime:ready', async (payload: any) => {
      const port = payload?.port ?? container.config?.port ?? 5040;
      writeHooks(paths, {
        mainBranch: config.main.branch,
        hookUrl: `http://127.0.0.1:${port}/_logos/repo/hook`,
        secret,
        timeoutMs: config.hookTimeoutMs,
      });

      if (config.ssh.enabled) {
        try {
          state.ssh = await startSshServer({
            paths,
            port: config.ssh.port,
            host: config.ssh.host,
            banner: 'Lógos auto-repository — git only.',
            delegationPublicKey: config.ssh.delegationPublicKey,
            machineCode: config.ssh.machineCode,
            log,
            onSession: info => emit('repo:ssh:session', info),
          });
          if (state.ssh) {
            const keys = loadAuthorizedKeys(paths.authorizedKeys).length;
            container.log(
              `[repo] git over SSH on port ${config.ssh.port} — ` +
              `${keys} key(s) authorized, host ${state.ssh.fingerprint}`);
            if (!keys) container.log('[repo] no keys yet: add one to .logos/authorized_keys or POST /_logos/repo/keys');
          }
        } catch (err: any) {
          container.log(`[repo] SSH endpoint failed on port ${config.ssh.port}: ${err.message}`);
        }
      }
    }, { priority: 40 });

    installShutdownHooks(state, log);
  }
}

// ── Proxy ───────────────────────────────────────────────────────────────────

function mountProxy(container: Container, state: RepoState): void {
  const { branches, config } = state;
  if (!branches || config.branches.expose === 'port-only') return;

  const knownSlug = (slug: string) => state.knownBranches().some(b => slugify(b) === slug);
  const branchOf = (slug: string) => state.knownBranches().find(b => slugify(b) === slug) ?? null;

  container.app.use(async (req: any, res: any, next: any) => {
    const target = resolveTarget(config.branches.expose, req.originalUrl || req.url, req.headers.host, knownSlug);
    if (!target) return next();

    const branch = branchOf(target.slug);
    if (!branch) return next();
    if (branch === config.main.branch) return next(); // main is this very process

    let instance;
    try {
      instance = await branches.ensure(branch);
    } catch (err: any) {
      res.status(503).json({ error: `branch "${branch}" could not start`, detail: err.message });
      return;
    }

    branches.hold(target.slug);
    proxyRequest(instance.port, target.path, req, res, () => branches.release(target.slug));
  });

  // WebSocket upgrades need the raw server, which only exists after wiring.
  container.bus.on('runtime:ready', () => {
    if (!container.server) return;
    installUpgradeProxy(
      container.server,
      req => {
        const target = resolveTarget(config.branches.expose, req.url || '/', req.headers.host, knownSlug);
        if (!target) return null;
        const instance = branches.get(target.slug);
        // Only an already-live branch is proxied here: a WebSocket handshake
        // is a bad place to pay for a cold start, and the page that opened it
        // came through the HTTP proxy anyway.
        if (!instance || instance.status !== 'live') return null;
        return { port: instance.port, path: target.path, slug: target.slug };
      },
      slug => branches.hold(slug),
      slug => branches.release(slug),
    );
  }, { priority: 30 });
}

// ── HTTP surface ────────────────────────────────────────────────────────────

function mountRoutes(container: Container, state: RepoState): void {
  const app = container.app;
  const { paths, config, branches } = state;
  const requireAdmin = (req: any, res: any): boolean => {
    if (isAuthorizedAdminRequest(req, config.admin.token)) return true;
    res.status(401).json({ error: 'repo admin authentication required' });
    return false;
  };

  // The post-receive hook calls this. Loopback + shared secret; it deploys.
  app.post('/_logos/repo/hook', async (req: any, res: any) => {
    if (req.body?.secret !== state.secret) return res.status(403).json({ messages: ['bad hook secret'] });

    const refs: DeployRef[] = Array.isArray(req.body?.refs) ? req.body.refs : [];
    const messages: string[] = [];
    let restart = false;

    for (const push of refs) {
      const branch = push.ref?.replace(/^refs\/heads\//, '') ?? '';
      const ctx = {
        paths,
        workspaceDirName: path.basename(container.workspace),
        mainBranch: config.main.branch,
        mode: config.main.onPush,
        stabilizer: container.state('runtime').get('stabilizer'),
        log: (msg: string) => container.log(msg),
        emit: (event: string, payload: any) => { container.bus.emit(event, payload); },
      };

      if (!push.ref?.startsWith('refs/heads/')) {
        messages.push(`${push.ref} stored`);
        continue;
      }

      if (branch === config.main.branch) {
        const result = await deployMain(ctx, push);
        messages.push(...result.messages);
        restart = restart || (result.restartRequired && config.main.onPush === 'restart');
      } else {
        messages.push(describeBranchPush(ctx, push));
        // A branch that is live right now is serving stale code — drop it so
        // the next request boots the version that was just pushed.
        const slug = slugify(branch);
        if (branches?.get(slug)) {
          await branches.stop(slug, 'branch-updated');
          messages.push(`live instance of "${branch}" recycled`);
        }
      }
    }

    res.json({ ok: true, messages });

    if (restart) {
      container.log('[repo] restarting after push (repo.main.onPush = "restart")');
      setTimeout(() => process.exit(0), 500).unref?.();
    }
  });

  app.get('/_logos/repo/status', (req: any, res: any) => {
    if (requireAdmin(req, res)) res.json(repoStatus(container, state));
  });

  app.get('/_logos/repo/branches', (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    res.json({
    branches: listBranches(paths.gitDir).map(ref => {
      const slug = slugify(ref.branch);
      const instance = branches?.get(slug) ?? null;
      return {
        ...ref,
        slug,
        isMain: ref.branch === config.main.branch,
        instance: instance && {
          status: instance.status, port: instance.port, pid: instance.pid,
          startedAt: instance.startedAt, lastHit: instance.lastHit, error: instance.error ?? null,
        },
      };
    }),
    });
  });

  app.post('/_logos/repo/branches/:slug/up', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    const branch = state.knownBranches().find(b => slugify(b) === req.params.slug);
    if (!branch) return res.status(404).json({ error: `no branch matches "${req.params.slug}"` });
    if (!branches) return res.status(409).json({ error: 'ephemeral branches are disabled' });
    if (branch === config.main.branch) return res.status(409).json({ error: 'main is this runtime; it is already up' });
    try {
      const instance = await branches.ensure(branch);
      res.json({ ok: true, branch, slug: instance.slug, port: instance.port, url: `http://localhost:${instance.port}` });
    } catch (err: any) {
      res.status(502).json({ error: err.message, output: branches.get(slugify(branch))?.output ?? [] });
    }
  });

  app.post('/_logos/repo/branches/:slug/down', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    const stopped = await branches?.stop(req.params.slug, 'requested');
    res.status(stopped ? 200 : 404).json({ ok: !!stopped });
  });

  app.get('/_logos/repo/log', (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    const ref = String(req.query.branch || config.main.branch);
    res.json({ ref, commits: commitLog(paths.gitDir, ref, Number(req.query.limit) || 20) });
  });

  app.get('/_logos/repo/keys', (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    res.json({
    keys: loadAuthorizedKeys(paths.authorizedKeys).map(k => ({
      type: k.type, comment: k.comment, role: k.role,
      fingerprint: `SHA256:${crypto.createHash('sha256').update(k.blob).digest('base64').replace(/=+$/, '')}`,
    })),
    });
  });

  app.post('/_logos/repo/keys', (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    const line = String(req.body?.key || '').trim();
    const role = (req.body?.role || 'main') as KeyRole;
    if (!line) return res.status(400).json({ error: 'body.key is required (an OpenSSH public key line)' });
    const added = appendAuthorizedKey(paths.authorizedKeys, line, role);
    if (!added) return res.status(400).json({ error: 'not a valid OpenSSH public key' });
    container.log(`[repo] key authorized: ${added.comment || added.type} (${role})`);
    res.json({ ok: true, type: added.type, comment: added.comment, role });
  });
}

function repoStatus(container: Container, state: RepoState): any {
  const { paths, config, branches } = state;
  const head = git(paths.gitDir, ['rev-parse', config.main.branch]);
  return {
    enabled: true,
    gitDir: paths.gitDir,
    main: {
      branch: config.main.branch,
      sha: head.ok ? head.stdout : null,
      onPush: config.main.onPush,
    },
    ssh: state.ssh
      ? { listening: true, port: state.ssh.port, fingerprint: state.ssh.fingerprint, keys: loadAuthorizedKeys(paths.authorizedKeys).length }
      : { listening: false, port: config.ssh.port, reason: config.ssh.enabled ? 'not started' : 'disabled' },
    branches: {
      enabled: !!branches,
      expose: config.branches.expose,
      ports: config.branches.ports,
      idleTTLms: config.branches.idleTTLms,
      max: config.branches.max,
      live: branches?.list().map(i => ({
        branch: i.branch, slug: i.slug, port: i.port, pid: i.pid, status: i.status,
        idleMs: Date.now() - i.lastHit, inFlight: i.inFlight, error: i.error ?? null,
      })) ?? [],
    },
    clone: `ssh://logos@<host>:${config.ssh.port}/${path.basename(paths.root)}`,
  };
}

// ── Bus + tools ─────────────────────────────────────────────────────────────

function registerBusApi(container: Container, state: RepoState): void {
  container.bus.on('repo:branch:open', async (payload: any) => {
    if (!state.branches) return { ok: false, error: 'ephemeral branches are disabled' };
    const branch = payload?.branch;
    if (!branch) return { ok: false, error: 'missing branch' };
    const instance = await state.branches.ensure(branch);
    return { ok: true, port: instance.port, slug: instance.slug, url: `http://localhost:${instance.port}` };
  }, { priority: 50 });

  container.bus.on('repo:branch:close', async (payload: any) => {
    if (!state.branches) return { ok: false };
    return { ok: await state.branches.stop(slugify(payload?.branch ?? ''), 'bus-request') };
  }, { priority: 50 });
}

function registerRepoTools(container: Container, state: RepoState): void {
  const kernel = container.state('tools').get('kernel');
  if (!Array.isArray(kernel)) return;

  kernel.push(
    {
      name: 'repo_status',
      description: 'Auto-repository status: SSH endpoint and clone URL, the commit main is serving, and every ephemeral branch instance running right now (branch, port, idle time).',
      inputSchema: { type: 'object', properties: {} },
      condition: null,
      async handler() { return repoStatus(container, state); },
    },
    {
      name: 'repo_branches',
      description: 'Lists the branches stored in the auto-repository with their last commit, and whether each one currently has a live instance.',
      inputSchema: { type: 'object', properties: {} },
      condition: null,
      async handler() {
        return {
          branches: listBranches(state.paths.gitDir).map(ref => ({
            ...ref,
            slug: slugify(ref.branch),
            isMain: ref.branch === state.config.main.branch,
            live: state.branches?.get(slugify(ref.branch))?.status ?? null,
          })),
        };
      },
    },
    {
      name: 'repo_open_branch',
      description: 'Boots an ephemeral instance of a branch (git worktree + its own port) and returns the URL. Idempotent: an already-live branch is just returned. The instance dies on its own once idle.',
      inputSchema: {
        type: 'object',
        properties: { branch: { type: 'string', description: 'Branch name, e.g. "feature/checkout"' } },
        required: ['branch'],
      },
      condition: null,
      async handler(args: any) {
        if (!state.branches) return { ok: false, error: 'ephemeral branches are disabled' };
        const instance = await state.branches.ensure(args.branch);
        return {
          ok: true, branch: instance.branch, slug: instance.slug, port: instance.port,
          url: `http://localhost:${instance.port}`,
          proxied: state.config.branches.expose === 'path' ? `/@${instance.slug}/` : null,
        };
      },
    },
    {
      name: 'repo_kill_branch',
      description: 'Stops an ephemeral branch instance now instead of waiting for the idle timeout, and removes its worktree.',
      inputSchema: {
        type: 'object',
        properties: { branch: { type: 'string' } },
        required: ['branch'],
      },
      condition: null,
      async handler(args: any) {
        return { ok: await state.branches?.stop(slugify(args.branch), 'tool-request') };
      },
    },
    {
      name: 'repo_log',
      description: 'Recent commits of a branch in the auto-repository (defaults to main).',
      inputSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string' },
          limit: { type: 'number', description: 'Default 20' },
        },
      },
      condition: null,
      async handler(args: any) {
        const ref = args.branch || state.config.main.branch;
        return { ref, commits: commitLog(state.paths.gitDir, ref, args.limit || 20) };
      },
    },
  );
}

// ── Shutdown ────────────────────────────────────────────────────────────────

function installShutdownHooks(state: RepoState, log: (msg: string) => void): void {
  let closing = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    log(`[repo] ${signal} — stopping ephemeral branches`);
    state.close()
      .catch(() => { /* dying anyway */ })
      .finally(() => {
        process.removeListener(signal, shutdown as any);
        process.kill(process.pid, signal);
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export { repoPaths, slugify } from './paths';
export type { BranchInstance } from './branches';

