"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileDigests = void 0;
const fs_1 = require("fs");
const crypto_1 = require("crypto");
/** Bounded concurrent I/O; ctime detects edits whose mtime was restored. */
class FileDigests {
    cache = new Map();
    pending = new Map();
    invalidate(file) { this.cache.delete(file); }
    hash(file) {
        const pending = this.pending.get(file);
        if (pending)
            return pending;
        const work = this.read(file).finally(() => this.pending.delete(file));
        this.pending.set(file, work);
        return work;
    }
    async read(file) {
        try {
            const stat = await fs_1.promises.stat(file, { bigint: true });
            const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
            const cached = this.cache.get(file);
            if (cached?.signature === signature)
                return cached.hash;
            const data = await fs_1.promises.readFile(file);
            const hash = (0, crypto_1.createHash)('md5').update(data).digest('hex');
            const after = await fs_1.promises.stat(file, { bigint: true });
            if (after.ctimeNs === stat.ctimeNs && after.mtimeNs === stat.mtimeNs && after.size === stat.size) {
                if (this.cache.size >= 20000)
                    this.cache.delete(this.cache.keys().next().value);
                this.cache.set(file, { signature, hash });
            }
            return hash;
        }
        catch {
            this.cache.delete(file);
            return 'gone';
        }
    }
    async graph(files) {
        const result = {};
        let index = 0;
        await Promise.all(Array.from({ length: Math.min(16, files.length) }, async () => {
            while (index < files.length) {
                const file = files[index++];
                result[file] = await this.hash(file);
            }
        }));
        return result;
    }
}
exports.FileDigests = FileDigests;
//# sourceMappingURL=file-digests.js.map