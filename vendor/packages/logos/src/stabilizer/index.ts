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

import fs from 'fs';
import { candidateHash, createCandidate, candidateContributors } from './candidate';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { Container } from '../kernel/container';
import { CheckpointStore } from './checkpoint';
import { stagePackageUnlocked } from './staging';
import { packageOperation } from './operations';
import { stopPackageUnlocked } from './isolation';
import { HealthMonitor } from './health';
import { appendLog } from '../kernel/debug-log';
import { IGNORE_DIRS } from '../kernel/utils';

const QUIESCENCE_MS = 2_000;

// Janela em que uma pasta nova ainda pode ganhar seu package.json antes de ser
// descartada como "não é pacote" (10 tentativas × 500ms ≈ 5s).
const NEW_PACKAGE_RETRY_MS = 500;
const NEW_PACKAGE_ATTEMPTS = 10;

export function findLocalPrismaBinary(cwd = process.cwd()): string | null {
  const executable = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const candidates = [
    path.join(cwd, 'node_modules', '.bin', executable),
    path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', executable),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

const IGNORE_EXTS = new Set([
  '.sqlite', '.sqlite3', '.db', '.db3', '.log', '.pid',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.ico',
  '.mp3', '.mp4', '.wav', '.ogg', '.pdf', '.zip', '.tar', '.gz',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.map',
]);

type ChangeType = 'code' | 'env' | 'views' | 'schema' | 'docs' | 'commit';

function isWidgetsDirectory(filePath: string): boolean {
  return /[\\/]views[\\/]widgets$/i.test(filePath);
}

function classify(filePath: string): ChangeType | null {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (base === '.commit') return 'commit';
  if (base === '.env') return 'env';
  if (ext === '.prisma' || ext === '.scriba') return 'schema';
  if (ext === '.svelte' || ext === '.svx') return 'views';
  if (ext === '.md') return 'docs';
  if (base === 'package.json' || ext === '.js' || ext === '.ts') return 'code';
  return null;
}

interface Transaction {
  candidate?: ReturnType<typeof createCandidate>;
  correlation?: ReturnType<typeof candidateContributors>;
  files: Map<string, ChangeType>;
  timer: any;
  retries: number;
}

export class Stabilizer {
  container: Container;
  readonly health: HealthMonitor;
  private closed = false;
  checkpoints: CheckpointStore;
  private transactions = new Map<string, Transaction>();
  private sourceEvidence = new Map<string, any>();
  private watchers = new Map<string, any>();
  private workspaceWatcher: any = null;
  private workspaceWatching = false;
  private depsFingerprint = new Map<string, string>();
  private installing: Promise<void> | null = null;
  private newPackageTimers = new Set<any>();
  private resolveWorkspaceReady: () => void = () => {};
  /** Resolve quando o watcher de pacotes novos está de fato observando. */
  readonly workspaceReady: Promise<void>;

  constructor(container: Container) {
    this.container = container;
    container.bus.on('runtime:source_changed', (payload: any) => {
      if (payload?.path && payload?.hash && payload?.sessionId && payload?.runId) {
        this.sourceEvidence.set(payload.path, payload);
        if (this.sourceEvidence.size > 10000) this.sourceEvidence.delete(this.sourceEvidence.keys().next().value!);
      }
    });
    this.health = new HealthMonitor(container, (folder, policy) => packageOperation(container, folder, async () => {
      if (this.closed || container.registry.getState(folder)?.state !== 'active' || this.transactions.has(folder)) return { ok: false };
      return policy === 'stop' ? stopPackageUnlocked(container, folder) : stagePackageUnlocked(container, folder);
    }));
    container.bus.on('runtime:ready', () => this.health.start());
    container.bus.on('package:added', () => this.health.refresh());
    container.bus.on('reload:swapped', () => this.health.refresh());
    this.checkpoints = new CheckpointStore(container.workspace);
    this.workspaceReady = new Promise<void>(resolve => { this.resolveWorkspaceReady = resolve; });

    // Explicit commit channel (used by the runtime_commit kernel tool).
    container.bus.on('reload:commit', async (payload: any) => {
      const pkg = payload?.pkg;
      if (!pkg) return { ok: false, error: 'missing pkg' };
      return this.commit(pkg, 'explicit');
    }, { priority: 50 });
  }

  enabled(): boolean {
    if (this.container.config?.hotReload?.enabled === false) return false;
    if (process.env.NODE_ENV !== 'production') return true;
    return process.env.HOT_RELOAD_ENABLED === 'true' || this.container.config?.hotReload?.enabled === true;
  }

  // ── Watching ──────────────────────────────────────────────────────────────

  watchPackage(pkgFolder: string): void {
    if (!this.enabled() || this.watchers.has(pkgFolder)) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const chokidar = require('chokidar');
    const packageDir = path.join(this.container.workspace, pkgFolder);

    const watcher = chokidar.watch(packageDir, {
      ignored: (testPath: string) => {
        const base = path.basename(testPath);
        if (testPath === packageDir) return false;
        if (IGNORE_DIRS.has(base)) return true;
        if (base.startsWith('.') && base !== '.env' && base !== '.commit') return true;
        if (IGNORE_EXTS.has(path.extname(base).toLowerCase())) return true;
        return false;
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    watcher.on('all', (event: string, filePath: string) => this.onFileChanged(pkgFolder, filePath, event));
    this.watchers.set(pkgFolder, watcher);

    // Prime dependency fingerprint so the first package.json change is detected.
    this.depsFingerprint.set(pkgFolder, this.readDepsFingerprint(pkgFolder));
    this.container.log(`[stabilizer] watching "${pkgFolder}"`);
  }

  watchWorkspace(knownFolders: string[], onNewPackage: (folder: string) => void): void {
    if (this.workspaceWatcher) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const chokidar = require('chokidar');
    const seen = new Set(knownFolders);
    const pending = new Map<string, any>();

    // Um pacote nasce em dois tempos: `mkdir packages/<nome>` e só depois o
    // package.json. O `addDir` chega no primeiro tempo, quando o manifesto
    // ainda não existe — checar `existsSync` ali e desistir era o que fazia o
    // pacote novo passar despercebido até o próximo boot. Aqui a pasta sem
    // manifesto vira uma candidata que é reavaliada por alguns segundos, e o
    // `add` do próprio package.json também dispara a avaliação.
    const consider = (folder: string, attempt = 0): void => {
      if (!folder || seen.has(folder) || IGNORE_DIRS.has(folder) || folder.startsWith('.')) return;
      const dir = path.join(this.container.workspace, folder);

      if (!fs.existsSync(path.join(dir, 'package.json'))) {
        if (attempt >= NEW_PACKAGE_ATTEMPTS) { pending.delete(folder); return; }
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

    /**
     * Resolve somente as três raízes de pacote suportadas pelo registry.
     * Nunca retorna um filho arbitrário de um app.
     */
    const packageFolder = (targetPath: string): string | null => {
      const rel = path.relative(this.container.workspace, targetPath);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
      const parts = rel.split(path.sep).filter(Boolean);
      if (!parts.length) return null;
      if (parts[0] === 'modules') return parts[1] ? path.join('modules', parts[1]) : null;
      if (parts[1] === 'mcp') return path.join(parts[0], 'mcp');
      return parts[0];
    };

    this.workspaceWatcher = chokidar.watch(this.container.workspace, {
      depth: 2,
      ignored: [/(^|[\/\\])\../, /node_modules/],
      ignoreInitial: true,
    });

    this.workspaceWatcher.on('addDir', (dirPath: string) => consider(packageFolder(dirPath) as string));
    this.workspaceWatcher.on('add', (filePath: string) => consider(packageFolder(filePath) as string));
    this.workspaceWatcher.on('unlinkDir', (dirPath: string) => {
      const folder = packageFolder(dirPath);
      // Só uma raiz reconhecida de pacote pode ser removida. O watcher
      // individual costuma emitir unlinkDir para views/widgets antes disso,
      // mas esta reconciliação cobre remoções rápidas em que ele já foi
      // fechado pelo sistema.
      if (!folder || path.resolve(dirPath) !== path.join(this.container.workspace, folder) || !seen.delete(folder)) return;
      clearTimeout(pending.get(folder));
      pending.delete(folder);
      this.stopWatching(folder);
      this.container.bus.emit('views:file_changed', {
        pkg: folder,
        file: path.join(dirPath, 'views', 'widgets'),
      });
    });

    // O chokidar varre o workspace antes de ficar pronto, e o que aparece
    // DURANTE essa varredura chega marcado como "inicial" — engolido por
    // ignoreInitial. Um pacote criado nos primeiros milissegundos depois do
    // boot cairia nesse buraco e só existiria no boot seguinte; a reconciliação
    // aqui compara o disco com o que já é conhecido e recupera esses casos.
    this.workspaceWatcher.on('ready', () => {
      try {
        for (const pkg of this.container.registry.discover()) consider(pkg.folder);
      } catch { /* workspace sumiu */ }
      this.resolveWorkspaceReady();
    });

    this.workspaceWatching = true;
    this.container.log(`[stabilizer] watching workspace for new packages`);
  }

  /** Estado seguro para suporte: não expõe paths, código ou segredos. */
  diagnostics(pkgFolder?: string): Record<string, any> {
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

  stopWatching(pkgFolder: string): void {
    const watcher = this.watchers.get(pkgFolder);
    if (watcher) { watcher.close().catch(() => {}); this.watchers.delete(pkgFolder); }
  }

  /**
   * Desliga tudo que o stabilizer mantém vivo. Chamado por instance.close().
   *
   * Sem isso os watchers sobrevivem ao runtime que os criou: em um processo com
   * mais de um runtime (testes, um app que reinicializa), o stabilizer órfão
   * continuava reagindo a um workspace que já não existe — inclusive tratando o
   * sumiço dos arquivos como "mudou o package.json" e disparando npm install.
   */
  async close(): Promise<void> {
    this.closed = true;
    await this.health.close();
    await Promise.allSettled([...this.container.state('packageOperations').values()]);
    this.resolveWorkspaceReady();
    for (const txn of this.transactions.values()) if (txn.timer) clearTimeout(txn.timer);
    this.transactions.clear();

    const closing = [...this.watchers.values()].map(w => w.close().catch(() => {}));
    this.watchers.clear();
    if (this.workspaceWatcher) {
      closing.push(this.workspaceWatcher.close().catch(() => {}));
      this.workspaceWatcher = null;
    }
    this.workspaceWatching = false;
    for (const timer of this.newPackageTimers) clearTimeout(timer);
    this.newPackageTimers.clear();
    await Promise.all(closing);
  }

  // ── Transactions ──────────────────────────────────────────────────────────

  private onFileChanged(pkgFolder: string, filePath: string, event = 'change'): void {
    // chokidar reports a deleted widgets folder as unlinkDir, with no file
    // extension for classify(). It must still rebuild the shared registry.
    const type = event === 'unlinkDir' && isWidgetsDirectory(filePath) ? 'views' : classify(filePath);
    if (!type) return;

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
      try { fs.unlinkSync(filePath); } catch { /* marker consumed */ }
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
    if (txn.timer) clearTimeout(txn.timer);
    const windowMs = this.container.config?.hotReload?.quiescenceMs ?? QUIESCENCE_MS;
    txn.timer = setTimeout(() => this.commit(pkgFolder, 'quiescence'), windowMs);
    txn.timer.unref?.();
  }

  commit(pkgFolder: string, trigger: string): Promise<any> {
    return packageOperation(this.container, pkgFolder, () => this.commitUnlocked(pkgFolder, trigger));
  }

  private async commitUnlocked(pkgFolder: string, trigger: string): Promise<any> {
    if (this.closed) return { ok: false, error: 'stabilizer closed' };
    const txn: Transaction = this.transactions.get(pkgFolder) ?? { files: new Map(), timer: null, retries: 0 };
    if (txn.timer) clearTimeout(txn.timer);
    this.transactions.delete(pkgFolder);

    const files = [...txn.files.keys()];
    const types = new Set(txn.files.values());
    this.container.log(`\n[stabilizer] commit "${pkgFolder}" (${trigger}) — ${files.length || 'explicit, 0 tracked'} file(s)`);
    await this.container.bus.emit('reload:committing', { pkg: pkgFolder, files, trigger });

    try {
      txn.candidate = createCandidate(path.join(this.container.workspace, pkgFolder));
      txn.correlation = candidateContributors(path.join(this.container.workspace, pkgFolder), [...this.sourceEvidence.values()].filter(item => files.includes(item.path)));
      // Uma alteração apenas visual não precisa remountar o pacote. Ainda é
      // validada pelo módulo views (build + SSR) antes de ser publicada.
      if (types.size === 1 && types.has('views')) {
        for (const file of files) {
          await this.container.bus.emit('views:file_changed', { pkg: pkgFolder, file });
          const error = this.container.state('views').get(`validation:${path.resolve(file)}`);
          if (error) throw new Error(`SSR validation failed: ${error}`);
        }
        if (candidateHash(path.join(this.container.workspace, pkgFolder)) !== txn.candidate.candidateHash) throw new Error('Candidate changed during validation');
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
      if (files.some(f => path.basename(f) === 'package.json')) {
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
      const result = await stagePackageUnlocked(this.container, pkgFolder, txn.candidate);
      if (!result.ok) return this.onStagingFailed(pkgFolder, txn, files, result);

      for (const file of files) {
        if (txn.files.get(file) === 'views') {
          await this.container.bus.emit('views:file_changed', { pkg: pkgFolder, file });
          const error = this.container.state('views').get(`validation:${path.resolve(file)}`);
          if (error) throw new Error(`SSR validation failed: ${error}`);
        }
      }

      // 4. Stable — checkpoint.
      if (candidateHash(path.join(this.container.workspace, pkgFolder)) !== txn.candidate.candidateHash) throw new Error('Candidate changed during validation');
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
    } catch (err: any) {
      appendLog(pkgFolder, 'stabilizer:commit', err);
      return this.onStagingFailed(pkgFolder, txn, files, { ok: false, pkg: pkgFolder, checks: [], error: err.message });
    }
  }

  private async onStagingFailed(pkgFolder: string, txn: Transaction, files: string[], result: any): Promise<any> {
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
        const restored = await stagePackageUnlocked(this.container, pkgFolder);
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

  private readManifest(pkgFolder: string): any | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.container.workspace, pkgFolder, 'package.json'), 'utf-8'));
    } catch { return null; }
  }

  private readDepsFingerprint(pkgFolder: string): string {
    const manifest = this.readManifest(pkgFolder);
    if (!manifest) return '';
    return JSON.stringify({ ...manifest.dependencies, ...manifest.devDependencies });
  }

  /**
   * Dependências de um pacote RECÉM-CRIADO. O caminho normal (maybeInstallDeps)
   * compara a impressão digital com a anterior e, num pacote novo, não existe
   * anterior — nada era instalado e o pacote quebrava no primeiro require.
   *
   * Só chama o npm se alguma dependência declarada realmente não estiver
   * resolvível: um npm install de ~20s por pacote novo (a esmagadora maioria só
   * usa o que já está na raiz) tornaria "criou, já funciona" uma promessa vazia.
   */
  async ensureDeps(pkgFolder: string): Promise<boolean> {
    const manifest = this.readManifest(pkgFolder);
    this.depsFingerprint.set(pkgFolder, this.readDepsFingerprint(pkgFolder));
    if (!manifest) return false;

    const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
    if (!declared.length) return false;

    const missing = declared.filter(dep => {
      try { require.resolve(dep, { paths: [path.join(this.container.workspace, pkgFolder), process.cwd()] }); return false; }
      catch { return true; }
    });
    if (!missing.length) return false;

    this.container.log(`[stabilizer:deps] "${pkgFolder}" needs ${missing.join(', ')} — running npm install`);
    await this.runInstall(pkgFolder);
    return true;
  }

  /** Global lock — never two npm installs on the same workspace at once. */
  private async maybeInstallDeps(pkgFolder: string): Promise<void> {
    const current = this.readDepsFingerprint(pkgFolder);
    const previous = this.depsFingerprint.get(pkgFolder);
    this.depsFingerprint.set(pkgFolder, current);
    if (previous === undefined || previous === current) return;
    // Manifesto ilegível ou apagado (pacote removido, checkout no meio do
    // caminho): instalar não conserta nada e um npm install acidental na raiz
    // mexe no node_modules de todo mundo.
    if (current === '') return;

    await this.runInstall(pkgFolder);
  }

  private async runInstall(pkgFolder: string): Promise<void> {
    while (this.installing) await this.installing; // queue behind a running install

    this.installing = new Promise<void>((resolve) => {
      this.container.log(`[stabilizer:deps] dependencies changed in "${pkgFolder}" — running npm install`);
      const child = spawn('npm', ['install'], {
        cwd: process.cwd(),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      child.on('error', (err) => { appendLog(pkgFolder, 'stabilizer:deps', err); resolve(); });
      child.on('exit', (code) => {
        if (code !== 0) appendLog(pkgFolder, 'stabilizer:deps', new Error(`npm install exited ${code}`));
        resolve();
      });
    });
    await this.installing;
    this.installing = null;
    await new Promise(r => setTimeout(r, 500)); // let node_modules settle
  }

  // ── Schema protocol ───────────────────────────────────────────────────────
  //
  // 1. `prisma validate` on the new schema (no database touched)
  // 2. snapshot the package's .database directory
  // 3. staging proceeds; a later rollback restores code + data together

  private async schemaProtocol(pkgFolder: string): Promise<{ valid: boolean; error?: string }> {
    const pkgDir = path.join(this.container.workspace, pkgFolder);
    const { composePackageSchema } = require('../database/schema-composer');
    let composed: any;
    try { composed = composePackageSchema(pkgDir); }
    catch (error: any) { return { valid: false, error: `schema composition failed: ${error.message}` }; }
    if (!composed) return { valid: true };
    const schema = composed.outputPath;

    // Validate without touching the database. This is intentionally
    // best-effort: never let npx resolve/download an undeclared Prisma version.
    const prisma = findLocalPrismaBinary();
    if (!prisma) {
      this.container.log(`[stabilizer] Prisma CLI not installed; skipping schema validation for "${pkgFolder}"`);
      const snap = this.checkpoints.snapshotDatabase(pkgFolder);
      if (snap) this.container.log(`[stabilizer] database snapshot for "${pkgFolder}" → ${snap}`);
      await this.container.bus.emit('db:schema_changed', { pkg: pkgFolder, schema, sources: composed.sources });
      return { valid: true };
    }
    const validate = spawnSync(prisma, ['validate', '--schema', schema],
      { encoding: 'utf-8', shell: process.platform === 'win32' });
    if (validate.status !== null && validate.status !== 0 && !/not found|could not determine/i.test(validate.stderr || '')) {
      return { valid: false, error: `schema.prisma invalid: ${(validate.stderr || '').trim().slice(0, 500)}` };
    }

    const snap = this.checkpoints.snapshotDatabase(pkgFolder);
    if (snap) this.container.log(`[stabilizer] database snapshot for "${pkgFolder}" → ${snap}`);
    await this.container.bus.emit('db:schema_changed', { pkg: pkgFolder, schema, sources: composed.sources });
    return { valid: true };
  }
}
