"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TailwindStyles = void 0;
const worker_threads_1 = require("worker_threads");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const assets_1 = require("./assets.cjs");
/** Optional acceleration: the existing browser compiler remains a compatibility fallback. */
class TailwindStyles {
    cacheDir;
    pluginPath;
    pending = new Map();
    failedUntil = new Map();
    queue = Promise.resolve();
    constructor(cacheDir, pluginPath) {
        this.cacheDir = cacheDir;
        this.pluginPath = pluginPath;
    }
    async build(manifest, theme, workspace) {
        if (!manifest?.files)
            return null;
        let pluginPath;
        try {
            pluginPath = this.pluginPath ?? require.resolve('@tailwindcss/postcss');
        }
        catch {
            return null;
        }
        const key = (0, crypto_1.createHash)('md5').update('css-v1:' + manifest.hash + JSON.stringify(theme)).digest('hex');
        if ((this.failedUntil.get(key) ?? 0) > Date.now())
            return null;
        const name = `tailwind.${key}.css`;
        const output = path_1.default.join(this.cacheDir, name);
        try {
            await fs_1.promises.access(output);
            return name;
        }
        catch { /* build */ }
        const pending = this.pending.get(key);
        if (pending)
            return pending;
        if (this.pending.size >= 32)
            return null;
        const work = this.queue.then(async () => {
            const css = await new Promise((resolve, reject) => {
                const worker = new worker_threads_1.Worker(path_1.default.join(__dirname, 'tailwind-worker.cjs'), {
                    workerData: { pluginPath, files: Object.keys(manifest.files), theme, workspace, cacheDir: this.cacheDir },
                });
                const timer = setTimeout(() => { reject(new Error('CSS build timed out')); void worker.terminate(); }, 30000);
                const finish = () => { clearTimeout(timer); void worker.terminate(); };
                worker.once('message', message => { finish(); message.error ? reject(new Error(message.error)) : resolve(message.css); });
                worker.once('error', error => { finish(); reject(error); });
                worker.once('exit', code => { clearTimeout(timer); if (code)
                    reject(new Error(`CSS worker exited: ${code}`)); });
            });
            await fs_1.promises.writeFile(output, css);
            await (0, assets_1.precompressAssets)([output]);
            return name;
        }).catch(error => {
            if (this.failedUntil.size >= 512)
                this.failedUntil.clear();
            this.failedUntil.set(key, Date.now() + 60000);
            console.warn(`[views:css] falling back to browser compiler: ${error.message}`);
            return null;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, work);
        this.queue = work;
        return work;
    }
}
exports.TailwindStyles = TailwindStyles;
//# sourceMappingURL=tailwind-styles.js.map