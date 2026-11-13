const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { _test } = require('./index.js');

// The git handlers shell out for real, so they run against a throwaway package
// inside this repository rather than a mocked porcelain string.
const PKG = 'zz-git-fixture';
const PKG_DIR = path.resolve(__dirname, '..', PKG);

const inRepo = (() => {
    try {
        execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: __dirname, stdio: 'pipe' });
        return true;
    } catch { return false; }
})();

test.before(() => { fs.mkdirSync(PKG_DIR, { recursive: true }); });
test.after(() => { fs.rmSync(PKG_DIR, { recursive: true, force: true }); });

test('gitLabel maps porcelain codes, preferring the index status', () => {
    assert.equal(_test.gitLabel('M '), 'modified');
    assert.equal(_test.gitLabel(' M'), 'modified');
    assert.equal(_test.gitLabel('A '), 'added');
    assert.equal(_test.gitLabel(' D'), 'deleted');
    assert.equal(_test.gitLabel('R '), 'renamed');
    assert.equal(_test.gitLabel('??'), 'untracked');
    assert.equal(_test.gitLabel('UU'), 'conflict');
    // Staged add with a further worktree edit still reads as "added".
    assert.equal(_test.gitLabel('AM'), 'added');
});

test('git status reports paths relative to the package, not the repo root', { skip: !inRepo }, async () => {
    fs.mkdirSync(path.join(PKG_DIR, 'views'), { recursive: true });
    fs.writeFileSync(path.join(PKG_DIR, 'views', 'New.svelte'), '<p>hi</p>\n');

    const status = await _test.handleGitStatus(PKG);
    assert.equal(status.package, PKG);
    assert.equal(status.files['views/New.svelte'], 'untracked');
    // The repo-root prefix must be stripped, otherwise nothing lines up with
    // the explorer's paths.
    assert.ok(!Object.keys(status.files).some(p => p.includes(PKG)), 'paths must not carry the package prefix');
});

test('git status of a package with no changes is empty', { skip: !inRepo }, async () => {
    const status = await _test.handleGitStatus(PKG);
    fs.rmSync(path.join(PKG_DIR, 'views'), { recursive: true, force: true });
    const after = await _test.handleGitStatus(PKG);
    assert.ok(Object.keys(status.files).length >= 1);
    assert.equal(Object.keys(after.files).length, 0);
});

test('git diff flags an untracked file instead of returning an empty diff', { skip: !inRepo }, async () => {
    fs.writeFileSync(path.join(PKG_DIR, 'fresh.js'), 'const a = 1;\n');
    const result = await _test.handleGitDiff(PKG, 'fresh.js');
    assert.equal(result.diff, '');
    assert.equal(result.untracked, true, 'an untracked file is not the same as an unchanged one');
});

test('git diff refuses to leave the package', async () => {
    for (const escape of ['../agent/index.js', '/etc/passwd']) {
        await assert.rejects(() => _test.handleGitDiff(PKG, escape), /Invalid path/);
    }
});

test('stripCodeFence unwraps fenced output and leaves bare code alone', () => {
    assert.equal(_test.stripCodeFence('```js\nconst a = 1;\n```'), 'const a = 1;');
    assert.equal(_test.stripCodeFence('```\nplain\n```'), 'plain');
    assert.equal(_test.stripCodeFence('const a = 1;'), 'const a = 1;');
    // A fence in the middle is content, not a wrapper, and must survive.
    const withInner = 'before\n```\nx\n```\nafter';
    assert.equal(_test.stripCodeFence(withInner), withInner);
});

test('every AI action declares a mode the frontend knows how to handle', () => {
    const modes = new Set(['text', 'replace']);
    for (const [id, spec] of Object.entries(_test.AI_ACTIONS)) {
        assert.ok(modes.has(spec.mode), `${id} has unknown mode ${spec.mode}`);
        assert.ok(spec.label && spec.system && spec.instruction, `${id} is missing prompt fields`);
    }
    // A 'replace' action's prompt must forbid prose, since its output is
    // written straight into the file.
    assert.match(_test.AI_ACTIONS.refactor.system, /ONLY/);
});

test('AI assist rejects bad input before spending a model call', async () => {
    await assert.rejects(
        () => _test.handleAiAssist({ packageId: PKG, filePath: 'a.js', action: 'nope', selection: 'x' }),
        (err) => err.status === 400,
    );
    await assert.rejects(
        () => _test.handleAiAssist({ packageId: PKG, filePath: 'a.js', action: 'explain', selection: '   ' }),
        (err) => err.status === 400,
    );
    await assert.rejects(
        () => _test.handleAiAssist({ packageId: PKG, filePath: 'a.js', action: 'explain', selection: 'x'.repeat(24_001) }),
        (err) => err.status === 413,
    );
});
