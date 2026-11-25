// Injectable compatibility implementation, owned by module-stabilizer.
module.exports = function (require, module, exports, __dirname, __filename) {
// stabilizer/index.ts — the auto-stabilizer (kernel-resident, never a module
// you can hot-swap: it is the immune system, it cannot live in the layer it
// reverts).
//
// Responsibilities:
//   1. Watch each package with chokidar and classify changes
//   2. Group changes into TRANSACTIONS per package:
//        - quiescence window (~2s without changes) for humans
//        - explicit commit for agents: the `runtime_commit` tool, the
//          `reload:commit` bus event, or touching a `.commit` file
//   3. On commit: dependency install if package.json changed → schema
//      protocol if schema.prisma changed → staging swap (staging.ts)
//   4. Checkpoint every stable state; roll back after maxRetries failures
//   5. Detect new packages dropped into the workspace
//
// Compatibility events emitted while stabilization is extracted:
//   reload:transaction_open / reload:committing / reload:swapped / reload:stable
//   package:reload_failed { pkg, error, checks, files }
//   package:rolled_back   { pkg, restoredTs, diff }
//   package:docs_changed  { pkg, file }        (AGent.md / *.md)
//   views:file_changed    { pkg, file }
//   db:schema_changed     { pkg }
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Stabilizer = void 0;
exports.findLocalPrismaBinary = findLocalPrismaBinary;
const fs_1 = __importDefault(require("fs"));
const candidate_1 = require("./candidate");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const checkpoint_1 = require("./checkpoint");
const staging_1 = require("./staging");
const operations_1 = require("./operations");
const isolation_1 = require("./isolation");
const health_1 = require("./health");
const debug_log_1 = require("../kernel/debug-log");
const utils_1 = require("../kernel/utils");
const QUIESCENCE_MS = 2_000;
// Janela em que uma pasta nova ainda pode ganhar seu package.json antes de ser
// descartada como "não é pacote" (10 tentativas × 500ms ≈ 5s).
const NEW_PACKAGE_RETRY_MS = 500;
const NEW_PACKAGE_ATTEMPTS = 10;
function findLocalPrismaBinary(cwd = process.cwd()) {
    const executable = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
    const candidates = [
        path_1.default.join(cwd, 'node_modules', '.bin', executable),
        path_1.default.join(__dirname, '..', '..', '..', 'node_modules', '.bin', executable),
    ];
    return candidates.find(candidate => fs_1.default.existsSync(candidate)) || null;
}
const IGNORE_EXTS = new Set([
    '.sqlite', '.sqlite3', '.db', '.db3', '.log', '.pid',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico',
    '.mp3', '.mp4', '.wav', '.ogg', '.pdf', '.zip', '.tar', '.gz',
    '.woff', '.woff2', '.ttf', '.eot', '.otf', '.map',
]);
function isWidgetsDirectory(filePath) {
    return /[\\/]views[\\/]widgets$/i.test(filePath);
}
function classify(filePath) {
    const base = path_1.default.basename(filePath);
    const ext = path_1.default.extname(filePath).toLowerCase();
    if (base === '.commit')
        return 'commit';
    if (base === '.env')
        return 'env';
    if (ext === '.prisma' || ext === '.scriba' || ext === '.schema')
        return 'schema';
    if (ext === '.svelte' || ext === '.svx')
        return 'views';
    if (ext === '.md')
        return 'docs';
    if (base === 'package.json' || ext === '.js' || ext === '.ts')
        return 'code';
    return null;
}
class Stabilizer extends (require('./dependencies').DependencyInstaller) {
    container;
    health;
    closed = false;
    checkpoints;
    transactions = new Map();
    sourceEvidence = new Map();
    watchers = new Map();
    workspaceWatcher = null;
    workspaceWatching = false;
    depsFingerprint = new Map();
    installing = null;
    newPackageTimers = new Set();
    resolveWorkspaceReady = () => { };
    /** Resolve quando o watcher de pacotes novos está de fato observando. */
    workspaceReady;
    constructor(container, checkpoints) {
        super(container);
        const subscriptions = new Set();
        const events = { on: (...args) => {
            const off = container.bus.on(...args);
            subscriptions.add(off);
            return off;
        } };
        this.unsubscribe = () => { for (const off of subscriptions) off(); subscriptions.clear(); };
        this.container = container;
        events.on('runtime:source_changed', (payload) => {
            if (payload?.path && payload?.hash && payload?.sessionId && payload?.runId) {
                this.sourceEvidence.set(payload.path, payload);
                if (this.sourceEvidence.size > 10000)
                    this.sourceEvidence.delete(this.sourceEvidence.keys().next().value);
            }
        });
        this.health = new health_1.HealthMonitor(container, (folder, policy) => (0, operations_1.packageOperation)(container, folder, async () => {
            if (this.closed || container.registry.getState(folder)?.state !== 'active' || this.transactions.has(folder))
                return { ok: false };
            return policy === 'stop' ? (0, isolation_1.stopPackageUnlocked)(container, folder) : (0, staging_1.stagePackageUnlocked)(container, folder);
        }));
        events.on('runtime:ready', () => this.health.start());
        events.on('package:added', () => this.health.refresh());
        events.on('reload:swapped', () => this.health.refresh());
        this.checkpoints = checkpoints || new checkpoint_1.CheckpointStore(container.workspace);
        this.workspaceReady = new Promise(resolve => { this.resolveWorkspaceReady = resolve; });
        // Explicit commit channel (used by the runtime_commit kernel tool).
        events.on('reload:commit', async (payload) => {
            const pkg = payload?.pkg;
            if (!pkg)
                return { ok: false, error: 'missing pkg' };
            return this.commit(pkg, 'explicit');
        }, { priority: 50 });
    }
    enabled() {
        if (this.container.config?.hotReload?.enabled === false)
            return false;
        if (process.env.NODE_ENV !== 'production')
            return true;
        return process.env.HOT_RELOAD_ENABLED === 'true' || this.container.config?.hotReload?.enabled === true;
    }
    // ── Watching ──────────────────────────────────────────────────────────────
    watchPackage(pkgFolder) {
        if (!this.enabled() || this.watchers.has(pkgFolder))
            return;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const chokidar = require('chokidar');
        const packageDir = path_1.default.join(this.container.workspace, pkgFolder);
        const watcher = chokidar.watch(packageDir, {
            ignored: (testPath) => {
                const base = path_1.default.basename(testPath);
                if (testPath === packageDir)
                    return false;
                if (utils_1.IGNORE_DIRS.has(base))
                    return true;
                if (base.startsWith('.') && base !== '.env' && base !== '.commit')
                    return true;
                if (IGNORE_EXTS.has(path_1.default.extname(base).toLowerCase()))
                    return true;
                return false;
            },
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        });
        watcher.on('all', (event, filePath) => {
            const nested = this.container.registry.discover().some(pkg => pkg.folder !== pkgFolder && pkg.dir.startsWith(packageDir + path_1.default.sep) && (filePath === pkg.dir || filePath.startsWith(pkg.dir + path_1.default.sep)));
            if (!nested) this.onFileChanged(pkgFolder, filePath, event);
        });
        this.watchers.set(pkgFolder, watcher);
        // Prime dependency fingerprint so the first package.json change is detected.
        this.depsFingerprint.set(pkgFolder, this.readDepsFingerprint(pkgFolder));
        this.container.log(`[stabilizer] watching "${pkgFolder}"`);
    }
    watchWorkspace(knownFolders, onNewPackage) {
        if (this.workspaceWatcher)
            return;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const chokidar = require('chokidar');
        const seen = new Set(knownFolders);
        const pending = new Map();
        // Um pacote nasce em dois tempos: `mkdir packages/<nome>` e só depois o
        // package.json. O `addDir` chega no primeiro tempo, quando o manifesto
        // ainda não existe — checar `existsSync` ali e desistir era o que fazia o
        // pacote novo passar despercebido até o próximo boot. Aqui a pasta sem
        // manifesto vira uma candidata que é reavaliada por alguns segundos, e o
        // `add` do próprio package.json também dispara a avaliação.
        const consider = (folder, attempt = 0) => {
            if (!folder || seen.has(folder) || utils_1.IGNORE_DIRS.has(folder) || folder.startsWith('.'))
                return;
            const dir = path_1.default.join(this.container.workspace, folder);
            if (!fs_1.default.existsSync(path_1.default.join(dir, 'package.json'))) {
                if (attempt >= NEW_PACKAGE_ATTEMPTS) {
                    pending.delete(folder);
                    return;
                }
                clearTimeout(pending.get(folder));
                const timer = setTimeout(() => consider(folder, attempt + 1), NEW_PACKAGE_RETRY_MS);
                timer.unref?.();
                pending.set(folder, timer);
                this.newPackageTimers.add(timer);
                return;
            }
            clearTimeout(pending.get(folder));
            this.newPackageTimers.delete(pending.get(folder));
            pending.delete(folder);
            seen.add(folder);
            onNewPackage(folder);
        };
        // A manifest defines ownership at any depth; grouping directories do not.
        const packageFolder = targetPath => {
            const rel = path_1.default.relative(this.container.workspace, targetPath);
            if (!rel || rel.split(path_1.default.sep).some(part => part === '..' || part.startsWith('.') || utils_1.IGNORE_DIRS.has(part)) || path_1.default.isAbsolute(rel)) return null;
            return rel.endsWith(path_1.default.sep + 'package.json') ? path_1.default.dirname(rel) : rel;
        };
        this.workspaceWatcher = chokidar.watch(this.container.workspace, {
            followSymlinks: false,
            ignored: target => path_1.default.relative(this.container.workspace, target).split(path_1.default.sep).some(part => part.startsWith('.') || utils_1.IGNORE_DIRS.has(part)),
            ignoreInitial: true,
        });
        this.workspaceWatcher.on('addDir', (dirPath) => consider(packageFolder(dirPath)));
        this.workspaceWatcher.on('add', (filePath) => consider(packageFolder(filePath)));
        this.workspaceWatcher.on('unlinkDir', (dirPath) => {
            const folder = packageFolder(dirPath);
            // Só uma raiz reconhecida de pacote pode ser removida. O watcher
            // individual costuma emitir unlinkDir para views/widgets antes disso,
            // mas esta reconciliação cobre remoções rápidas em que ele já foi
            // fechado pelo sistema.
            if (!folder || path_1.default.resolve(dirPath) !== path_1.default.join(this.container.workspace, folder) || !seen.delete(folder))
                return;
            clearTimeout(pending.get(folder));
            pending.delete(folder);
            this.stopWatching(folder);
            this.container.bus.emit('views:file_changed', {
                pkg: folder,
                file: path_1.default.join(dirPath, 'views', 'widgets'),
            });
        });
        // O chokidar varre o workspace antes de ficar pronto, e o que aparece
        // DURANTE essa varredura chega marcado como "inicial" — engolido por
        // ignoreInitial. Um pacote criado nos primeiros milissegundos depois do
        // boot cairia nesse buraco e só existiria no boot seguinte; a reconciliação
        // aqui compara o disco com o que já é conhecido e recupera esses casos.
        this.workspaceWatcher.on('ready', () => {
            try {
                for (const pkg of this.container.registry.discover())
                    consider(pkg.folder);
            }
            catch { /* workspace sumiu */ }
            this.resolveWorkspaceReady();
        });
        this.workspaceWatching = true;
        this.container.log(`[stabilizer] watching workspace for new packages`);
    }
    /** Estado seguro para suporte: não expõe paths, código ou segredos. */
    diagnostics(pkgFolder) {
        const state = pkgFolder ? this.container.registry.getState(pkgFolder) : null;
        return {
            hotReloadEnabled: this.enabled(),
            workspaceWatcher: this.workspaceWatching,
            package: pkgFolder ?? null,
            state: state?.state ?? null,
            error: state?.error ?? null,
            ...(state?.health ? { health: state.health } : {}),
            watchingPackage: pkgFolder ? this.watchers.has(pkgFolder) : null,
            pendingTransactions: pkgFolder ? (this.transactions.has(pkgFolder) ? 1 : 0) : this.transactions.size,
        };
    }
    stopWatching(pkgFolder) {
        const watcher = this.watchers.get(pkgFolder);
        if (watcher) {
            watcher.close().catch(() => { });
            this.watchers.delete(pkgFolder);
        }
    }
    /**
     * Desliga tudo que o stabilizer mantém vivo. Chamado por instance.close().
     *
     * Sem isso os watchers sobrevivem ao runtime que os criou: em um processo com
     * mais de um runtime (testes, um app que reinicializa), o stabilizer órfão
     * continuava reagindo a um workspace que já não existe — inclusive tratando o
     * sumiço dos arquivos como "mudou o package.json" e disparando npm install.
     */
    async close() {
        this.unsubscribe();
        this.closed = true;
        await this.health.close();
        await Promise.allSettled([...this.container.state('packageOperations').values()]);
        this.resolveWorkspaceReady();
        for (const txn of this.transactions.values())
            if (txn.timer)
                clearTimeout(txn.timer);
        this.transactions.clear();
        const closing = [...this.watchers.values()].map(w => w.close().catch(() => { }));
        this.watchers.clear();
        if (this.workspaceWatcher) {
            closing.push(this.workspaceWatcher.close().catch(() => { }));
            this.workspaceWatcher = null;
        }
        this.workspaceWatching = false;
        for (const timer of this.newPackageTimers)
            clearTimeout(timer);
        this.newPackageTimers.clear();
        await Promise.all(closing);
    }
    // ── Transactions ──────────────────────────────────────────────────────────
    onFileChanged(pkgFolder, filePath, event = 'change') {
        // chokidar reports a deleted widgets folder as unlinkDir, with no file
        // extension for classify(). It must still rebuild the shared registry.
        const type = event === 'unlinkDir' && isWidgetsDirectory(filePath) ? 'views' : classify(filePath);
        if (!type)
            return;
        // Views entram na mesma transação por quiescência. Antes eram uma fast
        // lane e anunciavam HMR enquanto a edição ainda estava sendo gravada.
        if (type === 'docs') {
            this.container.bus.emit('package:docs_changed', { pkg: pkgFolder, file: filePath });
            return;
        }
        if (type === 'env') {
            this.container.bus.emit('reload:env', { pkg: this.container.registry.getPackage(pkgFolder) });
            return;
        }
        if (type === 'commit') {
            try {
                fs_1.default.unlinkSync(filePath);
            }
            catch { /* marker consumed */ }
            this.commit(pkgFolder, 'marker-file');
            return;
        }
        // code / schema → transactional
        let txn = this.transactions.get(pkgFolder);
        if (!txn) {
            txn = { files: new Map(), timer: null, retries: 0 };
            this.transactions.set(pkgFolder, txn);
            this.container.bus.emit('reload:transaction_open', { pkg: pkgFolder });
        }
        txn.files.set(filePath, type);
        // Quiescence: reset the window on every change (human editing mode).
        if (txn.timer)
            clearTimeout(txn.timer);
        const windowMs = this.container.config?.hotReload?.quiescenceMs ?? QUIESCENCE_MS;
        txn.timer = setTimeout(() => this.commit(pkgFolder, 'quiescence'), windowMs);
        txn.timer.unref?.();
    }
    commit(pkgFolder, trigger) {
        return (0, operations_1.packageOperation)(this.container, pkgFolder, () => this.commitUnlocked(pkgFolder, trigger));
    }
    async commitUnlocked(pkgFolder, trigger) {
        if (this.closed)
            return { ok: false, error: 'stabilizer closed' };
        const txn = this.transactions.get(pkgFolder) ?? { files: new Map(), timer: null, retries: 0 };
        if (txn.timer)
            clearTimeout(txn.timer);
        this.transactions.delete(pkgFolder);
        const files = [...txn.files.keys()];
        const types = new Set(txn.files.values());
        this.container.log(`\n[stabilizer] commit "${pkgFolder}" (${trigger}) — ${files.length || 'explicit, 0 tracked'} file(s)`);
        await this.container.bus.emit('reload:committing', { pkg: pkgFolder, files, trigger });
        try {
            txn.candidate = (0, candidate_1.createCandidate)(path_1.default.join(this.container.workspace, pkgFolder));
            txn.correlation = (0, candidate_1.candidateContributors)(path_1.default.join(this.container.workspace, pkgFolder), [...this.sourceEvidence.values()].filter(item => files.includes(item.path)));
            // Uma alteração apenas visual não precisa remountar o pacote. Ainda é
            // validada pelo módulo views (build + SSR) antes de ser publicada.
            if (types.size === 1 && types.has('views')) {
                for (const file of files) {
                    await this.container.bus.emit('views:file_changed', { pkg: pkgFolder, file });
                    const error = this.container.state('views').get(`validation:${path_1.default.resolve(file)}`);
                    if (error)
                        throw new Error(`SSR validation failed: ${error}`);
                }
                if ((0, candidate_1.candidateHash)(path_1.default.join(this.container.workspace, pkgFolder)) !== txn.candidate.candidateHash)
                    throw new Error('Candidate changed during validation');
                const checkpointRef = this.checkpoints.commitStable(pkgFolder, trigger);
                await this.container.bus.emit('reload:stable', {
                    ...txn.candidate, ...txn.correlation, producedAt: Date.now(), activated: true,
                    pkg: pkgFolder,
                    files,
                    trigger,
                    checks: [{ name: 'views:ssr', ok: true }],
                    checkpointRef,
                });
                return { ok: true, pkg: pkgFolder, checks: [{ name: 'views:ssr', ok: true }] };
            }
            // 1. Dependencies changed? Install BEFORE loading new modules.
            if (files.some(f => path_1.default.basename(f) === 'package.json')) {
                await this.maybeInstallDeps(pkgFolder);
            }
            // 2. Schema protocol: validate → snapshot data → let staging run.
            if (types.has('schema')) {
                const ok = await this.schemaProtocol(pkgFolder);
                if (!ok.valid) {
                    return this.onStagingFailed(pkgFolder, txn, files, { ok: false, pkg: pkgFolder, checks: [], error: ok.error });
                }
            }
            // 3. Staging swap.
            const result = await (0, staging_1.stagePackageUnlocked)(this.container, pkgFolder, txn.candidate);
            if (!result.ok)
                return this.onStagingFailed(pkgFolder, txn, files, result);
            for (const file of files) {
                if (txn.files.get(file) === 'views') {
                    await this.container.bus.emit('views:file_changed', { pkg: pkgFolder, file });
                    const error = this.container.state('views').get(`validation:${path_1.default.resolve(file)}`);
                    if (error)
                        throw new Error(`SSR validation failed: ${error}`);
                }
            }
            // 4. Stable — checkpoint.
            if ((0, candidate_1.candidateHash)(path_1.default.join(this.container.workspace, pkgFolder)) !== txn.candidate.candidateHash)
                throw new Error('Candidate changed during validation');
            const checkpointRef = this.checkpoints.commitStable(pkgFolder, trigger);
            await this.container.bus.emit('reload:stable', {
                ...txn.candidate, ...txn.correlation, producedAt: Date.now(), activated: true,
                pkg: pkgFolder,
                files,
                trigger,
                checks: result.checks,
                checkpointRef,
            });
            return { ok: true, pkg: pkgFolder, checks: result.checks };
        }
        catch (err) {
            (0, debug_log_1.appendLog)(pkgFolder, 'stabilizer:commit', err);
            return this.onStagingFailed(pkgFolder, txn, files, { ok: false, pkg: pkgFolder, checks: [], error: err.message });
        }
    }
    async onStagingFailed(pkgFolder, txn, files, result) {
        const pkg = this.container.registry.getPackage(pkgFolder);
        const maxRetries = pkg?.runtime?.stability?.maxRetries ?? 3;
        txn.retries += 1;
        await this.container.bus.emit('package:reload_failed', {
            ...txn.candidate, ...txn.correlation, producedAt: Date.now(),
            pkg: pkgFolder,
            error: result.error,
            checks: result.checks,
            files,
            attempt: txn.retries,
            maxRetries,
        });
        if (txn.retries >= maxRetries) {
            this.container.log(`[stabilizer] "${pkgFolder}" failed ${txn.retries}x — rolling back to last stable checkpoint`);
            const rollback = this.checkpoints.rollbackPackage(pkgFolder);
            if (rollback.ok) {
                // Restored files on disk → stage the restored version back in.
                const restored = await (0, staging_1.stagePackageUnlocked)(this.container, pkgFolder);
                this.container.registry.setState(pkgFolder, 'rolled_back');
                await this.container.bus.emit('package:rolled_back', {
                    ...txn.candidate, ...txn.correlation, producedAt: Date.now(), restoredCandidateHash: restored.candidateHash || null,
                    pkg: pkgFolder,
                    restoredTs: rollback.ts,
                    diff: rollback.diff ?? null,
                    restaged: restored.ok,
                });
                return { ok: false, rolledBack: true, restoredTs: rollback.ts, error: result.error };
            }
            this.container.log(`[stabilizer] "${pkgFolder}": no checkpoint to roll back to`);
            return { ok: false, rolledBack: false, error: result.error };
        }
        // Keep the retry counter alive for the next attempt of this edit session.
        this.transactions.set(pkgFolder, { files: new Map(), timer: null, retries: txn.retries });
        return { ok: false, rolledBack: false, error: result.error, attempt: txn.retries };
    }
    // ── Dependencies ──────────────────────────────────────────────────────────
    // ── Schema protocol ───────────────────────────────────────────────────────
    //
    // 1. `prisma validate` on the new schema (no database touched)
    // 2. snapshot the package's .database directory
    // 3. staging proceeds; a later rollback restores code + data together
    async schemaProtocol(pkgFolder) {
        const pkgDir = path_1.default.join(this.container.workspace, pkgFolder);
        const { composePackageSchema } = require('../database/schema-composer');
        let composed;
        try {
            composed = composePackageSchema(pkgDir);
        }
        catch (error) {
            return { valid: false, error: `schema composition failed: ${error.message}` };
        }
        if (!composed)
            return { valid: true };
        const schema = composed.outputPath;
        // Validate without touching the database. This is intentionally
        // best-effort: never let npx resolve/download an undeclared Prisma version.
        const prisma = findLocalPrismaBinary();
        if (!prisma) {
            this.container.log(`[stabilizer] Prisma CLI not installed; skipping schema validation for "${pkgFolder}"`);
            const snap = this.checkpoints.snapshotDatabase(pkgFolder);
            if (snap)
                this.container.log(`[stabilizer] database snapshot for "${pkgFolder}" → ${snap}`);
            await this.container.bus.emit('db:schema_changed', { pkg: pkgFolder, schema, sources: composed.sources });
            return { valid: true };
        }
        const validate = (0, child_process_1.spawnSync)(prisma, ['validate', '--schema', schema], { encoding: 'utf-8', shell: process.platform === 'win32' });
        if (validate.status !== null && validate.status !== 0 && !/not found|could not determine/i.test(validate.stderr || '')) {
            return { valid: false, error: `schema.prisma invalid: ${(validate.stderr || '').trim().slice(0, 500)}` };
        }
        const snap = this.checkpoints.snapshotDatabase(pkgFolder);
        if (snap)
            this.container.log(`[stabilizer] database snapshot for "${pkgFolder}" → ${snap}`);
        await this.container.bus.emit('db:schema_changed', { pkg: pkgFolder, schema, sources: composed.sources });
        return { valid: true };
    }
}
exports.Stabilizer = Stabilizer;

};
