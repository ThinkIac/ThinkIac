"use strict";
// core/isolated — process boundary for packages declared `isolated: true`.
//
// The parent never imports package code. It receives only declarative surface
// descriptors and invokes an opaque handler id over Node's IPC channel.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IsolatedRunner = void 0;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
class IsolatedRunner {
    options;
    child = null;
    pending = new Map();
    sequence = 0;
    stopping = false;
    manifest = null;
    constructor(options) {
        this.options = options;
    }
    get running() { return Boolean(this.child && this.child.connected && !this.stopping); }
    get surfaces() { return this.manifest; }
    get pid() { return this.child?.pid; }
    async start() {
        if (this.running && this.manifest)
            return this.manifest;
        const nodeMajor = Number(process.versions.node.split('.')[0]);
        if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
            throw new Error('Isolated packages require Node.js 20+ permission mode');
        }
        this.stopping = false;
        const childPath = node_path_1.default.join(__dirname, 'child.js');
        const env = { ...this.options.env, LOGOS_TYPE_LOADER: node_path_1.default.join(node_path_1.default.dirname(require.resolve('logos')), 'kernel/type-source.js'), LOGOS_ISOLATED_PACKAGE: this.options.dir, LOGOS_ISOLATED_FOLDER: this.options.folder };
        const compilerDir = node_path_1.default.dirname(require.resolve('coffeescript/package.json', { paths: [node_path_1.default.dirname(env.LOGOS_TYPE_LOADER)] }));
        // Permission mode denies filesystem writes, child processes and workers by
        // default. Reads cover the package, bootstrap and language implementation;
        // Module._load still denies package imports outside its own root.
        this.child = (0, node_child_process_1.fork)(childPath, [], {
            cwd: this.options.dir, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            execArgv: ['--experimental-permission', `--allow-fs-read=${this.options.dir}`, `--allow-fs-read=${node_path_1.default.dirname(childPath)}`, `--allow-fs-read=${env.LOGOS_TYPE_LOADER}`, `--allow-fs-read=${compilerDir}`],
        });
        const child = this.child;
        child.on('message', message => { if (this.child === child)
            void this.onMessage(message); });
        child.once('exit', (code, signal) => {
            const expected = this.stopping || this.child !== child;
            if (this.child === child)
                this.onExit(signal ? `child terminated (${signal})` : 'child exited');
            this.options.onExit?.({ code, signal, expected, pid: child.pid });
        });
        child.once('error', error => { if (this.child === child)
            this.onExit(error.message); });
        try {
            const manifest = await this.request('start', {});
            this.manifest = manifest;
            return manifest;
        }
        catch (error) {
            await this.stop('start_failed');
            throw error;
        }
    }
    async invoke(id, args, context = {}) {
        if (!this.running)
            throw new Error(`Isolated package "${this.options.folder}" is not running`);
        return this.request('invoke', { handler: id, args, context });
    }
    async stop(reason = 'stopped') {
        const child = this.child;
        this.stopping = true;
        this.child = null;
        this.manifest = null;
        this.rejectAll(reason);
        if (!child || child.exitCode !== null || child.signalCode !== null)
            return;
        try {
            if (child.connected)
                child.send({ op: 'stop', reason });
        }
        catch { /* already gone */ }
        await new Promise(resolve => {
            const timer = setTimeout(() => { try {
                child.kill('SIGKILL');
            }
            catch { /* ignored */ } resolve(); }, 1_000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
    }
    request(op, payload) {
        const child = this.child;
        if (!child?.connected)
            return Promise.reject(new Error(`Isolated package "${this.options.folder}" is not connected`));
        const id = String(++this.sequence);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Isolated package "${this.options.folder}" ${op} timed out`));
            }, this.options.timeoutMs ?? 30_000);
            this.pending.set(id, { resolve, reject, timer });
            child.send({ op, id, ...payload }, error => {
                if (!error)
                    return;
                const pending = this.pending.get(id);
                if (!pending)
                    return;
                clearTimeout(pending.timer);
                this.pending.delete(id);
                pending.reject(error);
            });
        });
    }
    async onMessage(message) {
        if (!message || typeof message !== 'object')
            return;
        if (message.op === 'event') {
            try {
                const result = await this.options.onEvent?.(message.event, message.payload);
                this.child?.send({ op: 'event:result', id: message.id, result });
            }
            catch (error) {
                this.child?.send({ op: 'event:error', id: message.id, error: error?.message ?? String(error) });
            }
            return;
        }
        if (message.op === 'capability') {
            try {
                const result = await this.options.onCapability?.(message.request);
                this.child?.send({ op: 'capability:result', id: message.id, result });
            }
            catch (error) {
                this.child?.send({ op: 'capability:error', id: message.id, error: error?.message ?? String(error) });
            }
            return;
        }
        if (message.op === 'log') {
            this.options.onLog?.(String(message.message));
            return;
        }
        const pending = this.pending.get(String(message.id));
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pending.delete(String(message.id));
        if (message.op === 'error')
            pending.reject(new Error(message.error ?? 'isolated package failed'));
        else
            pending.resolve(message.result);
    }
    onExit(reason) {
        this.child = null;
        this.manifest = null;
        this.rejectAll(reason);
    }
    rejectAll(reason) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`Isolated package "${this.options.folder}": ${reason}`));
        }
        this.pending.clear();
    }
}
exports.IsolatedRunner = IsolatedRunner;
