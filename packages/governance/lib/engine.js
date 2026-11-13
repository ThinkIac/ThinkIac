import { createHash } from 'node:crypto'

// O nome da ação é normalizado para snake_case antes de qualquer teste, para
// que `sendNtfyNotification` e `send_ntfy_notification` classifiquem igual.
const normalizeSubject = (value) => String(value || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[.:\-\s]+/g, '_')
  .toLowerCase()

const SAFE_PREFIXES = /(^|_)(get|list|read|query|search|find|status|check|preview|resolve|audit|scan|test|validate|dashboard|top|stats|recall|manifest|logs)(_|$)/
const BLOCKED = /get_secret|permanent_delete|remove_disabled_package|activate_shortcode|bypass|disable_security|exfiltrate|export_secret/

// A classificação separa alteração local, efeitos externos, execução/custo e
// operações destrutivas. A política da sessão decide a exceção permitida, mas
// nenhuma ação mutável é confundida com leitura.
const DESTRUCTIVE = /(^|_)(delete|remove|destroy|drop|purge|wipe|revoke|uninstall|discard|forget|reset|restore|rollback|overwrite|truncate|move|rename|disable|reboot|restart|promote|commit|migrate)(_|$)/
const EXTERNAL = /(^|_)(send|publish|notify|email|deploy|connect|disconnect|install|upload|push|checkout|purchase|pay|share|activate)(_|$)/
const COSTLY = /(^|_)(llm|crew|generate|benchmark|reindex|research|video|shell|execute|exec)(_|$)/

const SENSITIVE_KEYS = /token|secret|password|authorization|api[_-]?key|appPassword|cookie/i

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[redacted]' : redact(item)]))
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}

export function actionHash({ sessionId, tool, input, target }) {
  return createHash('sha256').update(JSON.stringify({ sessionId, tool, target: target || null, input: canonical(input || {}) })).digest('hex')
}

export function unwrapAction({ tool, input = {} } = {}) {
  if (tool === 'run_runtime_tool') {
    const target = `${input.package || 'unknown'}.${input.tool || 'unknown'}`
    return { tool, target, subject: `${input.package || ''}_${input.tool || ''}`, input: input.args || {} }
  }
  return { tool, target: null, subject: tool || 'unknown', input }
}

/**
 * Ações apenas de leitura. O modo manual aprova essas automaticamente: exigir
 * confirmação para `list`/`get` tornaria o modo inutilizável, e elas não
 * alteram estado nem alcançam nada fora do ambiente.
 */
export function isReadOnly(action = {}) {
  const normalized = unwrapAction(action)
  return normalized.tool === 'bag_retrieve_evidence' || SAFE_PREFIXES.test(normalizeSubject(normalized.subject))
}

export function classifyAction(action = {}) {
  const normalized = unwrapAction(action)
  // Classifica pelo nome da ação real. O wrapper (`run_runtime_tool`) ficava
  // fora: como ele contém "run_", qualquer tool de runtime casava com a regra
  // de execução e o gate disparava para tudo, inclusive leituras.
  const subject = normalizeSubject(normalized.subject)
  if (!action.sessionId) return { classification: 'blocked', category: 'sensitive', reason: 'A ação não possui sessionId rastreável.', ...normalized }
  if (/^(evaluateGovernanceAction|resolveGovernanceConfirmation|listGovernanceDecisions)$/i.test(normalized.tool)) {
    return { classification: 'safe', category: 'read', reason: 'Operação interna de governança, validada pelo próprio serviço.', ...normalized }
  }
  if (normalized.tool === 'request_tool_access') {
    return { classification: 'needs_confirmation', category: 'capability_expansion', reason: 'A ação amplia temporariamente as capacidades disponíveis ao agente nesta sessão.', ...normalized }
  }
  if (BLOCKED.test(subject) || BLOCKED.test(normalizeSubject(normalized.tool))) {
    return { classification: 'blocked', category: 'sensitive', reason: 'Ação sensível, irreversível ou de bypass não é autorizada por esta camada.', ...normalized }
  }
  // Browser observation, navigation and reversible page preparation should
  // flow without one approval per gesture. A click explicitly marked as an
  // external effect remains approval-gated and is independently checked by
  // the native GeckoView driver.
  if (/^browser_(list_tabs|get_page_state|find|navigate|history|press|scroll|fill|open_tab|focus_tab|wait|cancel_action)$/.test(subject)) {
    return { classification: 'safe', category: subject === 'browser_fill' ? 'preparation' : 'navigation', reason: 'Interação reversível e observável no GeckoView.', ...normalized }
  }
  if (subject === 'browser_click' && normalized.input?.allowExternalEffect !== true) {
    return { classification: 'safe', category: 'navigation', reason: 'Clique de navegação sujeito ao bloqueio nativo de efeitos externos.', ...normalized }
  }
  if (subject === 'browser_click' && normalized.input?.allowExternalEffect === true) {
    return { classification: 'needs_confirmation', category: 'external', reason: 'O clique pode enviar, publicar, comprar, pagar ou excluir conteúdo.', ...normalized }
  }
  if (normalized.tool === 'bag_retrieve_evidence' || SAFE_PREFIXES.test(subject)) return { classification: 'safe', category: 'read', reason: 'Consulta ou diagnóstico sem alteração de estado detectado.', ...normalized }
  if (DESTRUCTIVE.test(subject)) return { classification: 'needs_confirmation', category: 'destructive', reason: 'Ação destrutiva ou potencialmente irreversível.', ...normalized }
  if (EXTERNAL.test(subject)) return { classification: 'needs_confirmation', category: 'external', reason: 'Ação alcança sistemas externos ou publica conteúdo fora do ambiente local.', ...normalized }
  if (COSTLY.test(subject)) return { classification: 'needs_confirmation', category: 'execution', reason: 'Ação executa código arbitrário ou gera custo de modelo/serviço.', ...normalized }
  return { classification: 'needs_confirmation', category: 'local_write', reason: 'Ação local que altera estado.', ...normalized }
}

const MAX_PARAM_CHARS = 600

/** Serializa um valor de argumento para exibição, sem estourar o card. */
function previewValue(value, full = false) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return !full && value.length > MAX_PARAM_CHARS ? `${value.slice(0, MAX_PARAM_CHARS)}… (+${value.length - MAX_PARAM_CHARS} chars)` : value
  let text
  try { text = JSON.stringify(value, null, 2) } catch { text = String(value) }
  if (text == null) text = String(value)
  return !full && text.length > MAX_PARAM_CHARS ? `${text.slice(0, MAX_PARAM_CHARS)}… (+${text.length - MAX_PARAM_CHARS} chars)` : text
}

/**
 * Descrição exibível da ação: nome real da tool, alvo e cada argumento já
 * redigido. É o que a UI mostra no card de aprovação — a pergunta genérica
 * ("confirmar ação?") não dá ao usuário o que ele precisa para decidir.
 */
export function describeCommand(action = {}, {full = false} = {}) {
  const normalized = unwrapAction(action)
  const redacted = redact(normalized.input || {})
  const params = Object.entries(redacted).map(([name, value]) => ({ name, value: previewValue(value, full) }))
  const command = normalized.target ? `${normalized.target}` : normalized.tool
  return {
    tool: normalized.tool,
    target: normalized.target,
    command,
    params,
    // Linha única copiável, no formato `tool(param=valor, …)`.
    signature: `${command}(${params.map(p => `${p.name}=${p.value.includes('\n') ? '…' : p.value}`).join(', ')})`
  }
}

export function structuredInput(decision, command = null) {
  return [{
    type: 'confirm',
    question: `Confirmar: ${decision.tool}${decision.target ? ` (${decision.target})` : ''}? ${decision.reason}`,
    confirmLabel: 'Aprovar ação',
    cancelLabel: 'Negar ação',
    governanceDecisionId: decision.id,
    submitEvent: 'logos:governance:resolve',
    responseEvent: 'structured-input:resolved',
    // A UI renderiza isso como bloco de comando + tabela de parâmetros.
    command
  }]
}
