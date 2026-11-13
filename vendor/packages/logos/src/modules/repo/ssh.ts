// modules/repo/ssh.ts — the SSH transport of the auto-repository.
//
// A project becomes its own git host: `git clone ssh://logos@host:2222/project`.
// This server speaks exactly two commands and nothing else — no shell, no
// sftp, no port forwarding. Authentication is public-key only; passwords and
// keyboard-interactive are rejected outright.
//
// It is deliberately embedded rather than delegated to the host's sshd: the
// point of the feature is that a Lógos project hosts itself, including inside
// a container where provisioning sshd is not an option.
//
// `ssh2` is an optional dependency. Without it the rest of the repo module —
// git storage, deploys, ephemeral branches over HTTP — still works; only the
// SSH endpoint is skipped, with one warning.

'use strict';

import fs from 'fs';
import crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { RepoPaths } from './paths';
import { AuthorizedKey, KeyRole, loadAuthorizedKeys } from './keys';
import { verifyDelegatedCredential } from './delegation';

export interface SshServerOptions {
  paths: RepoPaths;
  port: number;
  host: string;
  banner?: string;
  /** Git Cloud's Ed25519 public key; enables only short-lived delegated sessions. */
  delegationPublicKey?: string;
  /** The paired Machine code; delegated credentials are never reusable elsewhere. */
  machineCode?: string;
  log: (msg: string) => void;
  /** Called after every accepted git command, for bus events. */
  onSession?: (info: { role: KeyRole; comment: string; command: 'upload-pack' | 'receive-pack' }) => void;
}

export interface SshServerHandle {
  port: number;
  close(): Promise<void>;
  /** Fingerprint of the host key, to show in the UI. */
  fingerprint: string;
}

// ── Host key ────────────────────────────────────────────────────────────────

function generateHostKey(file: string, log: (msg: string) => void): string {
  // ssh-keygen produces the format ssh2 is happiest with; fall back to node
  // crypto (RSA PEM is universally parseable) when it is not installed.
  const keygen = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', file, '-N', '', '-C', 'logos-host'], { encoding: 'utf-8' });
  if (keygen.status === 0 && fs.existsSync(file)) {
    log('[repo:ssh] host key generated (ed25519)');
    return fs.readFileSync(file, 'utf-8');
  }
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  fs.writeFileSync(file, privateKey, { mode: 0o600 });
  log('[repo:ssh] host key generated (rsa, ssh-keygen unavailable)');
  return privateKey;
}

function loadHostKey(file: string, log: (msg: string) => void): string {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf-8');
  return generateHostKey(file, log);
}

// ── Command parsing ─────────────────────────────────────────────────────────

const GIT_COMMAND = /^git[- ](upload-pack|receive-pack|upload-archive)\s+'?"?([^'"]*)'?"?\s*$/;

export function parseGitCommand(command: string): { verb: 'upload-pack' | 'receive-pack'; repo: string } | null {
  const match = GIT_COMMAND.exec((command || '').trim());
  if (!match) return null;
  if (match[1] === 'upload-archive') return null; // not served
  return { verb: match[1] as 'upload-pack' | 'receive-pack', repo: match[2] };
}

// ── Server ──────────────────────────────────────────────────────────────────

export async function startSshServer(opts: SshServerOptions): Promise<SshServerHandle | null> {
  let ssh2: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ssh2 = require('ssh2');
  } catch {
    opts.log('[repo:ssh] "ssh2" is not installed — SSH endpoint disabled (npm i ssh2 to enable)');
    return null;
  }

  const { Server, utils } = ssh2;
  const hostKeyPem = loadHostKey(opts.paths.hostKey, opts.log);
  const hostKey = utils.parseKey(hostKeyPem);
  if (!hostKey || hostKey instanceof Error) {
    opts.log(`[repo:ssh] unusable host key: ${(hostKey as Error)?.message ?? 'parse failed'}`);
    return null;
  }
  const fingerprint = crypto.createHash('sha256').update(hostKey.getPublicSSH()).digest('base64').replace(/=+$/, '');

  const server = new Server({
    hostKeys: [hostKeyPem],
    banner: opts.banner,
    ident: 'Logos',
  }, (client: any) => {
    let identity: AuthorizedKey | null = null;

    client.on('authentication', (ctx: any) => {
      if (ctx.method !== 'publickey') {
        return ctx.reject(['publickey'], false);
      }
      // Re-read on every attempt: adding a key must not require a restart.
      const delegated = verifyDelegatedCredential(ctx.username || '', opts.delegationPublicKey || '', opts.machineCode || '');
      if (delegated) {
        if (ctx.signature) {
          const presented = utils.parseKey(`${ctx.key.algo} ${ctx.key.data.toString('base64')}`);
          if (!presented || presented instanceof Error || !presented.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) return ctx.reject();
        }
        identity = { type: ctx.key.algo, blob: ctx.key.data, comment: `delegated:${delegated.actor}`, role: delegated.role };
        return ctx.accept();
      }

      const allowed = loadAuthorizedKeys(opts.paths.authorizedKeys);
      if (!allowed.length) {
        opts.log('[repo:ssh] rejected: .logos/authorized_keys is empty');
        return ctx.reject();
      }

      const match = allowed.find(k => {
        if (k.type !== ctx.key.algo) return false;
        return k.blob.length === ctx.key.data.length && crypto.timingSafeEqual(k.blob, ctx.key.data);
      });
      if (!match) return ctx.reject();

      // Probe phase (no signature yet) — tell the client this key is welcome.
      if (ctx.signature) {
        const parsed = utils.parseKey(
          `${ctx.key.algo} ${ctx.key.data.toString('base64')}`);
        if (!parsed || parsed instanceof Error || !parsed.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) {
          return ctx.reject();
        }
      }
      identity = match;
      ctx.accept();
    });

    client.on('ready', () => {
      client.on('session', (accept: any) => {
        const session = accept();

        session.once('exec', (acceptExec: any, _reject: any, info: any) => {
          const stream = acceptExec();
          const parsed = parseGitCommand(info.command);

          if (!parsed) {
            stream.stderr.write('\n  [logos] this endpoint only serves git. No shell here.\n\n');
            stream.exit(127);
            return stream.end();
          }
          if (parsed.verb === 'receive-pack' && identity?.role === 'read') {
            stream.stderr.write('\n  [logos] this key is read-only.\n\n');
            stream.exit(1);
            return stream.end();
          }

          const child = spawn('git', [parsed.verb, opts.paths.gitDir], {
            env: {
              ...process.env,
              LOGOS_PUSH_ROLE: identity?.role ?? 'main',
              LOGOS_PUSH_KEY: identity?.comment ?? '',
              GIT_PROTOCOL: info.env?.GIT_PROTOCOL ?? '',
            },
          });

          stream.pipe(child.stdin);
          // `end: false` is the whole trick. With the default, pipe() sends
          // channel EOF as soon as git's stdout ends, and an exit-status
          // requested after EOF is dropped — the client then sees "Exit
          // status -1", ssh returns 255, and git reports "remote transport
          // reported error" even though the pack arrived intact. So we hold
          // the channel open, send exit-status once the child is done, and
          // only then end it.
          child.stdout.pipe(stream, { end: false });
          child.stderr.pipe(stream.stderr, { end: false });

          let exitCode: number | null = null;
          let stdoutEnded = false;
          let finalized = false;

          const finalize = () => {
            if (finalized || exitCode === null || !stdoutEnded) return;
            finalized = true;
            try {
              stream.exit(exitCode);
              stream.end();
            } catch (err: any) {
              opts.log(`[repo:ssh] channel teardown: ${err.message}`);
            }
          };

          child.stdout.on('end', () => { stdoutEnded = true; finalize(); });
          child.on('error', (err: any) => {
            stream.stderr.write(`\n  [logos] ${err.message}\n\n`);
            exitCode = 1;
            stdoutEnded = true;
            finalize();
          });
          child.on('close', (code: number) => {
            exitCode = code ?? 0;
            finalize();
          });

          opts.onSession?.({
            role: identity?.role ?? 'main',
            comment: identity?.comment ?? '',
            command: parsed.verb,
          });
          opts.log(`[repo:ssh] ${parsed.verb} by "${identity?.comment || 'unknown key'}" (${identity?.role})`);
        });

        session.once('shell', (_accept: any, reject: any) => reject());
        session.once('sftp', (_accept: any, reject: any) => reject());
      });
    });

    client.on('error', () => { /* a dropped client is not a runtime problem */ });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    port: opts.port,
    fingerprint: `SHA256:${fingerprint}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

