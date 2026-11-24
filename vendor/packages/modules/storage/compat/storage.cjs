// Legacy public compatibility implementation, owned by module-storage.
module.exports = function(require, module, exports, __dirname, __filename, kernel) {
// modules/storage.ts — local-first, tiered storage foundation (boot phase).
//
// This module deliberately does not replace Node's fs. Transparent reads need
// a host-level mount (FUSE/overlay), which is an optional adapter above this
// core. The core owns the durable catalogue, retryable outbox, integrity checks
// and storage:* protocol that such an adapter will use.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageModule = exports.StorageMesh = exports.StorageUnavailableError = void 0;
exports.getStorage = getStorage;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const storage_s3_1 = require("./storage-s3");
class StorageUnavailableError extends Error {
    code = 'EAGAIN';
    retryAfterMs;
    constructor(message, retryAfterMs) {
        super(message);
        this.name = 'StorageUnavailableError';
        this.retryAfterMs = retryAfterMs;
    }
}
exports.StorageUnavailableError = StorageUnavailableError;
function sha256(file) {
    return crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(file)).digest('hex');
}
function safeState(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.records && Array.isArray(parsed.outbox))
            return parsed;
    }
    catch { /* replaced below */ }
    return { records: {}, outbox: [] };
}
function isEligible(file) {
    const segments = path_1.default.resolve(file).split(path_1.default.sep);
    if (segments.includes('.database') || segments.includes('node_modules') || segments.includes('.git'))
        return false;
    return !/\.(?:db|sqlite|sqlite3)$/i.test(file);
}
class StorageMesh {
    root;
    dataFile;
    provider;
    retryAfterMs;
    state;
    listeners = new Set();
    constructor(options) {
        this.root = path_1.default.resolve(options.root);
        const dataDir = options.dataDir || path_1.default.join(this.root, '.logos', 'storage');
        fs_1.default.mkdirSync(dataDir, { recursive: true });
        this.dataFile = path_1.default.join(dataDir, 'catalog.json');
        this.provider = options.provider;
        this.retryAfterMs = options.retryAfterMs ?? 5_000;
        this.state = fs_1.default.existsSync(this.dataFile) ? safeState(fs_1.default.readFileSync(this.dataFile, 'utf8')) : { records: {}, outbox: [] };
    }
    onEvent(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    setProvider(provider) {
        this.provider = provider;
    }
    status(file) {
        const record = this.state.records[path_1.default.resolve(file)];
        if (!record)
            throw new Error(`storage record not found: ${file}`);
        return { ...record };
    }
    outbox() { return [...this.state.outbox]; }
    async track(file) {
        const resolved = path_1.default.resolve(file);
        const relative = path_1.default.relative(this.root, resolved);
        if (relative.startsWith(`..${path_1.default.sep}`) || relative === '..' || path_1.default.isAbsolute(relative)) {
            throw new Error(`storage path is outside its managed root: ${file}`);
        }
        const stat = fs_1.default.statSync(resolved);
        if (!stat.isFile())
            throw new Error(`storage can only track files: ${file}`);
        const record = {
            path: resolved,
            key: relative.split(path_1.default.sep).join('/'),
            sha256: sha256(resolved),
            size: stat.size,
            state: 'pending',
            local: true,
            updatedAt: new Date().toISOString(),
        };
        this.state.records[resolved] = record;
        if (!this.state.outbox.includes(resolved))
            this.state.outbox.push(resolved);
        this.persist();
        await this.emit('storage:file-pending', { path: resolved, provider: this.provider?.name });
        return { ...record };
    }
    async sync() {
        if (!this.provider)
            return;
        for (const file of [...this.state.outbox]) {
            const record = this.state.records[file];
            if (!record || !record.local || !fs_1.default.existsSync(file))
                continue;
            record.state = 'syncing';
            this.persist();
            try {
                const result = await this.provider.put({ key: record.key, file, sha256: record.sha256, size: record.size });
                if (result.sha256 !== record.sha256)
                    throw new Error('remote digest mismatch');
                record.state = 'hot';
                record.lastError = undefined;
                this.state.outbox = this.state.outbox.filter(item => item !== file);
                this.persist();
                await this.emit('storage:file-synced', { path: file, provider: this.provider.name, sha256: record.sha256 });
            }
            catch (err) {
                record.state = 'pending';
                record.lastError = err?.message || 'sync failed';
                this.persist();
                await this.emit('storage:sync-failed', { path: file, provider: this.provider.name, error: record.lastError });
            }
        }
    }
    async freeze(file) {
        const resolved = path_1.default.resolve(file);
        if (!isEligible(resolved))
            throw new Error(`storage path is not eligible for freezing: ${file}`);
        let record = this.state.records[resolved];
        if (!record)
            record = await this.track(resolved);
        if (!this.provider)
            throw new Error('storage provider is not configured');
        await this.sync();
        record = this.state.records[resolved];
        if (record.state !== 'hot') {
            record.state = 'failed';
            this.persist();
            throw new Error(record.lastError || 'remote object was not verified');
        }
        fs_1.default.unlinkSync(resolved);
        record.local = false;
        record.state = 'frozen';
        record.updatedAt = new Date().toISOString();
        this.persist();
        await this.emit('storage:file-frozen', { path: resolved, provider: this.provider.name, sha256: record.sha256 });
        return { ...record };
    }
    async ensure(file) {
        const resolved = path_1.default.resolve(file);
        const record = this.state.records[resolved];
        if (!record)
            throw new Error(`storage record not found: ${file}`);
        if (record.local && fs_1.default.existsSync(resolved))
            return { ...record };
        if (!this.provider)
            throw new StorageUnavailableError('storage provider is not configured', this.retryAfterMs);
        record.state = 'restoring';
        this.persist();
        try {
            const content = await this.provider.get({ key: record.key });
            const digest = crypto_1.default.createHash('sha256').update(content).digest('hex');
            if (digest !== record.sha256)
                throw new Error('remote digest mismatch');
            fs_1.default.mkdirSync(path_1.default.dirname(resolved), { recursive: true });
            const tmp = `${resolved}.restoring-${process.pid}`;
            fs_1.default.writeFileSync(tmp, content);
            fs_1.default.renameSync(tmp, resolved);
            record.local = true;
            record.state = 'hot';
            record.lastError = undefined;
            record.updatedAt = new Date().toISOString();
            this.persist();
            await this.emit('storage:file-ready', { path: resolved, provider: this.provider.name });
            return { ...record };
        }
        catch (err) {
            record.state = 'degraded';
            record.lastError = err?.message || 'rehydration failed';
            this.persist();
            await this.emit('storage:rehydration-pending', { path: resolved, provider: this.provider.name, retryAfterMs: this.retryAfterMs });
            throw new StorageUnavailableError(`storage rehydration pending: ${record.lastError}`, this.retryAfterMs);
        }
    }
    persist() {
        const tmp = `${this.dataFile}.${process.pid}.tmp`;
        fs_1.default.writeFileSync(tmp, JSON.stringify(this.state));
        fs_1.default.renameSync(tmp, this.dataFile);
    }
    async emit(event, payload) {
        for (const listener of this.listeners)
            await listener(event, payload);
    }
}
exports.StorageMesh = StorageMesh;
function getStorage(container) {
    return container.state('storage').get('mesh');
}
exports.storageModule = {
    name: 'storage',
    phase: 'boot',
    swappable: false,
    after: ['env'],
    install(container) {
        const state = container.state('storage');
        const configured = container.config.storage || {};
        const root = configured.root || process.env.LOGOS_DATA_DIR || container.workspace;
        const provider = configured.provider || (configured.s3 ? new storage_s3_1.S3StorageProvider(configured.s3) : undefined);
        const mesh = new StorageMesh({ root, dataDir: configured.dataDir, provider, retryAfterMs: configured.retryAfterMs });
        state.set('mesh', mesh);
        mesh.onEvent((event, payload) => container.bus.emit(event, payload));
        container.bus.on('storage:ensure', async (payload) => ({ ...payload, storage: await mesh.ensure(payload.path) }));
        container.bus.on('storage:freeze', async (payload) => ({ ...payload, storage: await mesh.freeze(payload.path) }));
        container.bus.on('storage:track', async (payload) => ({ ...payload, storage: await mesh.track(payload.path) }));
        container.bus.on('storage:configure-provider', async (payload) => {
            if (!payload?.provider || typeof payload.provider.put !== 'function' || typeof payload.provider.get !== 'function')
                throw new Error('invalid storage provider');
            mesh.setProvider(payload.provider);
            return { ...payload, configured: true, provider: payload.provider.name };
        });
    },
};

};
