const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  ExampleRouter, discoverContributions, embedText, reconcileDecision, validateContribution,
} = require('./protocol');

test('pacotes declaram exemplos e o roteador escolhe o alvo enviesado', () => {
  const examples = validateContribution('clock', [{
    id: 'current-time',
    utterances: ['que horas são', 'me diga a hora agora'],
    target: { type: 'tool', value: 'clockNow' },
    threshold: 0.55,
  }]);
  const decision = new ExampleRouter(examples).classify('pode me dizer que horas sao?');
  assert.equal(decision.package, 'clock');
  assert.deepEqual(decision.target, { type: 'tool', value: 'clockNow' });
  assert.ok(decision.score >= 0.55);
});

test('baixa confiança não força uma rota', () => {
  const examples = validateContribution('clock', [{
    id: 'current-time', utterances: ['que horas são'],
    target: { type: 'response', value: 'Agora são...' }, threshold: 0.9,
  }]);
  assert.equal(new ExampleRouter(examples).classify('escreva um aplicativo'), null);
});

test('embedding local é normalizado e determinístico', () => {
  assert.deepEqual([...embedText('Olá mundo')], [...embedText('ola mundo')]);
});

test('protocolo rejeita alvo perigoso ou incompleto', () => {
  assert.throws(() => validateContribution('bad', [{ id: 'x', utterances: ['x'], target: { type: 'shell' } }]));
});

test('tool declarada só é elegível quando seu schema está na iteração', () => {
  const decision = {
    package: 'clock', id: 'current-time', score: .91,
    target: { type: 'tool', value: 'clockNow' },
  };
  const context = { runId: 'run-1', iteration: 2, catalogVersion: 'catalog-a' };
  const unavailable = reconcileDecision(decision, [{ name: 'otherTool' }], context);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.tool, null);
  const eligible = reconcileDecision(decision, [{ name: 'clockNow', package: 'clock' }], context);
  assert.equal(eligible.status, 'eligible');
  assert.deepEqual(eligible.tool, { name: 'clockNow', package: 'clock' });
  assert.equal(eligible.iteration, 2);
  assert.equal(eligible.catalogVersion, 'catalog-a');
});

test('descobre a contribuição canônica do Engineer', () => {
  const examples = discoverContributions(path.dirname(__dirname));
  const engineer = examples.find(example => example.pkg === 'engineer' && example.id === 'workspace-shell');
  assert.ok(engineer);
  assert.deepEqual(engineer.target, { type: 'tool', value: 'run_shell' });
});

test('descobre a rota local de criação de artefato', () => {
  const examples = discoverContributions(path.dirname(__dirname));
  const artifact = examples.find(example => example.pkg === 'artifacts' && example.id === 'create-deliverable');
  assert.ok(artifact);
  assert.deepEqual(artifact.target, { type: 'tool', value: 'create_artifact' });
});


test('cache limitado evita inferência repetida sem reter disponibilidade', () => {
  let calls = 0;
  const examples = validateContribution('clock', [{
    id: 'time', utterances: ['hora'],
    target: { type: 'tool', value: 'clockNow' }, threshold: .9,
  }]);
  const router = new ExampleRouter(examples, {
    embed: text => { calls++; return embedText(text); }, cacheSize: 2,
  });
  const first = router.classify('hora');
  first.target.value = 'mutated';
  assert.equal(router.classify('hora').target.value, 'clockNow');
  assert.equal(calls, 2);
  assert.equal(reconcileDecision(router.classify('hora'), []).status, 'unavailable');
  assert.equal(reconcileDecision(router.classify('hora'), [{ name: 'clockNow' }]).status, 'eligible');
  router.classify('unrelated');
  router.classify('unrelated');
  assert.equal(calls, 3);
  router.classify('third');
  router.classify('hora');
  assert.equal(calls, 5);
});

test('catálogo vazio não calcula embedding', () => {
  const router = new ExampleRouter([], { embed: () => { throw Error('unexpected'); } });
  assert.equal(router.classify('hello'), null);
});
