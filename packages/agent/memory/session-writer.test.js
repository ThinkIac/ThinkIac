import test, { mock } from 'node:test';
import { promises as fs } from 'node:fs';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionWriter } from './session-writer.js';

test('orders async commits and preserves newer synchronous writes/deletion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-writer-'));
    try {
        const writer = new SessionWriter(dir);
        const first = writer.write({ id: 's', messages: ['first'] });
        const second = writer.write({ id: 's', messages: ['first', 'second'] });
        await Promise.all([first, second]);
        assert.deepEqual(JSON.parse(readFileSync(writer.path('s'), 'utf8')).messages, ['first', 'second']);
        const stale = writer.write({ id: 's', messages: ['stale'] });
        writer.writeSync({ id: 's', messages: ['newer'] });
        await stale;
        assert.deepEqual(JSON.parse(readFileSync(writer.path('s'), 'utf8')).messages, ['newer']);
        const pending = writer.write({ id: 's', messages: ['must not resurrect'] });
        writer.deleteSync('s');
        await pending;
        assert.equal(existsSync(writer.path('s')), false);
        assert.deepEqual(readdirSync(dir), []);
        await writer.write({ id: 's', messages: ['recreated explicitly'] });
        assert.equal(existsSync(writer.path('s')), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a legacy write during async disk I/O is never replaced by the older snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-writer-race-'));
    let release;
    try {
        const writer = new SessionWriter(dir);
        const original = fs.writeFile;
        let entered;
        const started = new Promise(resolve => { entered = resolve; });
        const held = new Promise(resolve => { release = resolve; });
        const stub = mock.method(fs, 'writeFile', async (...args) => {
            await original(...args); entered(); await held;
        });
        const older = writer.write({ id: 's', value: 'older' });
        await started;
        writer.writeSync({ id: 's', value: 'newer' });
        release(); await older;
        assert.equal(JSON.parse(readFileSync(writer.path('s'), 'utf8')).value, 'newer');
        stub.mock.restore();
    } finally { release?.(); mock.restoreAll(); rmSync(dir, { recursive: true, force: true }); }
});
