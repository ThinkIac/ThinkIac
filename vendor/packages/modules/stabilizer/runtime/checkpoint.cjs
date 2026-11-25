// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
// stabilizer/checkpoint.ts — time travel for the workspace.
//
// Strategy 1 (preferred): a SHADOW git repository. We never touch the user's
// own .git — the shadow lives at <workspace>/.logos/shadow.git with the
// workspace as its work-tree. Every stable state becomes a commit; rollback
// of one package is `git checkout <commit> -- <pkg>`.
//
// Strategy 2 (fallback, no git on the machine): directory snapshots copied to
// <workspace>/.logos/snapshots/<pkg>/, keeping the last N per package.
//
// Databases: package .database dirs are EXCLUDED from git (binary churn) and
// snapshotted separately by snapshotDatabase()/restoreDatabase(), so a schema
// rollback restores code + data as one atomic unit.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointStore = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("../kernel/utils");
const KEEP_SNAPSHOTS = 5;
class CheckpointStore {
    workspace;
    logosDir;
    gitDir;
    stateFile;
    mode;
    constructor(workspace) {
        this.workspace = workspace;
        this.logosDir = path_1.default.join(workspace, '.logos');
        this.gitDir = path_1.default.join(this.logosDir, 'shadow.git');
        this.stateFile = path_1.default.join(this.logosDir, 'checkpoints.json');
        (0, utils_1.ensureDir)(this.logosDir);
        this.mode = this.gitAvailable() ? 'git' : 'copy';
        if (this.mode === 'git')
            this.initShadow();
        console.log(`[stabilizer] checkpoints via ${this.mode === 'git' ? 'shadow git' : 'directory snapshots'}`);
    }
    git(args) {
        const result = (0, child_process_1.spawnSync)('git', [`--git-dir=${this.gitDir}`, `--work-tree=${this.workspace}`, ...args], { encoding: 'utf-8' });
        return { ok: result.status === 0, out: (result.stdout || '').trim() };
    }
    gitAvailable() {
        try {
            return (0, child_process_1.spawnSync)('git', ['--version'], { stdio: 'ignore' }).status === 0;
        }
        catch {
            return false;
        }
    }
    initShadow() {
        if (!fs_1.default.existsSync(this.gitDir)) {
            (0, child_process_1.spawnSync)('git', ['init', '--bare', this.gitDir], { stdio: 'ignore' });
            (0, child_process_1.spawnSync)('git', [`--git-dir=${this.gitDir}`, 'config', 'user.email', 'logos@runtime'], { stdio: 'ignore' });
            (0, child_process_1.spawnSync)('git', [`--git-dir=${this.gitDir}`, 'config', 'user.name', 'Lógos Stabilizer'], { stdio: 'ignore' });
        }
        // Excludes: heavy/binary dirs never enter the shadow history.
        const excludeFile = path_1.default.join(this.gitDir, 'info', 'exclude');
        (0, utils_1.ensureDir)(path_1.default.dirname(excludeFile));
        fs_1.default.writeFileSync(excludeFile, [
            'node_modules/', '.logos/', '.git/', '.svelte-cache/',
            '.database/', '*.db', '*.sqlite', '*.sqlite3', '.snapshots/', 'dist/',
            'data/', 'uploads/', 'profiles/', 'secrets/', 'generated/',
            'backups/', 'snapshots/', 'sessions/', 'shared-cache/',
            'terminal/profiles/', 'terminal/shared-cache/',
        ].join('\n'));
    }
    readState() {
        return (0, utils_1.safeReadJson)(this.stateFile) ?? {};
    }
    writeState(state) {
        fs_1.default.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    }
    // ── Commit ────────────────────────────────────────────────────────────────
    /** Records a stable checkpoint. pkg = null means "whole workspace stable". */
    commitStable(pkg, reason = 'stable') {
        const label = pkg ?? '__workspace__';
        if (this.mode === 'git') {
            this.git(['add', '-A']);
            const commit = this.git(['commit', '-m', `stable(${label}): ${reason}`, '--allow-empty']);
            if (!commit.ok)
                return null;
            const rev = this.git(['rev-parse', 'HEAD']);
            if (!rev.ok)
                return null;
            const state = this.readState();
            state[label] = { ref: rev.out, ts: Date.now(), mode: 'git' };
            if (pkg)
                state['__workspace__'] = state['__workspace__'] ?? { ref: rev.out, ts: Date.now(), mode: 'git' };
            this.writeState(state);
            return rev.out;
        }
        // copy mode
        const target = pkg ? path_1.default.join(this.workspace, pkg) : this.workspace;
        if (!fs_1.default.existsSync(target))
            return null;
        const snapRoot = path_1.default.join(this.logosDir, 'snapshots', label);
        const snapDir = path_1.default.join(snapRoot, String(Date.now()));
        (0, utils_1.copyDir)(target, snapDir);
        this.prune(snapRoot);
        const state = this.readState();
        state[label] = { ref: snapDir, ts: Date.now(), mode: 'copy' };
        this.writeState(state);
        return snapDir;
    }
    prune(snapRoot) {
        if (!fs_1.default.existsSync(snapRoot))
            return;
        const snaps = fs_1.default.readdirSync(snapRoot).sort();
        while (snaps.length > KEEP_SNAPSHOTS) {
            const oldest = snaps.shift();
            fs_1.default.rmSync(path_1.default.join(snapRoot, oldest), { recursive: true, force: true });
        }
    }
    lastStable(pkg) {
        return this.readState()[pkg ?? '__workspace__'] ?? null;
    }
    // ── Rollback ──────────────────────────────────────────────────────────────
    /** Restores one package to its last stable checkpoint. Returns the diff (git mode). */
    rollbackPackage(pkg) {
        const stable = this.lastStable(pkg);
        if (!stable)
            return { ok: false };
        if (stable.mode === 'git') {
            const diff = this.git(['diff', stable.ref, '--', pkg]);
            const checkout = this.git(['checkout', stable.ref, '--', pkg]);
            return { ok: checkout.ok, diff: diff.out, ts: stable.ts };
        }
        const pkgDir = path_1.default.join(this.workspace, pkg);
        (0, utils_1.removeDirContents)(pkgDir);
        (0, utils_1.copyDir)(stable.ref, pkgDir);
        return { ok: true, ts: stable.ts };
    }
    /** Restores the whole workspace (crash-loop recovery). */
    rollbackWorkspace() {
        const stable = this.lastStable(null);
        if (!stable)
            return { ok: false };
        if (stable.mode === 'git') {
            const checkout = this.git(['checkout', stable.ref, '--', '.']);
            return { ok: checkout.ok, ts: stable.ts };
        }
        (0, utils_1.removeDirContents)(this.workspace, new Set([...utils_1.IGNORE_DIRS, '.logos']));
        (0, utils_1.copyDir)(stable.ref, this.workspace);
        return { ok: true, ts: stable.ts };
    }
    // ── Database snapshots (schema rollback = code + data as one unit) ────────
    snapshotDatabase(pkg) {
        // `.database` may be a directory (multi-file / per-tenant) or a single
        // SQLite file (auth, bags, memory, billing, …). Handle both — treating a
        // file as a dir throws ENOTDIR in copyDir/readdirSync.
        const dbPath = path_1.default.join(this.workspace, pkg, '.database');
        if (!fs_1.default.existsSync(dbPath))
            return null;
        const isFile = fs_1.default.statSync(dbPath).isFile();
        const snapDir = path_1.default.join(this.logosDir, 'db-snapshots', pkg, String(Date.now()));
        if (isFile) {
            (0, utils_1.ensureDir)(snapDir);
            fs_1.default.copyFileSync(dbPath, path_1.default.join(snapDir, '.database'));
        }
        else {
            (0, utils_1.copyDir)(dbPath, snapDir, new Set());
        }
        this.prune(path_1.default.join(this.logosDir, 'db-snapshots', pkg));
        const state = this.readState();
        state[`db:${pkg}`] = { ref: snapDir, ts: Date.now(), mode: 'copy', file: isFile };
        this.writeState(state);
        return snapDir;
    }
    restoreDatabase(pkg) {
        const stable = this.readState()[`db:${pkg}`];
        if (!stable)
            return { ok: false };
        const dbPath = path_1.default.join(this.workspace, pkg, '.database');
        if (stable.file) {
            // Snapshot stored the single SQLite file as `<snapDir>/.database`.
            (0, utils_1.ensureDir)(path_1.default.dirname(dbPath));
            fs_1.default.copyFileSync(path_1.default.join(stable.ref, '.database'), dbPath);
        }
        else {
            (0, utils_1.removeDirContents)(dbPath, new Set());
            (0, utils_1.copyDir)(stable.ref, dbPath, new Set());
        }
        return { ok: true, ts: stable.ts };
    }
}
exports.CheckpointStore = CheckpointStore;

};
