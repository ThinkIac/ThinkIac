const test = require('node:test');
const assert = require('node:assert/strict');
const { reactiveConfig, decideReactiveRefresh } = require('./reactive-policy');

const config = { classification: { decision: { reactive: { enabled: true, mode: 'assist', maxCallsPerTurn: 2, minIterationGap: 2, timeoutMs: 1500 } } } };

test('política reativa fica desativada por padrão', () => {
    assert.equal(reactiveConfig({}).enabled, false);
    assert.equal(reactiveConfig({}).mode, 'shadow');
    assert.equal(reactiveConfig(config).mode, 'assist');
    assert.equal(decideReactiveRefresh({ state: null, config: {}, iteration: 1 }).reason, 'disabled');
});

test('falha recuperável respeita cooldown e orçamento', () => {
    const state = { calls: 0, lastCallIteration: 1, catalogVersion: 'a' };
    assert.equal(decideReactiveRefresh({ state, config, iteration: 2, catalogVersion: 'a', signal: { recoverableFailure: true } }).reason, 'cooldown');
    assert.equal(decideReactiveRefresh({ state, config, iteration: 3, catalogVersion: 'a', signal: { recoverableFailure: true } }).action, 'refresh');
    assert.equal(decideReactiveRefresh({ state: { ...state, calls: 2 }, config, iteration: 5, catalogVersion: 'b', signal: {} }).reason, 'budget');
});

test('governança nunca dispara tentativa alternativa', () => {
    const state = { calls: 0, lastCallIteration: 0, catalogVersion: 'a' };
    const result = decideReactiveRefresh({ state, config, iteration: 4, catalogVersion: 'a', signal: { governance: 'pending', recoverableFailure: true } });
    assert.equal(result.reason, 'governance');
});
