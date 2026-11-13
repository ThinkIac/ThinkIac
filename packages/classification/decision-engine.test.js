const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'classification-decisions-')), 'records.json');
process.env.CLASSIFICATION_DECISIONS_FILE = FILE;
const engine = require('./decision-engine');

test('só encontra Jev em pool OpenRouter habilitado e com chave', () => {
    const config = { llm: { pools: [{ enabled: true, provider: 'openrouter', model: 'typesafe/jev-1.13', api_keys: ['secret'] }] } };
    const slot = engine.findJevSlot(config);
    assert.equal(slot.model, 'typesafe/jev-1.13');
    assert.equal(slot.mode, 'shadow');
    assert.equal(slot.endpoint, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(engine.findJevSlot({ llm: { pools: [{ enabled: false, provider: 'openrouter', model: 'typesafe/jev-1.13', api_keys: ['secret'] }] } }), null);
});

test('modo off não chama Jev nem usa recomendação local', async () => {
    const config = { classification: { decision: { mode: 'off' } }, llm: { pools: [{ enabled: true, provider: 'openrouter', model: 'typesafe/jev-1.13', api_keys: ['secret'] }] } };
    const result = await engine.decide({ intent: 'criar tarefa', candidates: [{ name: 'createTask' }], config, fetchImpl: () => { throw new Error('não deve chamar'); } });
    assert.equal(result.mode, 'off');
    assert.equal(result.recommendation, null);
});

test('Jev recebe somente estado sanitizado e rejeita opção fora das candidatas', async () => {
    let request;
    const state = engine.sanitizeState({ intent: '  criar   tarefa ', candidates: [{ name: 'createTask', description: 'Cria uma tarefa' }] });
    const answer = await engine.askJev({ endpoint: 'https://example.test/alpha/decisions', key: 'secret', model: 'typesafe/jev-1.13' }, state, async (_url, options) => {
        request = JSON.parse(options.body);
        return { ok: true, json: async () => ({ answers: { primaryTool: { choice: 'createTask', confidence: 0.92 } } }) };
    });
    assert.equal(request.questions.primaryTool.type, 'choice');
    assert.deepEqual(request.questions.primaryTool.criteria, { createTask: 'Cria uma tarefa' });
    assert.equal(answer.choice, 'createTask');
    await assert.rejects(() => engine.askJev({ endpoint: 'x', key: 'secret', model: 'm' }, state, async () => ({ ok: true, json: async () => ({ answers: { primaryTool: { choice: 'inventada' } } }) })), /inválida/);
});

test('Jev cancela a requisição ao exceder o timeout', async () => {
    const state = engine.sanitizeState({ intent: 'criar tarefa', candidates: [{ name: 'createTask' }] });
    const waitingFetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
    await assert.rejects(
        () => engine.askJev({ endpoint: 'x', key: 'secret', model: 'm' }, state, waitingFetch, { timeoutMs: 5 }),
        /aborted/
    );
});

test('experiência local só recomenda após evidência suficiente e aprende com resultado', () => {
    const candidates = [{ name: 'createTask' }, { name: 'sendEmail' }];
    for (let index = 0; index < 3; index++) {
        const record = engine.recordDecision({ sessionId: `s${index}`, intent: 'criar tarefa para amanhã', candidates, mode: 'shadow' });
        engine.setFinalTools(record.id, ['createTask']);
        engine.observeDecision(record.id, 'createTask', true);
    }
    const recommendation = engine.recommendFromHistory('crie uma tarefa amanhã', candidates);
    assert.equal(recommendation.choice, 'createTask');
    assert.ok(recommendation.evidence >= 2);
});
