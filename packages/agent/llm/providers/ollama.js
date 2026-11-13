





























import { readWithIdleTimeout, createThinkTagFilter } from '../stream_utils.js'
import { buildCliToolsPreamble, extractCliToolCalls } from '../text_tool_protocol.js'

export const OLLAMA_DEFAULT_BASE = 'http://localhost:11434'




const DISCOVERY_TTL_MS = 30_000

const DISCOVERY_TIMEOUT_MS = 3_000

export function isOllamaProvider(providerName) {
  return providerName === 'ollama'
}

/**
 * Raiz da API a partir de um slot/pool. O slot HTTP guarda a URL do endpoint
 * OpenAI-compatible (…/v1/chat/completions), que NÃO é o que a API nativa usa —
 * então normalizamos de volta pra raiz.
 */
export function ollamaBase(source) {
  const raw = source?.baseUrl ?? source?.base_url ?? source?.url ?? OLLAMA_DEFAULT_BASE
  return String(raw)
    .replace(/\/v1\/chat\/completions\/?$/, '')
    .replace(/\/v1\/?$/, '')
    .replace(/\/+$/, '')
    || OLLAMA_DEFAULT_BASE
}



/** base → { at, reachable, models, error, inflight } */
const _cache = new Map()

function emptySnapshot(extra = {}) {
  return { at: 0, reachable: false, models: [], error: null, cold: true, ...extra }
}

async function fetchJson(url, { timeoutMs = DISCOVERY_TIMEOUT_MS, body = null } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Nome legível a partir do id do modelo ("soyamigomike/qwen3.5-abliterated:latest"
 * → "Qwen3.5 Abliterated"). O namespace do publicador some (ruído na lista) e a
 * tag só aparece quando diz alguma coisa (":latest" não diz).
 */
export function prettyOllamaName(id, parameterSize = null) {
  const [path, tag] = String(id).split(':')
  const base = path.split('/').pop() ?? path
  const words = base
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  const suffix = [
    tag && tag !== 'latest' && !/^[\d.]+b$/i.test(tag) ? tag : null,
    parameterSize || null,
  ].filter(Boolean).join(' · ')
  return suffix ? `${words} · ${suffix}` : words
}

/** "4.5B" / "1.5b" → 4.5 / 1.5 (null quando o daemon não informa). */
function parseParameterSize(value) {
  const match = /([\d.]+)\s*([BM])/i.exec(String(value ?? ''))
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n)) return null
  return match[2].toUpperCase() === 'M' ? n / 1000 : n
}

/**
 * Prior de qualidade por tamanho do modelo, usado como EVIDÊNCIA no catálogo.
 *
 * Sem isso, todo acesso sem evidência entra com 0.5 e um qwen2.5:1.5b local
 * empata com Opus/GPT-5 na resolução automática — e passa a ganhar turnos que
 * ninguém pediu pra ele. O prior é deliberadamente conservador: mesmo o teto
 * (0.45, modelos grandes) fica abaixo do neutro 0.5, então "auto" nunca escolhe
 * local por conta própria. Escolher explicitamente na InputBar continua
 * funcionando — override não passa por score (ver resolveModel). Quem quiser
 * priorizar o local por ser grátis pode declarar `economics.costScore` no pool.
 */
function qualityPriorFor(billions) {
  if (billions == null) return 0.35
  if (billions < 2) return 0.15
  if (billions < 5) return 0.25
  if (billions < 10) return 0.32
  if (billions < 35) return 0.40
  return 0.45
}

const formatContext = (tokens) => tokens >= 1_000_000
  ? `${+(tokens / 1_000_000).toFixed(1)}M ctx`
  : `${Math.round(tokens / 1024)}k ctx`

function describeModel({ billions, contextWindow, caps }) {
  const parts = []
  if (billions != null) parts.push(`${billions}B`)
  if (contextWindow) parts.push(formatContext(contextWindow))
  parts.push(caps.tools ? 'tools nativas' : 'tools por texto')
  if (caps.vision) parts.push('visão')
  if (caps.thinking) parts.push('raciocínio')
  return parts.join(' · ')
}

/**
 * Entrada de /api/tags → entrada de `pool.models[]` que model_catalog.js
 * entende (id/name/purpose/capabilities/evidence).
 */
export function toCatalogModel(entry) {
  const id = entry?.model ?? entry?.name
  if (!id) return null
  const list = Array.isArray(entry.capabilities) ? entry.capabilities : null
  const details = entry.details ?? {}
  const caps = {
    
    
    
    tools: list ? list.includes('tools') : false,
    vision: list ? list.includes('vision') : false,
    thinking: list ? list.includes('thinking') : false,
    embedding: list ? list.includes('embedding') : false,
    completion: list ? list.includes('completion') : true,
  }
  const billions = parseParameterSize(details.parameter_size)
  const contextWindow = Number(details.context_length) || null
  const quality = qualityPriorFor(billions)

  
  
  
  
  const evidence = ['modalities.text.input', 'tools.supported', 'modalities.vision.input', 'reasoning.supported']
    .map(capability => ({ capability, score: quality, confidence: 0.4, source: 'ollama:parameter-size' }))

  return {
    id,
    name: prettyOllamaName(id, details.parameter_size),
    purpose: {
      name: 'local',
      description: describeModel({ billions, contextWindow, caps }),
    },
    capabilities: {
      modalities: {
        text: { input: true, output: true },
        vision: { input: caps.vision },
      },
      
      
      
      
      
      tools: { supported: true, native: caps.tools, emulated: false, parallel: false },
      reasoning: { supported: caps.thinking, levels: caps.thinking ? ['native'] : [] },
      contextWindow,
      streaming: true,
    },
    evidence,
    
    _ollama: { ...caps, billions, contextWindow, sizeBytes: Number(entry.size) || null },
  }
}

async function loadModels(base) {
  const tags = await fetchJson(`${base}/api/tags`)
  const entries = Array.isArray(tags?.models) ? tags.models : []
  const pairs = entries.map(entry => ({ entry, model: toCatalogModel(entry) })).filter(p => p.model)
  const models = pairs.map(p => p.model)

  
  
  
  const missing = pairs.filter(p => !Array.isArray(p.entry.capabilities)).map(p => p.model)
  if (missing.length && missing.length <= 24) {
    await Promise.allSettled(missing.map(async (model) => {
      const shown = await fetchJson(`${base}/api/show`, { body: { model: model.id } })
      const list = Array.isArray(shown?.capabilities) ? shown.capabilities : null
      if (!list) return
      const enriched = toCatalogModel({
        model: model.id,
        capabilities: list,
        details: { ...shown?.details, context_length: shown?.model_info?.['context_length'] ?? shown?.details?.context_length },
      })
      if (enriched) Object.assign(model, enriched)
    }))
  }

  
  
  
  return models
}

/**
 * Só o que faz sentido oferecer como modelo de conversa. Um modelo de embedding
 * na InputBar é turno quebrado garantido.
 */
const chatModels = (models) => models.filter(m => !(m._ollama.embedding && !m._ollama.completion))

/**
 * Recarrega a lista de modelos baixados. Concorrência coalescida: N chamadas
 * simultâneas compartilham o mesmo fetch. Nunca lança — daemon fora do ar é um
 * estado esperado (`reachable: false`), não um erro de chamada.
 */
export function refreshOllamaModels(base = OLLAMA_DEFAULT_BASE, { force = false } = {}) {
  const key = ollamaBase({ baseUrl: base })
  const cached = _cache.get(key)
  if (cached?.inflight) return cached.inflight
  if (!force && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return Promise.resolve(cached)

  const inflight = loadModels(key)
    .then(models => ({ at: Date.now(), reachable: true, models, error: null, cold: false }))
    .catch(error => ({ at: Date.now(), reachable: false, models: [], error: error.message, cold: false }))
    .then(snapshot => { _cache.set(key, snapshot); return snapshot })

  _cache.set(key, { ...(cached ?? emptySnapshot()), inflight })
  return inflight
}

/**
 * Leitura SÍNCRONA do cache (o catálogo e a rota de sessão são síncronos).
 * Dispara o refresh em background quando o cache está frio ou vencido.
 */
export function getOllamaSnapshot(base = OLLAMA_DEFAULT_BASE) {
  const key = ollamaBase({ baseUrl: base })
  const cached = _cache.get(key)
  if (!cached || (!cached.inflight && Date.now() - cached.at >= DISCOVERY_TTL_MS)) {
    refreshOllamaModels(key).catch(() => { })
  }
  return cached?.models ? cached : emptySnapshot()
}

/** Só pra teste: injeta/limpa o cache sem tocar no daemon. */
export function __setOllamaSnapshot(base, snapshot) {
  const key = ollamaBase({ baseUrl: base })
  if (!snapshot) _cache.delete(key)
  else _cache.set(key, { at: Date.now(), reachable: true, error: null, cold: false, models: [], ...snapshot })
}

/** O modelo (chat ou embedding) está de fato baixado neste daemon? */
export function ollamaHasModel(base, model) {
  if (!model) return false
  const { models } = getOllamaSnapshot(base)
  const want = String(model)
  return models.some(m => m.id === want || m.id === `${want}:latest`)
}

function capabilitiesFor(base, model) {
  const { models } = getOllamaSnapshot(base)
  const want = String(model ?? '')
  const found = models.find(m => m.id === want || m.id === `${want}:latest`)
  return found?._ollama ?? null
}



const isOllamaPool = (pool) => isOllamaProvider(pool?.provider)

/**
 * Config com os pools ollama preenchidos pelo que está REALMENTE baixado.
 * Devolve o mesmo objeto quando não há pool ollama habilitado (o config é
 * cacheado em utils/config.js — nunca mutar in-place).
 *
 * - `models`: substituído pela descoberta (o array escrito à mão no config vira
 *   só fallback pra quando o daemon está fora do ar);
 * - `model`: o default do pool só continua sendo o do config se ele estiver
 *   baixado; senão cai no primeiro modelo com tools nativas;
 * - `available: false` quando o daemon não responde — o catálogo mantém o
 *   acesso listado, mas o resolvedor rejeita e a InputBar filtra.
 */
export function applyOllamaDiscovery(config) {
  const pools = config?.llm?.pools
  if (!Array.isArray(pools) || !pools.some(p => isOllamaPool(p) && p.enabled)) return config

  return {
    ...config,
    llm: {
      ...config.llm,
      pools: pools.map(pool => {
        if (!isOllamaPool(pool) || !pool.enabled) return pool
        const discovered = getOllamaSnapshot(pool.base_url ?? OLLAMA_DEFAULT_BASE)
        const snapshot = { ...discovered, models: chatModels(discovered.models) }
        
        
        
        if (!snapshot.models.length) return { ...pool, available: false }
        const configured = snapshot.models.find(m => m.id === pool.model || m.id === `${pool.model}:latest`)
        const preferred = configured
          ?? snapshot.models.find(m => m._ollama.tools)
          ?? snapshot.models[0]
        return {
          ...pool,
          available: true,
          model: preferred.id,
          
          
          capabilities_model: preferred.id,
          models: snapshot.models,
        }
      }),
    },
  }
}

/** Versão await-ável de applyOllamaDiscovery — usada pelas rotas da InputBar. */
export async function refreshOllamaDiscovery(config) {
  const pools = (config?.llm?.pools ?? []).filter(p => isOllamaPool(p) && p.enabled)
  await Promise.allSettled(pools.map(p => refreshOllamaModels(p.base_url ?? OLLAMA_DEFAULT_BASE)))
  return applyOllamaDiscovery(config)
}



function imageDataFromUrl(url) {
  const match = /^data:[^;]+;base64,(.+)$/.exec(String(url ?? ''))
  return match ? match[1] : null
}

/**
 * Mensagem do histórico interno (OpenAI-chat-shape) → mensagem nativa do
 * ollama. Conteúdo multimodal vira `{content, images:[base64]}` (formato do
 * ollama pros modelos com capability "vision").
 */
function convertUserMessage(message) {
  const content = message.content
  if (typeof content === 'string') return { role: 'user', content }
  if (!Array.isArray(content)) return { role: 'user', content: JSON.stringify(content) }

  const texts = []
  const images = []
  for (const block of content) {
    if (block?.type === 'text') texts.push(block.text ?? '')
    else if (block?.type === 'image_url') {
      const data = imageDataFromUrl(block.image_url?.url)
      if (data) images.push(data)
      else texts.push(`[imagem: ${block.image_url?.url ?? '?'}]`)
    } else texts.push(JSON.stringify(block))
  }
  return { role: 'user', content: texts.join('\n'), ...(images.length ? { images } : {}) }
}

function toolCallsAsText(toolCalls) {
  return (toolCalls ?? []).map(tc => {
    let input = {}
    try { input = JSON.parse(tc.function?.arguments ?? '{}') } catch { /* mantém {} */ }
    return '```tool_call\n' + JSON.stringify({ name: tc.function?.name, input }) + '\n```'
  }).join('\n')
}

/**
 * Histórico interno → `messages` nativas.
 *
 * `emulated` muda a serialização dos turnos de ferramenta: sem tools nativas o
 * template do modelo não conhece `role:"tool"` nem `tool_calls`, então o que já
 * aconteceu é reescrito no MESMO protocolo de texto que o preâmbulo ensina
 * (blocos ```tool_call``` + "Resultado da ferramenta"), pro modelo reconhecer o
 * próprio padrão no histórico.
 */
export function convertMessages(messages, { emulated = false } = {}) {
  const out = []
  const nameByCallId = new Map()

  for (const m of messages ?? []) {
    if (m.role === 'assistant') {
      for (const tc of m.tool_calls ?? []) nameByCallId.set(tc.id, tc.function?.name)
      const text = typeof m.content === 'string' ? m.content : (m.content ? JSON.stringify(m.content) : '')
      if (emulated) {
        const content = [text, toolCallsAsText(m.tool_calls)].filter(Boolean).join('\n')
        if (content) out.push({ role: 'assistant', content })
        continue
      }
      out.push({
        role: 'assistant',
        content: text,
        ...(m.tool_calls?.length
          ? {
              tool_calls: m.tool_calls.map(tc => {
                let args = {}
                try { args = JSON.parse(tc.function?.arguments ?? '{}') } catch { /* mantém {} */ }
                return { function: { name: tc.function?.name, arguments: args } }
              }),
            }
          : {}),
      })
      continue
    }

    if (m.role === 'tool') {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      const name = nameByCallId.get(m.tool_call_id) ?? m.name ?? 'tool'
      out.push(emulated
        ? { role: 'user', content: `Resultado da ferramenta ${name}:\n${content}` }
        : { role: 'tool', tool_name: name, content })
      continue
    }

    out.push(convertUserMessage(m))
  }

  return out
}

function toOllamaTools(tools) {
  return (tools ?? []).map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema ?? { type: 'object', properties: {} },
    },
  }))
}

export function buildOllamaBody({ model, system, messages, tools = [], emulated = false, think = false, options = null }) {
  const preamble = emulated ? buildCliToolsPreamble(tools) : ''
  const head = [system, preamble].filter(Boolean).join('\n\n')
  return {
    model,
    messages: [
      ...(head ? [{ role: 'system', content: head }] : []),
      ...convertMessages(messages, { emulated }),
    ],
    stream: true,
    ...(think ? { think: true } : {}),
    ...(!emulated && tools.length ? { tools: toOllamaTools(tools) } : {}),
    ...(options && Object.keys(options).length ? { options } : {}),
  }
}

/**
 * Modelos locais pequenos rodam no mesmo host do Runtime. Reenviar o prompt
 * completo da Agent (memória, catálogo e regras) faz o tempo de pré-preparo
 * ultrapassar o watchdog antes do primeiro token. Este projetor é opt-in por
 * pool (`options.max_input_tokens`): mantém o início das regras, o fim do
 * contexto operacional e as mensagens mais recentes, sem alterar o histórico
 * que os outros providers recebem.
 */
export function compactOllamaInput({ system = '', messages = [], maxInputTokens = null } = {}) {
  const limit = Number(maxInputTokens)
  if (!Number.isFinite(limit) || limit <= 0) return { system, messages }

  const maxChars = Math.floor(limit * CHARS_PER_TOKEN)
  const clip = (text, budget) => {
    const value = String(text ?? '')
    if (value.length <= budget) return value
    const marker = '\n\n[contexto local resumido]\n\n'
    const contentBudget = Math.max(0, budget - marker.length)
    const head = Math.ceil(contentBudget * 0.62)
    const tail = Math.max(0, contentBudget - head)
    return `${value.slice(0, head)}${marker}${tail ? value.slice(-tail) : ''}`
  }

  
  
  
  const systemBudget = Math.min(Math.floor(maxChars * 0.55), maxChars)
  const messageBudget = Math.max(0, maxChars - systemBudget)
  const selected = []
  let used = 0
  for (const message of [...messages].reverse()) {
    const serialized = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '')
    if (used >= messageBudget) break
    const room = messageBudget - used
    const content = clip(serialized, room)
    selected.unshift({ ...message, content })
    used += content.length
  }

  return { system: clip(system, systemBudget), messages: selected }
}








const CTX_CEILING = 32_768
const CTX_FLOOR = 4_096


const CHARS_PER_TOKEN = 3.5

function estimatePromptTokens({ system = '', messages = [], tools = [] } = {}) {
  let chars = String(system ?? '').length
  for (const m of messages ?? []) {
    chars += String(m.content ?? '').length
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length
  }
  
  
  if (tools?.length) chars += JSON.stringify(tools).length
  return Math.ceil(chars / CHARS_PER_TOKEN)
}

/**
 * `options` do /api/chat.
 *
 * num_ctx é o parâmetro delicado aqui. O default do ollama (4k) trunca em
 * silêncio o system prompt da Agent + histórico e o modelo "esquece" o começo
 * da conversa sem nenhum erro visível — mas pedir a janela cheia do modelo é
 * pior: numa máquina sem GPU o llama-server é morto pelo OOM killer no meio do
 * turno (HTTP 500 "process has terminated: signal: killed", visto com phi3 a
 * 16k num host de 8 GB). Então a janela acompanha o PROMPT: pede o que este
 * turno precisa (+ folga pra resposta), entre 4k e 32k, nunca além do que o
 * modelo suporta. `pool.options` sobrescreve tudo — quem tem VRAM sobrando põe
 * o número que quiser.
 */
export function resolveOllamaOptions({ contextWindow, system, messages, tools, maxTokens, temperature, overrides }) {
  const needed = estimatePromptTokens({ system, messages, tools }) + Math.max(1024, Math.min(maxTokens ?? 1024, 4096))
  const ceiling = Math.min(contextWindow || CTX_CEILING, CTX_CEILING)
  const options = {}
  
  
  if (needed > CTX_FLOOR) {
    options.num_ctx = Math.max(CTX_FLOOR, Math.min(ceiling, Math.ceil(needed / 2048) * 2048))
  }
  if (maxTokens) options.num_predict = maxTokens
  if (temperature != null) options.temperature = temperature
  return { ...options, ...(overrides ?? {}) }
}

const notSupportedTools = (message) => /does not support tools/i.test(String(message ?? ''))



function requiredContext(message) {
  const text = typeof message === 'string' ? message : JSON.stringify(message ?? '')
  const match = text.match(/request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/i)
  if (!match) return null
  return { promptTokens: Number(match[1]), current: Number(match[2]) }
}



const outOfMemory = (message) => /terminated|killed|out of memory|not enough memory|insufficient memory|system memory/i.test(String(message ?? ''))





const _noCtxOverride = new Set()
const memoryKey = (base, model) => `${base}|${model}`

/**
 * Consome o NDJSON do /api/chat. Cada linha é um objeto completo (não é SSE):
 * deltas de `message.content` / `message.thinking`, tool_calls já inteiras, e
 * uma linha final com `done:true` + contadores de token.
 */
async function consumeOllamaStream(res, { onText, onThinking, abortSignal }) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolCalls = []
  let doneReason = null
  let usage = null

  const handle = (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let chunk
    try { chunk = JSON.parse(trimmed) } catch { return }
    if (chunk.error) {
      const err = new Error(`[ollama] ${chunk.error}`)
      err.ollamaError = chunk.error
      throw err
    }
    const message = chunk.message
    if (message?.thinking) onThinking(message.thinking)
    if (message?.content) onText(message.content)
    for (const tc of message?.tool_calls ?? []) {
      const args = tc.function?.arguments
      toolCalls.push({
        id: tc.id || `ollama_call_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: {
          name: tc.function?.name,
          arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
        },
      })
    }
    if (chunk.done) {
      doneReason = chunk.done_reason ?? 'stop'
      usage = {
        prompt_tokens: chunk.prompt_eval_count ?? 0,
        completion_tokens: chunk.eval_count ?? 0,
        total_tokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
      }
    }
  }

  try {
    for (;;) {
      const { done, value } = await readWithIdleTimeout(reader, undefined, abortSignal)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) handle(line)
    }
    if (buffer) handle(buffer)
  } finally {
    try { await reader.cancel() } catch { /* já fechado */ }
  }

  return { toolCalls, doneReason, usage }
}

async function runAttempt(base, body, { onToken, onProgress, abortSignal, emulated }) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abortSignal ?? undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let detail = text
    try { detail = JSON.parse(text)?.error ?? text } catch { /* texto puro */ }
    const err = new Error(`[ollama] HTTP ${res.status}: ${detail}`)
    err.status = res.status
    err.ollamaError = detail
    throw err
  }

  let content = ''
  let reasoning = ''
  const emitReasoning = (text) => {
    reasoning += text
    if (onProgress) onProgress({ type: 'reasoning', text })
  }
  
  
  
  const emitText = (text) => {
    content += text
    if (!emulated && onToken) onToken(text)
  }
  
  
  const filter = createThinkTagFilter(emitText, emitReasoning)

  const { toolCalls, doneReason, usage } = await consumeOllamaStream(res, {
    onText: (text) => filter.push(text),
    onThinking: emitReasoning,
    abortSignal,
  })
  filter.end()

  let calls = toolCalls
  let visible = content
  if (emulated) {
    const extracted = extractCliToolCalls(content)
    if (extracted.toolCalls.length) {
      calls = extracted.toolCalls
      visible = extracted.cleaned
      if (onProgress) for (const tc of calls) {
        let input = {}
        try { input = JSON.parse(tc.function.arguments) } catch { /* mantém {} */ }
        onProgress({ type: 'tool-step', name: tc.function.name, input })
      }
    } else if (onToken && visible) {
      onToken(visible)
    }
  }

  return {
    choices: [{
      message: {
        content: visible,
        reasoning_content: reasoning || undefined,
        tool_calls: calls.length ? calls : undefined,
      },
      finish_reason: calls.length ? 'tool_calls' : (doneReason === 'length' ? 'length' : 'stop'),
    }],
    model: body.model,
    usage: usage ?? undefined,
  }
}

/**
 * Executa 1 turno completo contra o daemon local e devolve o shape interno
 * ("OpenAI chat-completions") que parseResponse() já entende. Ponto de entrada
 * único — usado por callLLM e callLLMStream (llm.js).
 *
 * Tools: usa function-calling NATIVO quando o modelo tem a capability "tools";
 * senão (ou se o daemon recusar com "does not support tools") refaz o turno com
 * o protocolo de texto ```tool_call``` — ver text_tool_protocol.js.
 */
export async function runOllamaTurn(slot, {
  chainModel = null, system = '', messages = [], tools = [],
  onToken = null, onProgress = null, abortSignal = null,
  maxTokens = null, temperature = null, timeoutMs = null,
} = {}) {
  const base = ollamaBase(slot)
  const model = chainModel ?? slot?.model
  if (!model) throw new Error('[ollama] nenhum modelo definido para o slot')

  const caps = capabilitiesFor(base, model)
  const localInput = compactOllamaInput({
    system,
    messages,
    maxInputTokens: slot?.providerOptions?.max_input_tokens,
  })
  
  
  
  
  
  const effectiveTools = caps?.tools ? tools : []
  let options = resolveOllamaOptions({
    contextWindow: caps?.contextWindow ?? null,
    system: localInput.system, messages: localInput.messages, tools: effectiveTools, maxTokens, temperature,
    overrides: slot?.providerOptions ?? null,
  })
  if (_noCtxOverride.has(memoryKey(base, model)) && !slot?.providerOptions?.num_ctx) {
    delete options.num_ctx
  }
  
  
  let emulated = false
  
  
  
  
  
  const useThinking = Boolean(caps?.thinking) && effectiveTools.length === 0
  
  
  let retriedTools = false
  let retriedMemory = false
  let retriedContext = false

  
  
  
  
  
  const controller = new AbortController()
  let timedOut = false
  const timeout = Number(timeoutMs)
  const forwardAbort = () => controller.abort(abortSignal?.reason)
  if (abortSignal) {
    if (abortSignal.aborted) forwardAbort()
    else abortSignal.addEventListener('abort', forwardAbort, { once: true })
  }
  const timer = Number.isFinite(timeout) && timeout > 0
    ? setTimeout(() => { timedOut = true; controller.abort() }, timeout)
    : null

  try {
    for (;;) {
      const body = buildOllamaBody({
        model, system: localInput.system, messages: localInput.messages, tools: effectiveTools, emulated,
        think: useThinking,
        options,
      })
      try {
        return await runAttempt(base, body, { onToken, onProgress, abortSignal: controller.signal, emulated })
      } catch (e) {
        if (timedOut) throw new Error(`[ollama] ${model} excedeu o limite de ${timeout} ms sem concluir`)
        if (e?.name === 'AbortError') throw e
      const detail = e.ollamaError ?? e.message
      
        if (!emulated && !retriedTools && effectiveTools.length && notSupportedTools(detail)) {
        emulated = true
        retriedTools = true
        refreshOllamaModels(base, { force: true }).catch(() => { })
        continue
      }
      
      
      
      const demand = requiredContext(detail)
      const maxContext = Math.min(caps?.contextWindow || CTX_CEILING, CTX_CEILING)
      if (!retriedContext && demand && demand.promptTokens <= maxContext && demand.promptTokens > (options.num_ctx ?? CTX_FLOOR)) {
        retriedContext = true
        const responseReserve = Math.max(1024, Math.min(maxTokens ?? 1024, 4096))
        const targetContext = Math.min(maxContext, demand.promptTokens + responseReserve)
        options = { ...options, num_ctx: Math.max(CTX_FLOOR, Math.ceil(targetContext / 2048) * 2048) }
        console.warn(`[ollama] ${model}: estimativa de contexto curta (${demand.current} → ${options.num_ctx}), refazendo uma vez`)
        continue
      }
      
      
      if (!retriedMemory && options.num_ctx && outOfMemory(detail)) {
        retriedMemory = true
        const { num_ctx, ...rest } = options
        options = rest
        _noCtxOverride.add(memoryKey(base, model))
        console.warn(`[ollama] ${model}: sem memória para num_ctx=${num_ctx}, refazendo com a janela padrão do daemon`)
        continue
      }
      throw e
      }
    }
  } finally {
    if (timer) clearTimeout(timer)
    if (abortSignal) abortSignal.removeEventListener('abort', forwardAbort)
  }
}
