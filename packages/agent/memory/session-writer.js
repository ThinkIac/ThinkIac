import { promises as fs, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Async writes coexist with the historical synchronous API without stale overwrites. */
export class SessionWriter {
    constructor(directory) {
        this.directory = directory;
        this.versions = new Map();
        this.committed = new Map();
        this.pending = new Map();
    }
    path(id) { return join(this.directory, `${id}.json`); }
    next(id) { const version = (this.versions.get(id) || 0) + 1; this.versions.set(id, version); return version; }
    writeSync(session) {
        const version = this.next(session.id);
        mkdirSync(this.directory, { recursive: true });
        const target = this.path(session.id);
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            writeFileSync(temporary, JSON.stringify(session, null, 2), 'utf8');
            renameSync(temporary, target);
            this.committed.set(session.id, version);
        } finally { try { unlinkSync(temporary); } catch {} }
    }
    write(session) {
        const id = session.id;
        const version = this.next(id);
        const content = JSON.stringify(session, null, 2);
        const write = async () => {
            if ((this.committed.get(id) || 0) >= version) return;
            await fs.mkdir(this.directory, { recursive: true });
            const target = this.path(id);
            const temporary = `${target}.${randomUUID()}.tmp`;
            try {
                await fs.writeFile(temporary, content, 'utf8');
                
                
                if ((this.committed.get(id) || 0) < version) {
                    renameSync(temporary, target);
                    this.committed.set(id, version);
                }
            } finally { await fs.unlink(temporary).catch(() => {}); }
        };
        const result = (this.pending.get(id) || Promise.resolve()).catch(() => {}).then(write);
        this.pending.set(id, result);
        const cleanup = () => { if (this.pending.get(id) === result) this.pending.delete(id); };
        result.then(cleanup, cleanup);
        return result;
    }
    deleteSync(id) {
        const version = this.next(id);
        try { unlinkSync(this.path(id)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        this.committed.set(id, version);
    }
}
