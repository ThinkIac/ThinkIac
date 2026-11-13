const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(__dirname, 'approximation-config.json');
const approximation = require('./approximation');

let original;

test.beforeEach(() => {
    original = fs.readFileSync(CONFIG_FILE, 'utf8');
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ sessions: {}, oneShotFull: {}, global: 'compact' }, null, 2));
});

test.afterEach(() => fs.writeFileSync(CONFIG_FILE, original));

test('full de sessão é persistido como concessão de uma iteração', () => {
    assert.equal(approximation.setLevel('active', 'full').success, true);
    assert.equal(approximation.getLevel('active'), 'full');
    assert.equal(approximation.consumeLevel('active'), 'full');
    assert.equal(approximation.getLevel('active'), 'compact');
    assert.equal(approximation.consumeLevel('active'), 'compact');
});

test('concessão full sobrevive a reload/reinício até ser consumida', () => {
    approximation.setLevel('restart', 'full');
    delete require.cache[require.resolve('./approximation')];
    const reloaded = require('./approximation');
    assert.equal(reloaded.consumeLevel('restart'), 'full');
    assert.equal(reloaded.getLevel('restart'), 'compact');
});

test('overrides full legados são migrados e não voltam a elevar sessões mortas', () => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ sessions: { dead: 'full', kept: 'detailed' }, global: 'full' }));
    assert.equal(approximation.getLevel('dead'), 'compact');
    assert.equal(approximation.getLevel('kept'), 'detailed');
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    assert.deepEqual(saved.sessions, { kept: 'detailed' });
    assert.equal(saved.global, 'compact');
});

test('full global é rejeitado sem alterar a configuração', () => {
    const before = fs.readFileSync(CONFIG_FILE, 'utf8');
    const result = approximation.setLevel(null, 'full', 'global');
    assert.equal(result.success, false);
    assert.match(result.error, /global/);
    assert.equal(fs.readFileSync(CONFIG_FILE, 'utf8'), before);
});

test('compact e detailed continuam persistentes por sessão', () => {
    approximation.setLevel('compact-session', 'compact');
    approximation.setLevel('detailed-session', 'detailed');
    assert.equal(approximation.consumeLevel('compact-session'), 'compact');
    assert.equal(approximation.consumeLevel('detailed-session'), 'detailed');
    assert.equal(approximation.getLevel('detailed-session'), 'detailed');
});
