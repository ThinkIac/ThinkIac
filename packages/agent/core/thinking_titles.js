















import { eventCall as $ } from '../host/agent_host.js'




export const STATIC_TITLES = [
  'Working through it',
  'Mapping the approach',
  'Weighing the options',
  'Connecting the dots',
  'Planning the steps',
  'Reasoning it out',
  'Structuring the answer',
  'Gathering the pieces',
  'Checking the details',
  'Thinking it through',
]

const MIN_TITLES = 3
const MAX_TITLES = 5
const MAX_LEN = 32          
const CACHE_TTL = 300_000   
const CACHE_MAX = 200       

const CACHE = new Map()     

function cacheKey(message) {
  return String(message ?? '').trim().slice(0, 200)
}

function readCache(key) {
  const hit = CACHE.get(key)
  if (!hit) return null
  if (Date.now() - hit.ts > CACHE_TTL) { CACHE.delete(key); return null }
  return hit.titles
}

function writeCache(key, titles) {
  
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value)
  CACHE.set(key, { ts: Date.now(), titles })
}

function extractText(res) {
  if (!res) return ''
  if (typeof res === 'string') return res
  return res.text ?? res.content ?? res.choices?.[0]?.message?.content ?? res.data?.text ?? ''
}

/**
 * Limpa o que o modelo devolveu: aceita só frases curtas, sem pontuação final,
 * sem duplicatas. Um item ruim não invalida a resposta inteira — descartamos o
 * item e seguimos, porque o custo de refazer a chamada é maior que o da frase.
 */
export function sanitizeTitles(raw) {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const clean = item.trim().replace(/[.!…]+$/, '').replace(/\s+/g, ' ')
    if (!clean || clean.length > MAX_LEN) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length === MAX_TITLES) break
  }
  return out
}

/** Completa com as estáticas (sem repetir) até atingir o mínimo. */
export function padTitles(titles) {
  const out = [...titles]
  const taken = new Set(out.map(t => t.toLowerCase()))
  for (const t of STATIC_TITLES) {
    if (out.length >= MIN_TITLES) break
    if (taken.has(t.toLowerCase())) continue
    out.push(t)
  }
  return out
}

function parseTitles(text) {
  try {
    const parsed = JSON.parse(String(text ?? '').replace(/```json|```/g, '').trim())
    return sanitizeTitles(Array.isArray(parsed) ? parsed : parsed?.titles)
  } catch {
    return []
  }
}

function buildPrompt(message) {
  return [
    'A user sent the message below to an AI agent. Write 3 to 5 very short',
    'status phrases (2–4 words each, English, Title case, no final punctuation)',
    'describing what the agent is doing while it works on THIS message.',
    'Be specific to the subject — avoid generic filler like "Thinking".',
    '',
    `Message: """${String(message).slice(0, 600)}"""`,
    '',
    'Reply with JSON only: {"titles": ["...", "..."]}',
  ].join('\n')
}

/**
 * Frases de "pensando" para uma mensagem.
 *
 * @param   {string} message - a mensagem do usuário que abriu o turno
 * @returns {Promise<string[]>} sempre >= MIN_TITLES itens; nunca lança
 */
export async function thinkingTitlesFor(message) {
  const key = cacheKey(message)
  if (!key) return [...STATIC_TITLES]

  const cached = readCache(key)
  if (cached) return cached

  let titles = []
  try {
    const res = await $('llm:call', {
      system: 'Responda apenas com JSON válido, sem markdown.',
      prompt: buildPrompt(message),
      requirements: {
        requires: { modalities: ['text:input'], structuredOutput: true },
        prefers: { reasoning: 'low' },
      },
    })
    titles = parseTitles(extractText(res))
  } catch {
    titles = [] 
  }

  const final = padTitles(titles)
  
  
  if (titles.length) writeCache(key, final)
  return final
}
