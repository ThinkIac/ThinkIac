'use strict';

// Local-first storage capability.  The catalogue and all lifecycle listeners
// are owned here; Logos only supplies events, configuration and state.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class StorageUnavailableError extends Error {
  constructor(message, retryAfterMs) { super(message); this.name = 'StorageUnavailableError'; this.code = 'EAGAIN'; this.retryAfterMs = retryAfterMs; }
}
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const eligible = file => !path.resolve(file).split(path.sep).some(part => ['.database', 'node_modules', '.git'].includes(part)) && !/\.(?:db|sqlite|sqlite3)$/i.test(file);

class StorageMesh {
  constructor(options) {
    this.root = path.resolve(options.root);
    const dataDir = options.dataDir || path.join(this.root, '.logos', 'storage');
    fs.mkdirSync(dataDir, { recursive: true });
    this.dataFile = path.join(dataDir, 'catalog.json');
    this.provider = options.provider;
    this.retryAfterMs = options.retryAfterMs == null ? 5000 : options.retryAfterMs;
    this.listeners = new Set();
    try { this.state = JSON.parse(fs.readFileSync(this.dataFile, 'utf8')); } catch { this.state = { records: {}, outbox: [] }; }
    if (!this.state.records || !Array.isArray(this.state.outbox)) this.state = { records: {}, outbox: [] };
  }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setProvider(provider) { this.provider = provider; }
  status(file) { const value = this.state.records[path.resolve(file)]; if (!value) throw new Error(`storage record not found: ${file}`); return { ...value }; }
  outbox() { return [...this.state.outbox]; }
  persist() { const temp = `${this.dataFile}.${process.pid}.tmp`; fs.writeFileSync(temp, JSON.stringify(this.state)); fs.renameSync(temp, this.dataFile); }
  async emit(event, payload) { for (const listener of this.listeners) await listener(event, payload); }
  async track(file) {
    const resolved = path.resolve(file); const relative = path.relative(this.root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`storage path is outside its managed root: ${file}`);
    const stat = fs.statSync(resolved); if (!stat.isFile()) throw new Error(`storage can only track files: ${file}`);
    const record = { path: resolved, key: relative.split(path.sep).join('/'), sha256: digest(resolved), size: stat.size, state: 'pending', local: true, updatedAt: new Date().toISOString() };
    this.state.records[resolved] = record; if (!this.state.outbox.includes(resolved)) this.state.outbox.push(resolved); this.persist();
    await this.emit('storage:file-pending', { path: resolved, provider: this.provider && this.provider.name }); return { ...record };
  }
  async sync() {
    if (!this.provider) return;
    for (const file of [...this.state.outbox]) { const record = this.state.records[file]; if (!record || !record.local || !fs.existsSync(file)) continue; record.state = 'syncing'; this.persist();
      try { const result = await this.provider.put({ key: record.key, file, sha256: record.sha256, size: record.size }); if (result.sha256 !== record.sha256) throw new Error('remote digest mismatch'); record.state = 'hot'; delete record.lastError; this.state.outbox = this.state.outbox.filter(value => value !== file); this.persist(); await this.emit('storage:file-synced', { path: file, provider: this.provider.name, sha256: record.sha256 }); }
      catch (error) { record.state = 'pending'; record.lastError = error.message || 'sync failed'; this.persist(); await this.emit('storage:sync-failed', { path: file, provider: this.provider.name, error: record.lastError }); }
    }
  }
  async freeze(file) { const resolved = path.resolve(file); if (!eligible(resolved)) throw new Error(`storage path is not eligible for freezing: ${file}`); let record = this.state.records[resolved]; if (!record) record = await this.track(resolved); if (!this.provider) throw new Error('storage provider is not configured'); await this.sync(); record = this.state.records[resolved]; if (record.state !== 'hot') { record.state = 'failed'; this.persist(); throw new Error(record.lastError || 'remote object was not verified'); } fs.unlinkSync(resolved); record.local = false; record.state = 'frozen'; record.updatedAt = new Date().toISOString(); this.persist(); await this.emit('storage:file-frozen', { path: resolved, provider: this.provider.name, sha256: record.sha256 }); return { ...record }; }
  async ensure(file) { const resolved = path.resolve(file); const record = this.state.records[resolved]; if (!record) throw new Error(`storage record not found: ${file}`); if (record.local && fs.existsSync(resolved)) return { ...record }; if (!this.provider) throw new StorageUnavailableError('storage provider is not configured', this.retryAfterMs); record.state = 'restoring'; this.persist(); try { const content = await this.provider.get({ key: record.key }); if (crypto.createHash('sha256').update(content).digest('hex') !== record.sha256) throw new Error('remote digest mismatch'); fs.mkdirSync(path.dirname(resolved), { recursive: true }); const temp = `${resolved}.restoring-${process.pid}`; fs.writeFileSync(temp, content); fs.renameSync(temp, resolved); record.local = true; record.state = 'hot'; delete record.lastError; record.updatedAt = new Date().toISOString(); this.persist(); await this.emit('storage:file-ready', { path: resolved, provider: this.provider.name }); return { ...record }; } catch (error) { record.state = 'degraded'; record.lastError = error.message || 'rehydration failed'; this.persist(); await this.emit('storage:rehydration-pending', { path: resolved, provider: this.provider.name, retryAfterMs: this.retryAfterMs }); throw new StorageUnavailableError(`storage rehydration pending: ${record.lastError}`, this.retryAfterMs); } }
}

function createRuntimeModule(host) {
  let mesh;
  return { name: 'storage', phase: 'boot', after: ['env'], api: { getStorage: () => mesh, StorageMesh, StorageUnavailableError }, install() {
    const config = host.storage.config(); const root = config.root || host.dataDir() || host.workspace();
    // A provider object can be supplied by an integration through the event.
    mesh = new StorageMesh({ root, dataDir: config.dataDir, provider: config.provider, retryAfterMs: config.retryAfterMs });
    host.state('storage').set('mesh', mesh); mesh.onEvent((event, payload) => host.emit(event, payload));
    host.on('storage:ensure', async payload => ({ ...payload, storage: await mesh.ensure(payload.path) }));
    host.on('storage:freeze', async payload => ({ ...payload, storage: await mesh.freeze(payload.path) }));
    host.on('storage:track', async payload => ({ ...payload, storage: await mesh.track(payload.path) }));
    host.on('storage:configure-provider', async payload => { if (!payload || !payload.provider || typeof payload.provider.put !== 'function' || typeof payload.provider.get !== 'function') throw new Error('invalid storage provider'); mesh.setProvider(payload.provider); return { ...payload, configured: true, provider: payload.provider.name }; });
  } };
}
module.exports = { createRuntimeModule, StorageMesh, StorageUnavailableError };
