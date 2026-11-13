













/**
 * Ordem importa: a primeira regra que casar vence. `credit` vem antes de
 * `rate_limit` porque o Claude usa "usage limit"/"quota" tanto pra saldo
 * esgotado quanto pra throttling, e tratar saldo como throttling faria o
 * failover insistir numa conta que não vai voltar sozinha.
 */
const RULES = [
  ['credit', [
    /credit balance is too low/i,
    /insufficient (credits?|funds|balance|quota)/i,
    /(out of|no) credits?\b/i,
    /purchase more credits/i,
    /(upgrade|check) your plan/i,
    /billing|payment required/i,
    /quota (exceeded|exhausted)/i,
    /upgrade to (pro|plus|max)\b/i,
    
    
    
    
    /usage limit/i,
    /\b402\b/,
  ]],
  ['rate_limit', [
    /rate.?limit/i,
    /too many requests/i,
    /\b429\b/,
  ]],
  ['auth', [
    /\b401\b/,
    /missing bearer/i,
    /unauthorized/i,
    /invalid api key/i,
    /(not logged in|please login|login expired|session expired)/i,
  ]],
  ['model', [
    /issue with the selected model/i,
    /model .*(not found|does not exist|unavailable)/i,
  ]],
]

/**
 * Classifica o texto de falha de um CLI.
 *
 * @param   {string} text - stderr e/ou erro estruturado já extraído do CLI
 * @returns {'credit'|'rate_limit'|'auth'|'model'|null} null = causa desconhecida
 */
export function classifyCliFailure(text) {
  const blob = String(text || '')
  if (!blob.trim()) return null
  for (const [kind, patterns] of RULES) {
    if (patterns.some(re => re.test(blob))) return kind
  }
  return null
}

/**
 * Mensagem acionável em português para uma causa classificada.
 *
 * @param   {string} kind      - retorno de classifyCliFailure
 * @param   {object} [ctx]
 * @param   {string} [ctx.bin]     - binário executado (ex: "claude")
 * @param   {string} [ctx.account] - nome da conta do pool que falhou
 * @returns {string} vazia quando não há nada útil a dizer (kind null/desconhecido)
 */
export function describeCliFailure(kind, { bin = 'cli', account = null } = {}) {
  const who = account ? `Conta "${account}" (${bin})` : `A conta em uso do ${bin}`
  switch (kind) {
    case 'credit':
      return `${who} está sem crédito — pulando para a próxima conta do pool.`
    case 'rate_limit':
      return `${who} atingiu o limite de requisições — pulando para a próxima conta do pool.`
    case 'auth':
      return `${who} não está autenticada (login expirado ou ausente) — refaça o login desse perfil.`
    case 'model':
      return `${who} não tem acesso ao modelo pedido.`
    default:
      return ''
  }
}










const DEFAULT_COOLDOWN_MS = {
  credit:     60 * 60 * 1000, 
  rate_limit:  5 * 60 * 1000,
}

/**
 * Extrai o instante de retomada anunciado pelo CLI, quando houver.
 *
 * Cobre as duas formas vistas em campo:
 *   "try again at Jul 28th, 2026 7:00 PM"    → data absoluta
 *   "try again in 42 minutes" / "in 2 hours" → offset relativo
 *
 * @param   {string} text
 * @returns {number|null} epoch em ms, ou null se a mensagem não disser
 */
export function parseRetryAt(text) {
  const blob = String(text || '')

  const abs = blob.match(/try again at ([^.)\n"]+)/i)
  if (abs) {
    
    const cleaned = abs[1].trim().replace(/(\d+)(st|nd|rd|th)\b/gi, '$1')
    const ts = Date.parse(cleaned)
    if (Number.isFinite(ts)) return ts
  }

  const rel = blob.match(/try again in (\d+)\s*(second|minute|hour|day)s?/i)
  if (rel) {
    const unit = { second: 1e3, minute: 60e3, hour: 3600e3, day: 86400e3 }[rel[2].toLowerCase()]
    return Date.now() + Number(rel[1]) * unit
  }

  return null
}

/**
 * Por quanto tempo este slot deve sair do rodízio.
 *
 * @param   {string} kind - retorno de classifyCliFailure
 * @param   {string} text - texto da falha (onde mora a hora de retomada)
 * @returns {number} ms de cooldown; 0 = sem cooldown, para causas que NÃO se
 *   resolvem com o tempo (`auth` exige login humano, `model` exige trocar o
 *   modelo pedido) — reabilitar sozinho ali só repetiria a falha.
 */
export function cooldownFor(kind, text) {
  const base = DEFAULT_COOLDOWN_MS[kind]
  if (!base) return 0
  const retryAt = parseRetryAt(text)
  if (retryAt == null) return base
  
  
  const delta = retryAt - Date.now() + 30_000
  
  if (delta <= 0) return base
  
  return Math.min(delta, 24 * 60 * 60 * 1000)
}

/** O erro veio de saldo/cota esgotada? Usado pelo failover de llm2.js. */
export function isCreditFailure(err) {
  const kind = err?.failureKind ?? classifyCliFailure(`${err?.message || ''} ${err?.stderr || ''}`)
  return kind === 'credit' || kind === 'rate_limit'
}

/**
 * Traduz uma falha de CLI para a política do rodízio de slots.
 *
 * Crédito/cota sai do rodízio já na primeira falha e volta no prazo anunciado
 * pelo provider. Erros desconhecidos preservam a tolerância existente de três
 * falhas. `noRetry` não faz parte desta política: o chamador deve relançar esse
 * erro antes de tentar outro slot, pois ele indica que o turno já executou uma
 * ação e não pode ser repetido com segurança.
 */
export function cliFailureDisposition(err) {
  const detail = `${err?.message || ''} ${err?.stderr || ''}`.trim()
  const kind = err?.failureKind ?? classifyCliFailure(detail)
  const exhausted = kind === 'credit' || kind === 'rate_limit'
  return {
    reason: kind,
    forceDisable: exhausted,
    cooldownMs: exhausted ? cooldownFor(kind, detail) : 0,
  }
}
