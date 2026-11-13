// modules/storage.ts — local-first, tiered storage foundation (boot phase).
//
// This module deliberately does not replace Node's fs. Transparent reads need
// a host-level mount (FUSE/overlay), which is an optional adapter above this
// core. The core owns the durable catalogue, retryable outbox, integrity checks
// and storage:* protocol that such an adapter will use.

'use strict';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Container, LogosModule } from '../kernel/container';
import { S3StorageProvider } from './storage-s3';

export type StorageState = 'hot' | 'pending' | 'syncing' | 'frozen' | 'restoring' | 'degraded' | 'failed';

export interface StorageRecord {
  path: string;
  key: string;
  sha256: string;
  size: number;
  state: StorageState;
  local: boolean;
  updatedAt: string;
  lastError?: string;
}

export interface StorageProvider {
  name: string;
  /** Resolves only after the remote object was read back/HEAD-checked by hash. */
  put(input: { key: string; file: string; sha256: string; size: number }): Promise<{ sha256: string }>;
  get(input: { key: string }): Promise<Buffer>;
}

export interface StorageMeshOptions {
  /** Root used to create stable object keys. */
  root: string;
  /** Durable catalogue/outbox location. Defaults to <root>/.logos/storage. */
  dataDir?: string;
  provider?: StorageProvider;
  retryAfterMs?: number;
}

type PersistedState = { records: Record<string, StorageRecord>; outbox: string[] };
type StorageEvent = (event: string, payload: Record<string, any>) => void | Promise<void>;

export class StorageUnavailableError extends Error {
  code = 'EAGAIN';
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'StorageUnavailableError';
    this.retryAfterMs = retryAfterMs;
  }
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeState(raw: string): PersistedState {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.records && Array.isArray(parsed.outbox)) return parsed;
  } catch { /* replaced below */ }
  return { records: {}, outbox: [] };
}

function isEligible(file: string): boolean {
  const segments = path.resolve(file).split(path.sep);
  if (segments.includes('.database') || segments.includes('node_modules') || segments.includes('.git')) return false;
  return !/\.(?:db|sqlite|sqlite3)$/i.test(file);
}

export class StorageMesh {
  private readonly root: string;
  private readonly dataFile: string;
  private provider?: StorageProvider;
  private readonly retryAfterMs: number;
  private state: PersistedState;
  private listeners = new Set<StorageEvent>();

  constructor(options: StorageMeshOptions) {
    this.root = path.resolve(options.root);
    const dataDir = options.dataDir || path.join(this.root, '.logos', 'storage');
    fs.mkdirSync(dataDir, { recursive: true });
    this.dataFile = path.join(dataDir, 'catalog.json');
    this.provider = options.provider;
    this.retryAfterMs = options.retryAfterMs ?? 5_000;
    this.state = fs.existsSync(this.dataFile) ? safeState(fs.readFileSync(this.dataFile, 'utf8')) : { records: {}, outbox: [] };
  }

  onEvent(listener: StorageEvent): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setProvider(provider?: StorageProvider): void {
    this.provider = provider;
  }

  status(file: string): StorageRecord {
    const record = this.state.records[path.resolve(file)];
    if (!record) throw new Error(`storage record not found: ${file}`);
    return { ...record };
  }

  outbox(): string[] { return [...this.state.outbox]; }

  async track(file: string): Promise<StorageRecord> {
    const resolved = path.resolve(file);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error(`storage path is outside its managed root: ${file}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`storage can only track files: ${file}`);
    const record: StorageRecord = {
      path: resolved,
      key: relative.split(path.sep).join('/'),
      sha256: sha256(resolved),
      size: stat.size,
      state: 'pending',
      local: true,
      updatedAt: new Date().toISOString(),
    };
    this.state.records[resolved] = record;
    if (!this.state.outbox.includes(resolved)) this.state.outbox.push(resolved);
    this.persist();
    await this.emit('storage:file-pending', { path: resolved, provider: this.provider?.name });
    return { ...record };
  }

  async sync(): Promise<void> {
    if (!this.provider) return;
    for (const file of [...this.state.outbox]) {
      const record = this.state.records[file];
      if (!record || !record.local || !fs.existsSync(file)) continue;
      record.state = 'syncing';
      this.persist();
      try {
        const result = await this.provider.put({ key: record.key, file, sha256: record.sha256, size: record.size });
        if (result.sha256 !== record.sha256) throw new Error('remote digest mismatch');
        record.state = 'hot';
        record.lastError = undefined;
        this.state.outbox = this.state.outbox.filter(item => item !== file);
        this.persist();
        await this.emit('storage:file-synced', { path: file, provider: this.provider.name, sha256: record.sha256 });
      } catch (err: any) {
        record.state = 'pending';
        record.lastError = err?.message || 'sync failed';
        this.persist();
        await this.emit('storage:sync-failed', { path: file, provider: this.provider.name, error: record.lastError });
      }
    }
  }

  async freeze(file: string): Promise<StorageRecord> {
    const resolved = path.resolve(file);
    if (!isEligible(resolved)) throw new Error(`storage path is not eligible for freezing: ${file}`);
    let record = this.state.records[resolved];
    if (!record) record = await this.track(resolved);
    if (!this.provider) throw new Error('storage provider is not configured');
    await this.sync();
    record = this.state.records[resolved];
    if (record.state !== 'hot') {
      record.state = 'failed';
      this.persist();
      throw new Error(record.lastError || 'remote object was not verified');
    }
    fs.unlinkSync(resolved);
    record.local = false;
    record.state = 'frozen';
    record.updatedAt = new Date().toISOString();
    this.persist();
    await this.emit('storage:file-frozen', { path: resolved, provider: this.provider.name, sha256: record.sha256 });
    return { ...record };
  }

  async ensure(file: string): Promise<StorageRecord> {
    const resolved = path.resolve(file);
    const record = this.state.records[resolved];
    if (!record) throw new Error(`storage record not found: ${file}`);
    if (record.local && fs.existsSync(resolved)) return { ...record };
    if (!this.provider) throw new StorageUnavailableError('storage provider is not configured', this.retryAfterMs);
    record.state = 'restoring';
    this.persist();
    try {
      const content = await this.provider.get({ key: record.key });
      const digest = crypto.createHash('sha256').update(content).digest('hex');
      if (digest !== record.sha256) throw new Error('remote digest mismatch');
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      const tmp = `${resolved}.restoring-${process.pid}`;
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, resolved);
      record.local = true;
      record.state = 'hot';
      record.lastError = undefined;
      record.updatedAt = new Date().toISOString();
      this.persist();
      await this.emit('storage:file-ready', { path: resolved, provider: this.provider.name });
      return { ...record };
    } catch (err: any) {
      record.state = 'degraded';
      record.lastError = err?.message || 'rehydration failed';
      this.persist();
      await this.emit('storage:rehydration-pending', { path: resolved, provider: this.provider.name, retryAfterMs: this.retryAfterMs });
      throw new StorageUnavailableError(`storage rehydration pending: ${record.lastError}`, this.retryAfterMs);
    }
  }

  private persist(): void {
    const tmp = `${this.dataFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.dataFile);
  }

  private async emit(event: string, payload: Record<string, any>): Promise<void> {
    for (const listener of this.listeners) await listener(event, payload);
  }
}

export function getStorage(container: Container): StorageMesh | undefined {
  return container.state('storage').get('mesh');
}

export const storageModule: LogosModule = {
  name: 'storage',
  phase: 'boot',
  swappable: false,
  after: ['env'],
  install(container: Container) {
    const state = container.state('storage');
    const configured = container.config.storage || {};
    const root = configured.root || process.env.LOGOS_DATA_DIR || container.workspace;
    const provider = configured.provider || (configured.s3 ? new S3StorageProvider(configured.s3) : undefined);
    const mesh = new StorageMesh({ root, dataDir: configured.dataDir, provider, retryAfterMs: configured.retryAfterMs });
    state.set('mesh', mesh);
    mesh.onEvent((event, payload) => container.bus.emit(event, payload));

    container.bus.on('storage:ensure', async (payload: any) => ({ ...payload, storage: await mesh.ensure(payload.path) }));
    container.bus.on('storage:freeze', async (payload: any) => ({ ...payload, storage: await mesh.freeze(payload.path) }));
    container.bus.on('storage:track', async (payload: any) => ({ ...payload, storage: await mesh.track(payload.path) }));
    container.bus.on('storage:configure-provider', async (payload: any) => {
      if (!payload?.provider || typeof payload.provider.put !== 'function' || typeof payload.provider.get !== 'function') throw new Error('invalid storage provider');
      mesh.setProvider(payload.provider);
      return { ...payload, configured: true, provider: payload.provider.name };
    });
  },
};
