// External repo transport — the SSH transport of the auto-repository.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGitCommand = parseGitCommand;
exports.startSshServer = startSshServer;
const fs_1 = __importDefault(require("fs"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const keys_1 = require("./keys");
const delegation_1 = require("./delegation");
// ── Host key ────────────────────────────────────────────────────────────────
function generateHostKey(file, log) {
    // ssh-keygen produces the format ssh2 is happiest with; fall back to node
    // crypto (RSA PEM is universally parseable) when it is not installed.
    const keygen = (0, child_process_1.spawnSync)('ssh-keygen', ['-t', 'ed25519', '-f', file, '-N', '', '-C', 'logos-host'], { encoding: 'utf-8' });
    if (keygen.status === 0 && fs_1.default.existsSync(file)) {
        log('[repo:ssh] host key generated (ed25519)');
        return fs_1.default.readFileSync(file, 'utf-8');
    }
    const { privateKey } = crypto_1.default.generateKeyPairSync('rsa', {
        modulusLength: 3072,
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    fs_1.default.writeFileSync(file, privateKey, { mode: 0o600 });
    log('[repo:ssh] host key generated (rsa, ssh-keygen unavailable)');
    return privateKey;
}
function loadHostKey(file, log) {
    if (fs_1.default.existsSync(file))
        return fs_1.default.readFileSync(file, 'utf-8');
    return generateHostKey(file, log);
}
// ── Command parsing ─────────────────────────────────────────────────────────
const GIT_COMMAND = /^git[- ](upload-pack|receive-pack|upload-archive)\s+'?"?([^'"]*)'?"?\s*$/;
function parseGitCommand(command) {
    const match = GIT_COMMAND.exec((command || '').trim());
    if (!match)
        return null;
    if (match[1] === 'upload-archive')
        return null; // not served
    return { verb: match[1], repo: match[2] };
}
// ── Server ──────────────────────────────────────────────────────────────────
async function startSshServer(opts) {
    let ssh2;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        ssh2 = require('ssh2');
    }
    catch {
        opts.log('[repo:ssh] "ssh2" is not installed — SSH endpoint disabled (npm i ssh2 to enable)');
        return null;
    }
    const { Server, utils } = ssh2;
    const hostKeyPem = loadHostKey(opts.paths.hostKey, opts.log);
    const hostKey = utils.parseKey(hostKeyPem);
    if (!hostKey || hostKey instanceof Error) {
        opts.log(`[repo:ssh] unusable host key: ${hostKey?.message ?? 'parse failed'}`);
        return null;
    }
    const fingerprint = crypto_1.default.createHash('sha256').update(hostKey.getPublicSSH()).digest('base64').replace(/=+$/, '');
    const server = new Server({
        hostKeys: [hostKeyPem],
        banner: opts.banner,
        ident: 'Logos',
    }, (client) => {
        let identity = null;
        client.on('authentication', (ctx) => {
            if (ctx.method !== 'publickey') {
                return ctx.reject(['publickey'], false);
            }
            // Re-read on every attempt: adding a key must not require a restart.
            const delegated = (0, delegation_1.verifyDelegatedCredential)(ctx.username || '', opts.delegationPublicKey || '', opts.machineCode || '');
            if (delegated) {
                if (ctx.signature) {
                    const presented = utils.parseKey(`${ctx.key.algo} ${ctx.key.data.toString('base64')}`);
                    if (!presented || presented instanceof Error || !presented.verify(ctx.blob, ctx.signature, ctx.hashAlgo))
                        return ctx.reject();
                }
                identity = { type: ctx.key.algo, blob: ctx.key.data, comment: `delegated:${delegated.actor}`, role: delegated.role };
                return ctx.accept();
            }
            const allowed = (0, keys_1.loadAuthorizedKeys)(opts.paths.authorizedKeys);
            if (!allowed.length) {
                opts.log('[repo:ssh] rejected: .logos/authorized_keys is empty');
                return ctx.reject();
            }
            const match = allowed.find(k => {
                if (k.type !== ctx.key.algo)
                    return false;
                return k.blob.length === ctx.key.data.length && crypto_1.default.timingSafeEqual(k.blob, ctx.key.data);
            });
            if (!match)
                return ctx.reject();
            // Probe phase (no signature yet) — tell the client this key is welcome.
            if (ctx.signature) {
                const parsed = utils.parseKey(`${ctx.key.algo} ${ctx.key.data.toString('base64')}`);
                if (!parsed || parsed instanceof Error || !parsed.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) {
                    return ctx.reject();
                }
            }
            identity = match;
            ctx.accept();
        });
        client.on('ready', () => {
            client.on('session', (accept) => {
                const session = accept();
                session.once('exec', (acceptExec, _reject, info) => {
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
                    const child = (0, child_process_1.spawn)('git', [parsed.verb, opts.paths.gitDir], {
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
                    let exitCode = null;
                    let stdoutEnded = false;
                    let finalized = false;
                    const finalize = () => {
                        if (finalized || exitCode === null || !stdoutEnded)
                            return;
                        finalized = true;
                        try {
                            stream.exit(exitCode);
                            stream.end();
                        }
                        catch (err) {
                            opts.log(`[repo:ssh] channel teardown: ${err.message}`);
                        }
                    };
                    child.stdout.on('end', () => { stdoutEnded = true; finalize(); });
                    child.on('error', (err) => {
                        stream.stderr.write(`\n  [logos] ${err.message}\n\n`);
                        exitCode = 1;
                        stdoutEnded = true;
                        finalize();
                    });
                    child.on('close', (code) => {
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
                session.once('shell', (_accept, reject) => reject());
                session.once('sftp', (_accept, reject) => reject());
            });
        });
        client.on('error', () => { });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port, opts.host, () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    return {
        port: opts.port,
        fingerprint: `SHA256:${fingerprint}`,
        close: () => new Promise(resolve => server.close(() => resolve())),
    };
}
//# sourceMappingURL=ssh.js.map
