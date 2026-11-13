const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'approximation-config.json');

// ─── Modos de aproximação ───────────────────────────────────────────────────
const MODES = {
    compact: {
        maxTools: 8,
        descriptionDepth: 'summary',
        modelRequirements: { requires: { modalities: ['text:input'] }, prefers: { latency: 'low', cost: 'low' } },
        label: 'Compacto',
        description: 'Apenas ~8 tools essenciais. Rápido e econômico.'
    },
    detailed: {
        maxTools: 25,
        descriptionDepth: 'detailed',
        modelRequirements: { requires: { modalities: ['text:input'] }, prefers: { latency: 'medium' } },
        label: 'Detalhado',
        description: '~25 tools com descrições completas. Equilíbrio.'
    },
    full: {
        maxTools: 999,
        descriptionDepth: 'full',
        modelRequirements: { requires: { modalities: ['text:input'] }, prefers: { reasoning: 'high' } },
        label: 'Completo (100%)',
        description: 'TODAS as tools disponíveis com descrições completas. Máximo contexto.'
    }
};

const DEFAULT_APPROXIMATION = 'compact';

// ─── IO ─────────────────────────────────────────────────────────────────────

function load() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return { sessions: {}, global: DEFAULT_APPROXIMATION };
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        let migrated = false;

        if (!config.sessions || typeof config.sessions !== 'object') {
            config.sessions = {};
            migrated = true;
        }
        if (!config.oneShotFull || typeof config.oneShotFull !== 'object') {
            config.oneShotFull = {};
            migrated = true;
        }

        // `full` era persistente e podia sobreviver indefinidamente em sessões
        // abandonadas. Overrides legados não viram concessões novas: são removidos.
        for (const [sessionId, level] of Object.entries(config.sessions)) {
            if (level === 'full') {
                delete config.sessions[sessionId];
                migrated = true;
            }
        }
        if (config.global === 'full' || !MODES[config.global]) {
            config.global = DEFAULT_APPROXIMATION;
            migrated = true;
        }

        if (migrated) save(config);
        return config;
    } catch {
        return { sessions: {}, global: DEFAULT_APPROXIMATION };
    }
}

function save(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// ─── API ────────────────────────────────────────────────────────────────────

function getLevel(sessionId) {
    const config = load();
    if (sessionId && config.oneShotFull?.[sessionId]) return 'full';
    return config.sessions?.[sessionId] || config.global || DEFAULT_APPROXIMATION;
}

function consumeLevel(sessionId) {
    const config = load();
    if (sessionId && config.oneShotFull?.[sessionId]) {
        delete config.oneShotFull[sessionId];
        save(config);
        return 'full';
    }
    return config.sessions?.[sessionId] || config.global || DEFAULT_APPROXIMATION;
}

function setLevel(sessionId, level, scope = 'session') {
    const config = load();
    if (!MODES[level]) {
        return { success: false, error: `Nível inválido: "${level}". Válidos: ${Object.keys(MODES).join(', ')}` };
    }
    if (scope === 'global') {
        if (level === 'full') {
            return { success: false, error: 'O nível full não pode ser global; use uma concessão de sessão para uma única iteração.' };
        }
        config.global = level;
        save(config);
        return { success: true, sessionId: 'global', level, mode: MODES[level] };
    }
    if (!sessionId) {
        return { success: false, error: 'Informe sessionId ou use scope="global"' };
    }
    if (!config.sessions) config.sessions = {};
    if (!config.oneShotFull) config.oneShotFull = {};
    if (level === 'full') {
        config.oneShotFull[sessionId] = true;
    } else {
        config.sessions[sessionId] = level;
        delete config.oneShotFull[sessionId];
    }
    save(config);
    return { success: true, sessionId, level, mode: MODES[level] };
}

function resetLevel(sessionId) {
    const config = load();
    if (sessionId && (config.sessions?.[sessionId] || config.oneShotFull?.[sessionId])) {
        delete config.sessions[sessionId];
        delete config.oneShotFull[sessionId];
        save(config);
        return { success: true, sessionId, level: config.global || DEFAULT_APPROXIMATION };
    }
    if (!sessionId) {
        config.global = DEFAULT_APPROXIMATION;
        config.sessions = {};
        config.oneShotFull = {};
        save(config);
        return { success: true, sessionId: 'all', level: DEFAULT_APPROXIMATION };
    }
    return { success: true, sessionId, level: config.global || DEFAULT_APPROXIMATION };
}

function listModes() {
    return Object.entries(MODES).map(([key, val]) => ({
        key,
        ...val
    }));
}

module.exports = { MODES, DEFAULT_APPROXIMATION, getLevel, consumeLevel, setLevel, resetLevel, listModes, load };
