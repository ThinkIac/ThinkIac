/**
 * experience.js — Self-Modeling Layer
 *
 * Registra automaticamente a tríade (intenção → ferramenta → resultado) em
 * um armazenamento local JSON. Permite que o agente consulte sua própria
 * experiência operacional entre sessões — sem depender do core.
 *
 * Fluxo nos hooks:
 *   agent:start   → captureIntent(sessionId, message)
 *   agent:tool-end → recordExperience(sessionId, tool, result, is_error)
 *
 * Tools expostas:
 *   query_experience({ intent, limit })  → busca experiências similares
 *   record_experience({ intent, tool, success, result }) → registro manual
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'experiences.json');
const PREFIX = 'exp';
const MAX_INTENTS_IN_MEMORY = 5;
const MAX_EXPERIENCES_FILE = 500;
const RECENCY_WEIGHT_DAYS = 30; // experiências mais recentes ganham peso maior

// ─── Intenções da sessão (em memória, volátil) ─────────────────────────────
const sessionIntents = new Map();

// Resultados de tools podem conter proxies do Scriba. Eles apontam de volta para
// o Runtime por `_scriba`, portanto não são JSON puro. O registro de experiência
// é observacional e nunca deve fazer uma tool bem-sucedida falhar por isso.
function safeJson(value) {
    const seen = new WeakSet();
    try {
        return JSON.stringify(value, (key, current) => {
            if (key === '_scriba') return '[Runtime]';
            if (typeof current === 'object' && current !== null) {
                if (seen.has(current)) return '[Circular]';
                seen.add(current);
            }
            return current;
        });
    } catch {
        return '[resultado não serializável]';
    }
}

// ─── Helpers de Persistência ───────────────────────────────────────────────
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAll() {
    ensureDataDir();
    try {
        if (!fs.existsSync(FILE)) return [];
        return JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
        return [];
    }
}

function saveAll(experiences) {
    ensureDataDir();
    // Mantém apenas os mais recentes (remove os mais antigos)
    const trimmed = experiences.slice(-MAX_EXPERIENCES_FILE);
    fs.writeFileSync(FILE, JSON.stringify(trimmed, null, 2), 'utf8');
}

// ─── Similaridade simples por palavra-chave ─────────────────────────────────
function computeSimilarity(a, b) {
    const wa = a.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const wb = b.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (!wa.length || !wb.length) return 0;
    const common = wa.filter(w => wb.includes(w)).length;
    return common / Math.sqrt(wa.length * wb.length);
}

// ─── Score combinado: similaridade + recência ────────────────────────────────
function computeRecencyScore(timestamp) {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    // Decaimento exponencial: 1.0 para hoje, ~0.37 para 30 dias
    return Math.exp(-ageDays / RECENCY_WEIGHT_DAYS);
}

// ─── 1. Captura a intenção do usuário (síncrono) ───────────────────────────
function captureIntent(sessionId, message) {
    if (!sessionId || !message) return null;

    const raw = message.trim().slice(0, 300);
    const intent = raw.replace(/\s+/g, ' ');

    if (!sessionIntents.has(sessionId)) {
        sessionIntents.set(sessionId, {
            currentIntent: intent,
            recentIntents: [],
        });
    } else {
        const data = sessionIntents.get(sessionId);
        data.recentIntents.push(data.currentIntent);
        if (data.recentIntents.length > MAX_INTENTS_IN_MEMORY) {
            data.recentIntents.shift();
        }
        data.currentIntent = intent;
    }

    return intent;
}

function getCurrentIntent(sessionId) {
    const data = sessionIntents.get(sessionId);
    return data ? data.currentIntent : null;
}

// ─── 2. Registra uma experiência no arquivo local ───────────────────────────
async function recordExperience(sessionId, tool, result, is_error) {
    if (!sessionId || !tool) return { recorded: false, reason: 'missing sessionId or tool' };

    const intent = getCurrentIntent(sessionId) || 'unknown';
    const success = !is_error;

    const resultPreview = typeof result === 'string'
        ? result.slice(0, 200)
        : result && typeof result === 'object'
            ? safeJson(result).slice(0, 200)
            : String(result || '');

    const hasError = is_error || (result && typeof result === 'object' && result.error);

    const experience = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        intent,
        tool,
        success,
        hasError: !!hasError,
        result: resultPreview,
        sessionId,
        timestamp: new Date().toISOString(),
    };

    const all = readAll();
    all.push(experience);
    saveAll(all);

    return { recorded: true, id: experience.id, intent, tool, success };
}

// ─── 3. Consulta experiências similares por similaridade + recência ─────────
async function queryExperience(intent, limit = 5) {
    if (!intent) return [];

    const all = readAll();
    if (!all.length) return [];

    // Calcula score combinado: similaridade (70%) + recência (30%)
    const scored = all
        .map(e => {
            const simScore = computeSimilarity(intent, e.intent);
            const recScore = computeRecencyScore(e.timestamp);
            // Score final: 70% similaridade + 30% recência
            const _score = (simScore * 0.7) + (recScore * 0.3);
            return { ...e, _score, _simScore: simScore, _recScore: recScore };
        })
        .filter(e => e._score > 0.05)  // limiar mínimo mais baixo (recência ajuda)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit);

    return scored.map(({ _score, _simScore, _recScore, ...e }) => e);
}

// ─── 4. Monta bloco markdown para o system prompt ──────────────────────────
async function buildExperienceBlock(sessionId, currentIntent, maxItems = 3) {
    const intent = currentIntent || getCurrentIntent(sessionId);
    if (!intent) return '';

    const experiences = await queryExperience(intent, maxItems + 1);

    // Filtra experiências da mesma sessão
    const filtered = experiences.filter(e => e.sessionId !== sessionId && e.success && !e.hasError).slice(0, maxItems);
    if (!filtered.length) return '';

    const lines = filtered.map((e, i) => {
        const status = e.hasError ? '❌ falhou' : (e.success ? '✅ funcionou' : '⚠️ misto');
        return `  ${i + 1}. \`${e.tool}\` ${status} — "${e.intent.slice(0, 80)}"`;
    });

    return [
        '',
        '---',
        '🧠 **Experiência Anterior (Self-Modeling):**',
        ...lines,
        `  _Consulte \`query_experience\` para mais detalhes._`,
        '---',
    ].join('\n');
}

// ─── 5. Limpeza de experiências antigas de uma sessão ──────────────────────
function cleanSession(sessionId) {
    const all = readAll();
    const filtered = all.filter(e => e.sessionId !== sessionId);
    saveAll(filtered);
    sessionIntents.delete(sessionId);
}

// ─── 6. Estatísticas ────────────────────────────────────────────────────────
function getStats() {
    const all = readAll();
    const byTool = {};
    for (const e of all) {
        if (!byTool[e.tool]) byTool[e.tool] = { total: 0, success: 0, fail: 0 };
        byTool[e.tool].total++;
        if (e.hasError) byTool[e.tool].fail++;
        else if (e.success) byTool[e.tool].success++;
    }
    return {
        total: all.length,
        sessions: [...new Set(all.map(e => e.sessionId))].length,
        tools: Object.keys(byTool).length,
        byTool,
    };
}

module.exports = {
    safeJson,
    captureIntent,
    getCurrentIntent,
    recordExperience,
    queryExperience,
    buildExperienceBlock,
    cleanSession,
    getStats,
    // Wrappers para tools.js (recebem objeto, retornam para ferramenta)
    queryExperienceTool: async (data) => {
        const experiences = await queryExperience(data.intent, data.limit || 5);
        return {
            total: experiences.length,
            experiences,
            tip: experiences.length > 0
                ? 'Considere esses resultados ao escolher a abordagem.'
                : 'Nenhuma experiência similar encontrada para esta intenção.',
        };
    },
    recordExperienceTool: async (data) => {
        const sessionId = data.sessionId || 'default';
        const result = await recordExperience(
            sessionId,
            data.tool,
            data.result || (data.success !== false ? 'ok' : 'erro'),
            data.success === false
        );
        return result;
    },
};
