/**
 * Decisor opcional para o roteamento de tools.
 *
 * Jev é apenas uma fonte de recomendação. A elegibilidade, a lista final de
 * tools e a governança permanecem nos fluxos existentes do Runtime.
 */
const fs = require('node:fs');
const path = require('node:path');

// A configuração de pools do Runtime mora no pacote agent. O caminho antigo
// apontava para um pacote aurora que não existe neste workspace e impedia a
// descoberta de Jev quando `decide()` era chamado sem config explícita.
const AURORA_CONFIG = path.join(__dirname, '..', 'agent', 'agent.config.json');
const DATA_FILE = process.env.CLASSIFICATION_DECISIONS_FILE
    || path.join(__dirname, '..', 'classification', 'data', 'decision-experiences.json');
const MAX_RECORDS = 2_000;

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Classification owns prioritization. Cognitive Engine may offer additional
// observers, but it is never required to select a tool or skill.
function decisionMode(config = {}, kind = 'tools') {
    const decision = config?.classification?.decision || {};
    const configured = kind === 'skills' ? decision.skillsMode : decision.mode;
    return configured == null ? 'shadow' : configured;
}

function saveRecords(records) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(records.slice(-MAX_RECORDS), null, 2), 'utf8');
}

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function similarity(a, b) {
    const words = value => new Set(normalize(value).split(/[^a-z0-9]+/).filter(word => word.length >= 4));
    const left = words(a);
    const right = words(b);
    if (!left.size || !right.size) return 0;
    let common = 0;
    for (const word of left) if (right.has(word)) common += 1;
    return common / Math.sqrt(left.size * right.size);
}

function recency(timestamp) {
    const ageDays = Math.max(0, Date.now() - new Date(timestamp).getTime()) / 86_400_000;
    return Math.exp(-ageDays / 30);
}

function poolModel(pool) {
    if (typeof pool.model === 'string' && /^~?typesafe\/jev-/i.test(pool.model)) return pool.model;
    const models = Array.isArray(pool.models) ? pool.models : [];
    const match = models.find(model => {
        const id = typeof model === 'string' ? model : model?.id;
        return typeof id === 'string' && /^~?typesafe\/jev-/i.test(id);
    });
    return typeof match === 'string' ? match : match?.id || null;
}

function findJevSlot(config = readJson(AURORA_CONFIG, {}), kind = 'tools') {
    for (const pool of config?.llm?.pools || []) {
        if (!pool?.enabled || pool.provider !== 'openrouter') continue;
        const model = poolModel(pool);
        if (!model || !/^~?typesafe\/jev-/i.test(model)) continue;
        const entry = Array.isArray(pool.api_keys) ? pool.api_keys[0] : pool.api_key;
        const key = typeof entry === 'object' ? entry?.key : entry;
        if (!key) continue;
        const configuredMode = decisionMode(config, kind);
        return {
            model,
            key,
            // A API de decisões é alpha e fica fora do prefixo OpenAI
            // compatível `/api/v1` usado pelo restante do pool.
            endpoint: new URL('/api/alpha/decisions', pool.base_url || 'https://openrouter.ai').toString(),
            mode: configuredMode == null ? 'shadow' : (['off', 'shadow', 'assist'].includes(configuredMode) ? configuredMode : 'off'),
        };
    }
    return null;
}

function sanitizeState({ intent, candidates }) {
    return {
        intent: String(intent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        candidates: (candidates || []).map(candidate => ({
            name: String(candidate.name || '').slice(0, 120),
            description: String(candidate.description || '').replace(/\s+/g, ' ').slice(0, 240),
        })).filter(candidate => candidate.name),
    };
}

async function askJev(slot, state, fetchImpl = globalThis.fetch, { timeoutMs = 1500, signal, kind = 'tools', questions, answerKey = 'primaryTool' } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch indisponível');
    const startedAt = Date.now();
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener?.('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Jev timeout')), timeoutMs);
    let response;
    try {
      response = await fetchImpl(slot.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${slot.key}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
            model: slot.model,
            state,
            questions: questions || {
                primaryTool: {
                    type: 'choice',
                    instructions: kind === 'skills' ? 'Qual bloco de instruções especializadas é relevante para a intenção? Escolha somente entre as candidatas. A recomendação auxilia o roteador; não concede permissões.' : 'Qual ferramenta é a melhor primeira ação para cumprir a intenção? Escolha somente entre as candidatas.',
                    criteria: Object.fromEntries(state.candidates.map(candidate => [candidate.name, candidate.description || candidate.name])),
                },
            },
        }),
      });
    if (!response.ok) {
        const error = await response.json().catch(() => null);
        const message = String(error?.error?.message || error?.message || '').replace(/\s+/g, ' ').slice(0, 240);
        throw new Error(`Jev respondeu HTTP ${response.status}${message ? `: ${message}` : ''}`);
    }
    const body = await response.json();
    const answer = body.answers?.[answerKey] || body.decisions?.[answerKey] || body[answerKey] || {};
    const choice = answer.choice ?? answer.value ?? answer.answer ?? null;
    const confidence = Number(answer.confidence ?? answer.probability ?? answer.probabilities?.[choice] ?? body.confidence ?? 0);
    if (!state.candidates.some(candidate => candidate.name === choice)) throw new Error('Jev devolveu candidata inválida');
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Jev devolveu confiança inválida');
    return { choice, confidence, latencyMs: Date.now() - startedAt, rawProvider: 'jev', answers: body.answers || body.decisions || {} };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
    }
}

function recommendFromHistory(intent, candidates, records = readJson(DATA_FILE, [])) {
    const scores = new Map((candidates || []).map(candidate => [candidate.name, { score: 0, evidence: 0 }]));
    for (const record of records) {
        if (!record?.outcome || !Array.isArray(record.finalTools)) continue;
        const weight = similarity(intent, record.intent) * 0.7 + recency(record.timestamp) * 0.3;
        for (const tool of record.finalTools) {
            const score = scores.get(tool);
            if (!score) continue;
            score.evidence += weight;
            score.score += weight * (record.outcome.success ? 1 : -1);
        }
    }
    const ranked = [...scores.entries()]
        .filter(([, score]) => score.evidence >= 2)
        .sort((a, b) => b[1].score - a[1].score);
    if (!ranked.length || ranked[0][1].score <= 0) return null;
    const [choice, score] = ranked[0];
    return { choice, confidence: Math.min(0.9, Math.max(0, score.score / score.evidence)), evidence: score.evidence, rawProvider: 'history' };
}

function recordDecision({ sessionId, intent, candidates, recommendation, mode }) {
    const records = readJson(DATA_FILE, []);
    const record = {
        id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sessionId,
        intent: String(intent || '').slice(0, 500),
        candidates: (candidates || []).map(candidate => candidate.name).filter(Boolean),
        recommendation: recommendation ? { choice: recommendation.choice, confidence: recommendation.confidence, provider: recommendation.rawProvider } : null,
        mode,
        finalTools: [],
        outcome: null,
        timestamp: new Date().toISOString(),
    };
    records.push(record);
    saveRecords(records);
    return record;
}

function setFinalTools(id, finalTools) {
    const records = readJson(DATA_FILE, []);
    const record = records.find(item => item.id === id);
    if (!record) return false;
    record.finalTools = [...new Set(finalTools || [])].slice(0, 30);
    saveRecords(records);
    return true;
}

function observeDecision(id, tool, success) {
    const records = readJson(DATA_FILE, []);
    const record = records.find(item => item.id === id);
    if (!record || !record.finalTools.includes(tool)) return false;
    record.outcome = { tool, success: Boolean(success), timestamp: new Date().toISOString() };
    saveRecords(records);
    return true;
}

async function decide({ intent, candidates, config, fetchImpl, timeoutMs, signal, kind = 'tools', loadLaya } = {}) {
    config = config || readJson(AURORA_CONFIG, {});
    const state = sanitizeState({ intent, candidates });
    const configuredMode = decisionMode(config, kind);
    if (config && configuredMode != null && !['shadow', 'assist'].includes(configuredMode)) return { recommendation: null, mode: 'off', available: false, error: null };
    const slot = findJevSlot(config, kind);
    if (slot?.mode === 'off') return { recommendation: null, mode: 'off', available: false, error: null };
    if (slot) {
        try { return { recommendation: await askJev(slot, state, fetchImpl, { timeoutMs, signal, kind }), mode: slot.mode, available: true }; }
        catch (remoteError) {
            return { recommendation: (kind === 'skills' ? null : recommendFromHistory(state.intent, state.candidates)), mode: slot.mode, available: false, error: remoteError.message };
        }
    }
    return { recommendation: (kind === 'skills' ? null : recommendFromHistory(state.intent, state.candidates)), mode: 'shadow', available: false, error: null };
}

function loadDecisionConfig() { return readJson(AURORA_CONFIG, {}); }

module.exports = { loadDecisionConfig, findJevSlot, sanitizeState, askJev, recommendFromHistory, recordDecision, setFinalTools, observeDecision, decide };
