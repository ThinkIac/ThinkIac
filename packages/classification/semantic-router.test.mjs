import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticRouter, validateVector, createAndroidEncoder } from './semantic-router.mjs';
import protocol from './protocol.js';

const examples = protocol.validateContribution('clock', [{ id: 'time', utterances: ['que horas são'], target: { type: 'tool', value: 'clockNow' }, threshold: .8 }]);
const vector = () => [1, ...Array(383).fill(0)];

test('semantic match, coalescing, defensive cache and per-iteration availability', async () => {
  let calls = 0;
  const router = new SemanticRouter(examples, { encode: async () => { calls++; return vector(); } });
  const [a, b] = await Promise.all([router.classify('horário atual'), router.classify('horário atual')]);
  assert.equal(a.encoder, 'multilingual-e5-small');
  assert.equal(calls, 2);
  a.target.value = 'invalid';
  assert.equal(b.target.value, 'clockNow');
  const cached = await router.classify('horário atual');
  assert.equal(calls, 2);
  assert.equal(protocol.reconcileDecision(cached, []).status, 'unavailable');
  assert.equal(protocol.reconcileDecision(cached, [{ name: 'clockNow' }]).status, 'eligible');
});

test('bridge failure falls back, backs off, and recovers without caching lexical as semantic', async () => {
  let time = 0, calls = 0, fail = true;
  const router = new SemanticRouter(examples, { now: () => time, retryMs: 10, encode: async () => { calls++; if (fail) throw Error('offline'); return vector(); } });
  assert.equal((await router.classify('que horas são')).degraded, true);
  await router.classify('que horas são');
  assert.equal(calls, 1);
  time = 11; fail = false;
  assert.equal((await router.classify('que horas são')).degraded, false);
});

test('rejects malformed and non-finite vectors', () => {
  for (const value of [[], Array(384).fill(0), Array(384).fill(NaN), Array(384).fill(Infinity)]) assert.throws(() => validateVector(value));
  assert.equal(Math.hypot(...validateVector(Array(384).fill(2))).toFixed(6), '1.000000');
});

test('missing bridge credentials never issue HTTP requests', async () => {
  const encode = createAndroidEncoder({ root: '', token: '', fetchImpl: () => { throw Error('unexpected network'); } });
  await assert.rejects(encode('hi'), /unavailable/);
});

test('cold encoder cannot block a turn beyond the budget', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const router = new SemanticRouter(examples, { budgetMs: 10, encode: async () => { await gate; return vector(); } });
  assert.equal((await router.classify('que horas são')).fallbackReason, 'encoder_warming');
  release();
  await router.pending.get('que horas são');
  assert.equal((await router.classify('que horas são')).degraded, false);
});
