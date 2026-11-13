// Classificador do modo semi-automático. O usuário escreve UM prompt por
// sessão ("liberdade total", "pode tudo menos apagar arquivo", …) e a LLM
// decide, ação por ação, se aquilo se encaixa na liberdade concedida.
//
// Duas regras não negociáveis:
//  1. Falha (LLM fora do ar, JSON inválido, prompt vazio) → cai para a
//     classificação determinística do engine, ou seja, pede confirmação.
//     Nunca aprova por omissão.
//  2. O veredito é cacheado por hash da ação para não pagar uma chamada de
//     modelo a cada repetição da mesma tool com os mesmos argumentos.

const verdictCache = new Map()
const CACHE_LIMIT = 500

let callFn = null

/** Injeta o cliente de LLM (o default é resolvido preguiçosamente). */
export function setSemiClassifierForTest(fn) {
  callFn = fn
  verdictCache.clear()
}

async function resolveCall() {
  if (callFn) return callFn
  const { dispatchEvent } = await import('logos')
  return args => dispatchEvent('llm:call', args)
}

const SYSTEM = [
  'Você é o classificador de risco de um agente. Receberá:',
  '(a) a POLÍTICA que o usuário definiu para esta sessão, em linguagem natural;',
  '(b) a AÇÃO que o agente quer executar agora, com nome e argumentos;',
  '(c) a classificação determinística de base do sistema.',
  '',
  'Decida se a ação está coberta pela política declarada pelo usuário.',
  'Responda APENAS com um JSON, sem texto ao redor, no formato:',
  '{"decision":"allow"|"confirm","risk":"low"|"medium"|"high","reason":"<uma frase curta em português>"}',
  '',
  '- "allow": a política do usuário claramente autoriza este tipo de ação.',
  '- "confirm": a política proíbe, restringe, não menciona esse tipo de ação,',
  '  ou você está em dúvida. Na dúvida, sempre "confirm".',
  'A razão é mostrada ao usuário — cite o trecho da política que motivou a decisão.'
].join('\n')

function trimCache() {
  if (verdictCache.size <= CACHE_LIMIT) return
  const excess = verdictCache.size - CACHE_LIMIT
  for (const key of [...verdictCache.keys()].slice(0, excess)) verdictCache.delete(key)
}

function parseVerdict(raw) {
  const text = String(raw || '')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  let parsed
  try { parsed = JSON.parse(match[0]) } catch { return null }
  const decision = parsed.decision === 'allow' ? 'allow' : parsed.decision === 'confirm' ? 'confirm' : null
  if (!decision) return null
  const risk = ['low', 'medium', 'high'].includes(parsed.risk) ? parsed.risk : 'medium'
  return { decision, risk, reason: String(parsed.reason || '').slice(0, 300) }
}

/**
 * @returns {Promise<{decision:'allow'|'confirm', risk:string, reason:string, source:string}>}
 */
export async function classifyWithPolicy({ policyPrompt, command, baseClassification, category, actionHash } = {}) {
  const fallback = {
    decision: 'confirm',
    risk: 'medium',
    reason: 'Semi-automático sem veredito da LLM: a confirmação manual permanece exigida.',
    source: 'fallback'
  }
  if (!policyPrompt || !policyPrompt.trim()) {
    return { ...fallback, reason: 'Nenhuma política definida para a sessão — o semi-automático exige confirmação.' }
  }
  if (actionHash && verdictCache.has(actionHash)) return verdictCache.get(actionHash)

  const params = (command?.params || []).map(p => `  - ${p.name}: ${p.value}`).join('\n') || '  (sem argumentos)'
  const user = [
    `POLÍTICA DA SESSÃO:\n${policyPrompt.trim()}`,
    '',
    `AÇÃO:\n  tool: ${command?.command || command?.tool || 'desconhecida'}`,
    `ARGUMENTOS:\n${params}`,
    '',
    `CLASSIFICAÇÃO DE BASE: ${baseClassification || 'desconhecida'}`,
    `CATEGORIA DETERMINÍSTICA: ${category || 'desconhecida'}`
  ].join('\n')

  try {
    const call = await resolveCall()
    const res = await call({
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      requirements: {
        requires: { modalities: ['text:input'], structuredOutput: true },
        prefers: { reasoning: 'low' },
      },
    })
    const raw = res?.text ?? res?.choices?.[0]?.message?.content ?? ''
    const verdict = parseVerdict(raw)
    if (!verdict) return fallback
    const result = { ...verdict, source: 'llm' }
    if (actionHash) { verdictCache.set(actionHash, result); trimCache() }
    return result
  } catch (error) {
    return { ...fallback, reason: `Classificador indisponível (${error.message}) — confirmação manual mantida.` }
  }
}
