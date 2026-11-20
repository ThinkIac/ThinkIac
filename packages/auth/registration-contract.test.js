import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerRoutes, registerHooks, registerCommands } from 'logos';
import * as auth from './index.js';
const baseline = JSON.parse(readFileSync(new URL('./test/entry-contract.json', import.meta.url)));
const folder = new URL('.', import.meta.url).pathname;
const sorted = values => [...values].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

test('Logos discovers every original HTTP route exactly once with the same public boundary', async () => {
    const actual = (await registerRoutes(folder)).filter(route => route._file.endsWith('/index.js'))
        .map(({ path, method, public: isPublic }) => ({ path, method, public: isPublic }));
    assert.deepEqual(sorted(actual), sorted(baseline.routes));
    const all = await registerRoutes(folder);
    assert.equal(new Set(all.map(r => `${r.method}:${r.path}`)).size, all.length);
});
test('Logos preserves lifecycle, credential hooks and commands without duplicate adapters', async () => {
    const hooks = (await registerHooks(folder)).map(h => h.event);
    assert.deepEqual(sorted(hooks), sorted([...baseline.hooks, 'auth:resolve-principal', 'auth:check-permission']));
    const commands = await registerCommands(folder);
    assert.equal(commands.length, baseline.commands.length);
    for (const name of baseline.exports) assert.ok(name in auth, `Missing compatibility export: ${name}`);
});
