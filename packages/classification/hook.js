const { $ } = require("logos");
const { discoverRuntimeTools } = require("../agent/core/runtime_bridge");
const approximation = require("./approximation");
const experience = require("./experience");
const decisionEngine = require('./decision-engine');
const { classificationCacheKey } = require('./cache-key');
const { decideReactiveRefresh } = require('./reactive-policy');
const { inferCapabilities } = require('./capability-profiles');
const { getRouter } = require('./protocol-hooks');
const { reconcileDecision } = require('./protocol');
const fs = require('node:fs');
const path = require('node:path');

// A classificação apenas seleciona ferramentas. A chamada declara requisitos
// concretos ao resolvedor global; ela nunca escolhe um "propósito" de modelo.

// ─── Builtins SEMPRE disponíveis ───────────────────────────────────────────
// Fonte única de verdade, compartilhada com aurora/core/agent.js (que aplica
// o filtro final). Antes cada lado mantinha sua própria lista e elas já
// haviam divergido — ver always-include-tools.json.
const ALWAYS_INCLUDE_GROUPS = require('./always-include-tools.json');
const ALWAYS_INCLUDE_BUILTINS = Object.values(ALWAYS_INCLUDE_GROUPS).flat();



// ─── Cache de classificação por sessão ─────────────────────────────────────
const CLASSIFICATION_CACHE = new Map();
const CACHE_TTL = 60_000; // 1 minuto (mais curto para feedback ágil)

// ─── Histórico de feedback por sessão ──────────────────────────────────────
const FEEDBACK_HISTORY = new Map();
const MAX_FEEDBACK_HISTORY = 50;
const SESSION_DECISIONS = new Map();
const REACTIVE_RUNS = new Map();
const AGENT_CONFIG = path.join(__dirname, '..', 'agent', 'agent.config.json');

function readConfig() {
    try { return JSON.parse(fs.readFileSync(AGENT_CONFIG, 'utf8')); } catch { return {}; }
}

function catalogVersion(tools) {
    return JSON.stringify((tools || []).map(t => [t.name, t.description, t.parameters]));
}

// ─── Detectores de intenção ────────────────────────────────────────────────
// Palavras-chave que indicam que o usuário quer EXPLORAR / VER todas as tools
const EXPLORE_INTENT_PATTERNS = [
    /quais (são as |sao as |)ferramentas/i,
    /que ferramentas/i,
    /explique 100/i,
    /mostre tudo/i,
    /mostre (todas|tudo)/i,
    /quero ver (todas|tudo)/i,
    /o que voce (sabe|pode) fazer/i,
    /quais (sao|são) (as |)tools/i,
    /lista (completa|todas|tudo)/i,
    /catalogo (completo|)/i,
    /100%/i,
    /full (context|catalog)/i,
    /explore tools/i,
    /complete catalog/i,
    /all tools/i,
];

function detectExploreIntent(message) {
    return EXPLORE_INTENT_PATTERNS.some(pattern => pattern.test(message));
}

// ─── Ranking de relevância ──────────────────────────────────────────────────
// discoverRuntimeTools() devolve as tools na ordem de leitura dos diretórios
// de packages (alfabética), sem relação com a mensagem do usuário. Se o
// modo truncar por posição (ex.: compact = 8 de ~118 tools hoje), packages
// que ordenam depois no alfabeto nunca aparecem pro classificador. Rankeamos
// por overlap de palavras com a mensagem antes de truncar pra evitar isso.
const STOPWORDS = new Set([
    'a', 'o', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'em', 'um', 'uma', 'uns', 'umas',
    'para', 'por', 'com', 'sem', 'que', 'se', 'ao', 'aos', 'e', 'ou', 'no', 'na', 'nos', 'nas',
    'the', 'an', 'to', 'in', 'on', 'is', 'are', 'of', 'for', 'and', 'or', 'you', 'your',
]);

function normalize(str) {
    return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokenize(str) {
    return normalize(str).split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

function scoreTool(tool, messageTokens) {
    const blob = tokenize(`${tool.name} ${tool.description || ''}`);
    if (!blob.length) return 0;
    let score = 0;
    for (const tok of messageTokens) {
        if (blob.includes(tok)) score += 1;
        else if (blob.some(b => b.includes(tok) || tok.includes(b))) score += 0.5;
    }
    return score;
}

function rankByRelevance(tools, message) {
    const messageTokens = tokenize(message);
    if (!messageTokens.length) return tools; // sem sinal — mantém ordem original
    return [...tools].sort((a, b) => scoreTool(b, messageTokens) - scoreTool(a, messageTokens));
}

// ─── Build do prompt com few-shot ──────────────────────────────────────────
function buildRouterPrompt(message, tools, level, matrixRanked = false) {
    const mode = approximation.MODES[level] || approximation.MODES.compact;

    // Rankeia por relevância à mensagem ANTES de truncar (ver rankByRelevance acima).
    const ranked = matrixRanked ? tools : rankByRelevance(tools, message);

    // Limita o número de tools no prompt
    const maxTools = mode.maxTools;
    const toolPool = maxTools >= ranked.length ? ranked : ranked.slice(0, maxTools);

    let toolsList;
    if (mode.descriptionDepth === 'summary') {
        toolsList = toolPool.map(t => `- ${t.name}: ${t.description ? t.description.split('.')[0] + '.' : ''}`).join("\n");
    } else {
        toolsList = toolPool.map(t => {
            const desc = t.description || '';
            if (mode.descriptionDepth === 'detailed') {
                const params = Object.keys(t.parameters?.properties || {}).slice(0, 2).join(', ');
                return params ? `- ${t.name}: ${desc} (params: ${params})` : `- ${t.name}: ${desc}`;
            }
            // full: descrição completa + todos os parâmetros
            const params = Object.entries(t.parameters?.properties || {})
                .map(([k, v]) => `${k}${v?.description ? ': ' + v.description : ''}`)
                .join(', ');
            return params ? `- ${t.name}: ${desc} (${params})` : `- ${t.name}: ${desc}`;
        }).join("\n");
    }

    const remaining = tools.length - maxTools;
    const overflowNote = remaining > 0
        ? `\n\n⚠️ Há ${remaining} ferramentas adicionais não listadas (nível: ${mode.label}). Use setApproximationLevel({ level: "full" }) para vê-las.`
        : '';

    return `Você é um seletor de ferramentas (tool router). Nível de detalhe atual: ${mode.label}.

${mode.description}

Sua tarefa é escolher APENAS as ferramentas necessárias para resolver a solicitação do usuário.

Exemplos:
- "Qual a temperatura em Araruama?" → {"tools": ["get_system_status", "run_runtime_tool"]}
- "Crie uma tarefa para comprar leite" → {"tools": ["createTask"]}
- "Navegue para google.com" → {"tools": ["browser_list_tabs", "browser_navigate", "browser_get_page_state", "browser_wait"]}
- "Edite o arquivo src/main.js" → {"tools": ["read_file", "patch_file"]}
- "Liste os packages ativos" → {"tools": ["listPackages"]}
- "Oi, tudo bem?" → {"tools": []}
- "Envie uma notificação de alerta" → {"tools": ["sendNtfyNotification"]}

Regras:
- Retorne APENAS JSON válido, sem texto fora do JSON
- Se nenhuma tool for necessária, retorne {"tools": []}
- Não invente nomes de tools — use exatamente os nomes listados
- Inclua ferramentas auxiliares necessárias para completar a tarefa

Formato obrigatório:
{"tools": ["toolA", "toolB"]}

---
Solicitação do usuário:
"""
${message}
"""

---
Ferramentas Disponíveis:
${toolsList}${overflowNote}

Agora responda:`.trim();
}

// ─── Build do prompt de feedback (reclassificação com contexto de tentativas anteriores) ──
function buildFeedbackPrompt(message, tools, feedbackEntries, level) {
    const toolsList = tools
        .map(t => `- ${t.name}: ${t.description}`)
        .join("\n");

    const feedbackBlock = feedbackEntries.length > 0
        ? `\n\n---\nHistórico de ferramentas usadas nesta sessão:\n${
            feedbackEntries.map((f, i) =>
                `  ${i+1}. "${f.toolName}" — ${f.used ? `usada (${f.succeeded ? '✅ sucesso' : '❌ erro: ' + (f.error || 'desconhecido')})` : 'não usada'} [iteração ${f.iteration}]`
            ).join('\n')
          }\n---`
        : '';

    return `Você é um seletor de ferramentas (tool router). Nível de detalhe atual: ${level}.

Reclassifique as ferramentas necessárias considerando o que já foi tentado nesta sessão.${feedbackBlock}

Solicitação original:
"""
${message}
"""

---
Ferramentas Disponíveis:
${toolsList}

Regras:
- Se uma ferramenta já falhou, considere alternativas
- Se uma ferramenta já teve sucesso, não precisa repeti-la a menos que seja necessário novamente
- Retorne APENAS JSON: {"tools": ["toolA", "toolB"]}
- Não invente nomes de tools

Agora responda:`.trim();
}

// ─── Parser JSON seguro ────────────────────────────────────────────────────
function safeParseJSON(text) {
    try { return JSON.parse(text); }
    catch { return { tools: [] }; }
}

// ─── Registra feedback de execução de tool ─────────────────────────────────
function recordToolFeedback(sessionId, toolName, used, succeeded, error, iteration) {
    if (!FEEDBACK_HISTORY.has(sessionId)) {
        FEEDBACK_HISTORY.set(sessionId, []);
    }
    const history = FEEDBACK_HISTORY.get(sessionId);
    history.push({ toolName, used, succeeded, error, timestamp: Date.now(), iteration });

    // Mantém tamanho máximo
    while (history.length > MAX_FEEDBACK_HISTORY) history.shift();

    // Gatilho: se tool falhou 2+ vezes, escala approximation para detailed
    const failCount = history.filter(f => f.toolName === toolName && f.used && !f.succeeded).length;
    if (failCount >= 2) {
        const currentLevel = approximation.getLevel(sessionId);
        if (currentLevel === 'compact') {
            approximation.setLevel(sessionId, 'detailed');
            $('classification:auto-escalated', {
                sessionId,
                from: 'compact',
                to: 'detailed',
                reason: `Tool "${toolName}" falhou ${failCount}x — escalando para more tools`
            });
        }
    }

    return history;
}

// ─── Gatilho de reclassificação baseado em feedback ─────────────────────────────
function shouldReclassify(sessionId, feedbackEntry) {
    if (!feedbackEntry) return false;

    // Reclassifica se encontrou erro em uma ferramenta
    if (feedbackEntry.used && !feedbackEntry.succeeded) {
        return true;
    }

    // Reclassifica se após 3 iterações sem progresso (ferramentas usadas sem sucesso)
    const history = FEEDBACK_HISTORY.get(sessionId) || [];
    const recentToolUses = history.slice(-3);
    const allFailed = recentToolUses.length >= 3 && recentToolUses.every(f => f.used && !f.succeeded);
    if (allFailed) return true;

    return false;
}

// ─── Hook: agent:start ─────────────────────────────────────────────────────
async function onAgentStart(args) {
    /**
     * @register_hook agent:start
     */
    const { message, sessionId } = args;

    if (message && detectExploreIntent(message)) {
        // Se usuário quer explorar tools, escala para full automaticamente
        const currentLevel = approximation.getLevel(sessionId);
        if (currentLevel !== 'full') {
            approximation.setLevel(sessionId, 'full');
            $('classification:auto-full', {
                sessionId,
                from: currentLevel,
                reason: 'Usuário solicitou exploração de ferramentas'
            });
        }
    }

    // ─── Self-Modeling: captura intenção e injeta experiências ──────────
    if (message && sessionId) {
        experience.captureIntent(sessionId, message);
        try {
            const expBlock = await experience.buildExperienceBlock(sessionId, null, 3);
            if (expBlock) {
                args.experienceBlock = expBlock;
            }
        } catch (e) {
            // Experiência é opcional — não bloqueia o ciclo
        }
    }

    // `full` é uma concessão de uma única iteração. O consumo acontece aqui,
    // depois de uma possível concessão por intenção, e é persistido antes do LLM.
    const level = approximation.consumeLevel(sessionId);
    // @reach 'manual' fica fora da classificação: não é ofertada ao classificador
    // nem entra na lista final (só invocável por nome). Tools sem reach ⇒ 'auto'.
    const tools = (await discoverRuntimeTools()).filter(t => (t.reach || 'auto') !== 'manual');
    const requiredCapability = inferCapabilities(message, tools.map(tool => tool.name));
    // Extensão opcional: Matrix não muda autorização nem os contratos vivos.
    let matrix = null;
    try {
        const prepared = await $('matrix:prepare', { sessionId, message, tools });
        matrix = prepared?.matrix;
        if (matrix?.guidance) args.experienceBlock = [args.experienceBlock, matrix.guidance].filter(Boolean).join('\n\n');
    } catch { /* pacote ausente ou falho: mantém classificação existente */ }
    const rankedNames = Array.isArray(matrix?.tools) ? matrix.tools.map(t => t.name) : [];
    const rankedTools = rankedNames.length
        ? [...tools].sort((a, b) => (rankedNames.indexOf(a.name) < 0 ? Infinity : rankedNames.indexOf(a.name)) - (rankedNames.indexOf(b.name) < 0 ? Infinity : rankedNames.indexOf(b.name)))
        : tools;
    const toolsHash = JSON.stringify(tools.map(t => ({ name: t.name, package: t.package, parameters: t.parameters, description: t.description, reach: t.reach }))) + '|' + level + '|' + rankedNames.join(',');

    const cacheKey = classificationCacheKey({ sessionId, message, toolsHash });
    const cached = CLASSIFICATION_CACHE.get(sessionId);
    if (cached && cached.cacheKey === cacheKey && Date.now() - cached.timestamp < CACHE_TTL) {
        args.selectedTools = tools.filter(t => cached.filteredTools.some(c => c.name === t.name));
        return args;
    }

    // Jev é opcional. Sem pool configurado, o histórico local pode apenas
    // reordenar candidatas, mantendo o mesmo LLM e filtro final já existentes.
    const decision = await decisionEngine.decide({ intent: message, candidates: rankedTools.slice(0, 15) });
    let decisionRankedTools = rankedTools;
    if (decision.mode === 'assist' && decision.recommendation?.choice) {
        const preferred = rankedTools.find(tool => tool.name === decision.recommendation.choice);
        if (preferred) decisionRankedTools = [preferred, ...rankedTools.filter(tool => tool !== preferred)];
    }
    const decisionRecord = decisionEngine.recordDecision({
        sessionId,
        intent: message,
        candidates: rankedTools.slice(0, 15),
        recommendation: decision.recommendation,
        mode: decision.mode,
    });
    SESSION_DECISIONS.set(sessionId, decisionRecord.id);

    // Verifica se há feedback history recente que justifique reclassificação
    const history = FEEDBACK_HISTORY.get(sessionId) || [];
    const lastFeedback = history.length > 0 ? history[history.length - 1] : null;

    let prompt;
    if (lastFeedback && shouldReclassify(sessionId, lastFeedback)) {
        prompt = buildFeedbackPrompt(message, tools, history.slice(-10), level);
    } else {
        prompt = buildRouterPrompt(message, decisionRankedTools, level, rankedNames.length > 0);
    }

    const llmOptions = { prompt, requirements: approximation.MODES[level]?.modelRequirements };

    const llmResponse = await $('llm:call', llmOptions);
    const parsed = safeParseJSON(llmResponse?.text || '{}');

    const selectedNames = Array.isArray(parsed.tools) ? parsed.tools : [];

    // SEMPRE incluir: builtins essenciais (whitelist JSON) + tools @reach always
    const alwaysReachNames = tools.filter(t => t.reach === 'always').map(t => t.name);
    const allNames = [...new Set([...selectedNames, ...requiredCapability.tools, ...ALWAYS_INCLUDE_BUILTINS, ...alwaysReachNames])];
    const filteredTools = tools.filter(t => allNames.includes(t.name));
    decisionEngine.setFinalTools(decisionRecord.id, selectedNames);

    // Armazena no cache
    CLASSIFICATION_CACHE.set(sessionId, {
        timestamp: Date.now(),
        cacheKey,
        toolsHash,
        filteredTools,
        allTools: tools,
        message,
        level,
    });

    // Emite evento de classificação
    $('classification:done', {
        sessionId,
        level,
        filteredToolNames: filteredTools.map(t => t.name),
        totalTools: tools.length,
        selectedCount: selectedNames.length,
        isFeedback: !!lastFeedback && shouldReclassify(sessionId, lastFeedback),
        decision: decision.recommendation ? { provider: decision.recommendation.rawProvider, confidence: decision.recommendation.confidence, mode: decision.mode } : null,
        capabilities: requiredCapability.capabilities,
        requiredToolNames: requiredCapability.tools,
    });

    args.selectedTools = filteredTools;
    return args;
}

// ─── Hook: agent:tool-end ───────────────────────────────────────────────────
// Escuta resultado de cada tool para alimentar o feedback loop
async function onToolEnd(args) {
    /**
     * @register_hook agent:tool-end
     */
    const { sessionId, tool, result, is_error, iteration } = args;

    if (sessionId && tool) {
        const used = true;
        const succeeded = !is_error;
        const error = is_error ? (typeof result === 'string' ? result : 'Error') : null;

        recordToolFeedback(sessionId, tool, used, succeeded, error, iteration);
        try {
            const observed = await $('matrix:observe', { sessionId, tool, is_error, result: { success: result?.success, is_error: result?.is_error } });
            if (observed?.matrix?.escalationRecommended) {
                CLASSIFICATION_CACHE.delete(sessionId);
                if (approximation.getLevel(sessionId) === 'compact') approximation.setLevel(sessionId, 'detailed');
            }
        } catch { /* observação opcional não interrompe ferramentas */ }

        // ─── Self-Modeling: registra experiência na memória ────────────────
        experience.recordExperience(sessionId, tool, result, is_error);
        decisionEngine.observeDecision(SESSION_DECISIONS.get(sessionId), tool, succeeded);

        // Devemos filtrar quais e como:
         $('bag:add', {
            content: experience.safeJson({
                tool,
                result,
                is_error
            }),
            type: 'items',
            sessionId,
            summarized: true
        });

        // Se houve erro, invalida cache de classificação para forçar reclassificação
        if (is_error) {
            CLASSIFICATION_CACHE.delete(sessionId);
        }
    }

    return args;
}

// Reclassificação limitada dentro do mesmo loop ReAct. O retorno contém apenas
// nomes; a barreira do Aurora reconcilia esses nomes com os schemas permitidos.
async function onToolsSelect(args) {
    /**
     * @register_hook agent:tools:select
     */
    const { sessionId, runId, iteration = 0, message = '', availableTools = [], recentOutcomes = [], signal = {} } = args;
    if (!sessionId || !runId) return args;
    const key = `${sessionId}:${runId}`;
    const version = args.catalogVersion || catalogVersion(availableTools);
    const previous = REACTIVE_RUNS.get(key);
    const config = readConfig();
    const policyDecision = decideReactiveRefresh({ state: previous, signal, config, iteration, catalogVersion: version });
    const eligible = new Set(availableTools.map(tool => tool.name));
    const requiredCapability = inferCapabilities(message, eligible);
    const route = reconcileDecision(await (await getRouter()).classify(message), availableTools, {
        runId, iteration, catalogVersion: version,
    });
    const routedToolNames = route?.status === 'eligible' ? [route.tool.name] : [];
    const reusable = [...new Set([
        ...(previous?.selectedToolNames || args.tools?.map(tool => tool.name) || []),
        ...requiredCapability.tools,
        ...routedToolNames,
    ])].filter(name => eligible.has(name));

    if (route) {
        $('classification:route:decision', {
            sessionId, runId, iteration, catalogVersion: version,
            package: route.package, id: route.id, target: route.target,
            score: route.score, status: route.status, encoder: route.encoder, degraded: route.degraded, fallbackReason: route.fallbackReason,
        });
    }

    if (policyDecision.action !== 'refresh') {
        REACTIVE_RUNS.set(key, previous || { selectedToolNames: reusable, catalogVersion: version, calls: 0, lastCallIteration: -Infinity });
        return { ...args, selectedToolNames: reusable };
    }

    const failed = recentOutcomes.filter(outcome => outcome.status === 'error').map(outcome => outcome.tool);
    const ranked = rankByRelevance(availableTools, `${message} ${failed.join(' ')}`);
    const decision = await decisionEngine.decide({
        intent: message,
        candidates: ranked.slice(0, 15),
        config,
        timeoutMs: policyDecision.policy.timeoutMs,
        signal: args.abortSignal,
    });
    let candidates = ranked;
    if (decision.mode === 'assist' && decision.recommendation?.choice) {
        const preferred = ranked.find(tool => tool.name === decision.recommendation.choice);
        if (preferred) candidates = [preferred, ...ranked.filter(tool => tool !== preferred)];
    }

    let selectedToolNames = reusable;
    let fallbackReason = decision.error || null;
    try {
        const level = approximation.getLevel(sessionId);
        const response = await $('llm:call', {
            prompt: buildFeedbackPrompt(message, candidates, recentOutcomes.map(outcome => ({
                toolName: outcome.tool,
                used: true,
                succeeded: outcome.status === 'success',
                error: outcome.errorCategory || null,
                iteration: outcome.iteration,
            })), level),
            requirements: approximation.MODES[level]?.modelRequirements,
        });
        const parsed = safeParseJSON(response?.text || '{}');
        if (Array.isArray(parsed.tools)) selectedToolNames = [...new Set([...reusable, ...parsed.tools.filter(name => eligible.has(name))])];
    } catch (error) {
        fallbackReason = fallbackReason || error.message;
    }

    // O assist reativo só amplia o conjunto elegível. O modo global pode ficar
    // em shadow para a seleção inicial sem neutralizar a recuperação no loop.
    if (policyDecision.policy.mode !== 'assist') selectedToolNames = reusable;
    const next = {
        selectedToolNames,
        catalogVersion: version,
        calls: (previous?.calls || 0) + 1,
        lastCallIteration: iteration,
    };
    REACTIVE_RUNS.set(key, next);
    $('classification:reactive:decision', {
        sessionId, runId, iteration, reason: policyDecision.reason, mode: policyDecision.policy.mode,
        provider: decision.recommendation?.rawProvider || null,
        before: reusable, after: selectedToolNames, calls: next.calls, fallbackReason,
        capabilities: requiredCapability.capabilities,
    });
    return { ...args, selectedToolNames };
}

async function onAgentFinally(args) {
    /**
     * @register_hook agent:finally
     */
    if (args?.sessionId) {
        for (const key of REACTIVE_RUNS.keys()) if (key.startsWith(`${args.sessionId}:`)) REACTIVE_RUNS.delete(key);
    }
    return args;
}

// ─── Hook: classified:get ──────────────────────────────────────────────────
async function onClassifiedGet(payload) {
    /**
     * @register_hook classified:get
     */
    const cached = CLASSIFICATION_CACHE.get(payload.sessionId);
    if (!cached || !cached.filteredTools.length) {
        return { filteredToolNames: null, approximation: null };
    }
    return {
        filteredToolNames: cached.filteredTools.map(t => t.name),
        approximation: cached.level,
    };
}

// ─── Hook: user:request:full-context ────────────────────────────────────────
// Disparado via dispatchEvent('user:request:full-context', { sessionId })
async function onFullContextRequest(payload) {
    /**
     * @register_hook user:request:full-context
     */
    const { sessionId } = payload;
    approximation.setLevel(sessionId, 'full');
    CLASSIFICATION_CACHE.delete(sessionId); // força reclassificação

    $('classification:level-changed', { sessionId, level: 'full' });

    return { success: true, level: 'full', message: 'Nível alterado para Completo. Reclassificando tools na próxima iteração...' };
}

module.exports = { onAgentStart, onToolEnd, onToolsSelect, onAgentFinally, onClassifiedGet, onFullContextRequest, recordToolFeedback };
