










import { getConfig } from '../utils/config.js'
import { getSession, setSessionTitle } from '../memory/session.js'


const DEFAULTS = {
  enabled: true,
  every: 6,        
  minMessages: 2,  
  maxChars: 60,
  model: null,
}

/** Config efetiva: DEFAULTS < config.sessions.title. Config ausente não é erro. */
export function getTitleConfig(config = null) {
  let cfg = config
  if (!cfg) {
    try { cfg = getConfig() } catch { cfg = null }
  }
  return { ...DEFAULTS, ...(cfg?.sessions?.title ?? {}) }
}

/**
 * Decide se é hora de (re)gerar o título.
 *
 * Regera quando a conversa cresceu `every` mensagens desde a última geração —
 * assim uma sessão que muda de assunto ganha um título novo, e uma sessão parada
 * não gasta chamada nenhuma.
 *
 * @param {{title?: string|null, title_message_count?: number}} session
 * @param {number} messageCount
 * @param {object} cfg - saída de getTitleConfig()
 */
export function shouldGenerateTitle(session, messageCount, cfg) {
  if (!cfg.enabled) return false
  if (messageCount < cfg.minMessages) return false
  if (!session?.title) return true
  const since = messageCount - (session.title_message_count ?? 0)
  return since >= cfg.every
}

/**
 * Últimas mensagens em texto plano, para o prompt do titulador.
 * Só user/assistant com conteúdo string: resultado de tool e tool_calls são
 * ruído caro para um modelo pequeno.
 */
export function buildTitleTranscript(messages, limit = 12, maxChars = 4000) {
  const useful = (messages ?? [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-limit)
    .map(m => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content.trim().slice(0, 600)}`)
  return useful.join('\n').slice(-maxChars)
}

const SYSTEM_PROMPT =
  'Você nomeia conversas. Leia o trecho e responda APENAS com um título curto ' +
  'em português, no máximo 6 palavras, sem aspas, sem ponto final e sem prefixos ' +
  'como "Título:". Descreva o ASSUNTO, no estilo: "Correção de bug no login", ' +
  '"Dúvidas sobre Docker", "Planejamento da migração".'

/**
 * Limpa a resposta do modelo pequeno: eles adoram devolver aspas, "Título:",
 * blocos <think> e um parágrafo inteiro quando pedimos uma frase.
 * @returns {string|null} título utilizável, ou null se a resposta não serve.
 */
export function sanitizeTitle(raw, maxChars = DEFAULTS.maxChars) {
  if (typeof raw !== 'string') return null
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  text = (text.split('\n').map(l => l.trim()).find(Boolean) ?? '')
  text = text.replace(/^(t[ií]tulo|title)\s*[:\-—]\s*/i, '')
  text = text.replace(/^["'“”‘’`]+|["'“”‘’`.]+$/g, '').trim()
  text = text.replace(/\s+/g, ' ')
  if (!text) return null
  if (text.length > maxChars) {
    
    const cut = text.slice(0, maxChars)
    const space = cut.lastIndexOf(' ')
    text = (space > maxChars * 0.6 ? cut.slice(0, space) : cut).trim()
  }
  return text || null
}

/**
 * Gera o título chamando o modelo pequeno. Não escreve nada em disco.
 * @param {Array} messages
 * @param {Function} callLLM - ({system, messages, requirements, tools}) => res
 * @param {object?} cfg
 * @returns {Promise<string|null>}
 */
export async function generateTitle(messages, callLLM, cfg = null) {
  const conf = cfg ?? getTitleConfig()
  const transcript = buildTitleTranscript(messages)
  if (!transcript) return null

  const res = await callLLM({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: transcript }],
    model: conf.model,
    requirements: {
      requires: { modalities: ['text:input'] },
      prefers: { reasoning: 'low' },
      policy: { quality: 0.25, cost: 0.4, latency: 0.35 },
    },
    tools: [],
  })

  const raw = res?.choices?.[0]?.message?.content ?? res?.text ?? ''
  return sanitizeTitle(raw, conf.maxChars)
}

/**
 * Orquestra: checa o intervalo, gera e persiste. Chame em fire-and-forget.
 *
 * @param {string} sessionId
 * @param {Function} callLLM
 * @param {object} deps - injeção para teste (store da sessão e config)
 * @returns {Promise<string|null>} título novo, ou null se não gerou
 */
export async function maybeTitleSession(sessionId, callLLM, deps = {}) {
  const read = deps.getSession ?? getSession
  const write = deps.setSessionTitle ?? setSessionTitle
  const cfg = deps.config ?? getTitleConfig()

  try {
    const session = read(sessionId)
    if (!session) return null

    const count = session.messages?.length ?? 0
    if (!shouldGenerateTitle(session, count, cfg)) return null

    const title = await generateTitle(session.messages, callLLM, cfg)
    if (!title) return null

    write(sessionId, title, count)
    return title
  } catch {
    
    return null
  }
}
