import { dispatchEvent } from 'logos'
import { actionHash, classifyAction, describeCommand, isReadOnly, redact, structuredInput } from './lib/engine.js'
import { getPolicy, setPolicy, listPolicies, DEFAULT_MODE, MODES, PRESET_IDS } from './lib/policy.js'
import { classifyWithPolicy } from './lib/semi.js'
import { db } from './lib/store.js'

// A confirmação guarda a chamada original fora do prompt/modelo. Assim, a
// aprovação nunca depende de a LLM reconstruir argumentos potencialmente
// diferentes. O mapa é deliberadamente fail-closed: após um restart, uma
// confirmação pendente não executa nada e precisa ser proposta novamente.
const pendingActions = new Map()
let store = db
let eventDispatcher = dispatchEvent

function runtimeOrigin() {
  const configured = process.env.THINKIAC_PUBLIC_URL || process.env.AGENT_PUBLIC_URL
  try { return new URL(configured || 'https://thinkiac.cloud').origin } catch { return 'https://thinkiac.cloud' }
}

function approvalDeepLink(sessionId) {
  return new URL(`/view/shell/Index?open=chat&session=${encodeURIComponent(sessionId)}`, runtimeOrigin()).toString()
}

/** Apenas para testes isolados; a execução normal usa o proxy do runtime. */
export function setGovernanceStoreForTest(nextStore) {
  store = nextStore || db
}

/** Apenas para testes isolados; evita depender do event bus do runtime. */
export function setGovernanceEventDispatcherForTest(nextDispatcher) {
  eventDispatcher = nextDispatcher || dispatchEvent
}

async function audit(decision) {
  dispatchEvent('cognitive:governance', { schemaVersion: 1, ...decision, input: undefined }).catch(() => {})
}

/**
 * Aplica o modo de aprovação da sessão sobre a classificação determinística.
 *
 * - `manual`  → tudo que altera estado pede aprovação (leituras passam).
 * - `auto`    → aprova o que o engine só pediria confirmação, avisando que foi
 *               por conta e risco. O que é `blocked` continua bloqueado: são
 *               segredos/bypass, não "risco assumido".
 * - `semi`    → uma LLM decide contra o prompt que o usuário escreveu para a
 *               sessão; qualquer falha cai em pedir confirmação.
 */
async function applyMode({ action, classified, policy, command, hash, authorize }) {
  const base = { classification: classified.classification, reason: classified.reason, autoApproved: false, riskLevel: null, policySource: 'engine' }
  if (classified.classification === 'blocked') return base
  // A ação crua, não a já desembrulhada: `classified.input` são os args de
  // dentro do run_runtime_tool e perder o wrapper faz o nome real sumir.
  const readOnly = isReadOnly(action)
  if (readOnly) return { ...base, classification: 'safe', policySource: 'read-only-proof' }

  // Internal callback only: JSON tool inputs cannot provide executable authority.
  // Absolute blocks were checked above; the callback checks the live grant.
  if (typeof authorize === 'function') {
    let grant = null
    try { grant = await authorize() } catch { /* fail closed */ }
    if (grant?.id) {
      const automaticFlow = grant.source === 'flow:auto-approve'
      return { ...base, classification: 'safe', autoApproved: true,
        reason: grant.source === 'andar:coordination' ? grant.reason : automaticFlow
          ? `Aceite automático configurado no Flow ${grant.workflowId}, nó ${grant.nodeId}.`
          : `Autorização persistente do Flow ${grant.workflowId}, nó ${grant.nodeId}, registro ${grant.id}.`,
        policySource: grant.source === 'andar:coordination' ? grant.source : automaticFlow ? grant.source : 'flow:preauthorized', riskLevel: 'assumed' }
    }
  }

  if (policy.mode === 'auto') {
    return {
      ...base,
      classification: 'safe',
      autoApproved: classified.classification === 'needs_confirmation',
      riskLevel: classified.classification === 'needs_confirmation' ? 'assumed' : null,
      reason: classified.classification === 'needs_confirmation'
        ? `Modo automático: aprovado por sua conta e risco. Motivo do alerta: ${classified.reason}`
        : classified.reason,
      policySource: 'mode:auto'
    }
  }

  if (policy.mode === 'semi') {
    if (policy.preset === 'read_only') {
      return { ...base, classification: 'needs_confirmation', reason: 'Preset Read only: esta ação altera estado ou executa recursos e exige aprovação.', policySource: 'preset:read_only' }
    }
    if (policy.preset === 'workspace_edits' && classified.category !== 'local_write') {
      return { ...base, classification: 'needs_confirmation', reason: `Preset Workspace edits não libera ações da categoria ${classified.category}.`, policySource: 'preset:workspace_edits' }
    }
    const verdict = await classifyWithPolicy({
      policyPrompt: policy.prompt,
      command,
      baseClassification: classified.classification,
      category: classified.category,
      actionHash: hash
    })
    if (verdict.decision === 'allow') {
      return {
        ...base,
        classification: 'safe',
        autoApproved: classified.classification === 'needs_confirmation',
        riskLevel: verdict.risk,
        reason: `Semi-automático (risco ${verdict.risk}): ${verdict.reason}`,
        policySource: `mode:semi:${verdict.source}`
      }
    }
    return {
      ...base,
      classification: 'needs_confirmation',
      riskLevel: verdict.risk,
      reason: `Semi-automático (risco ${verdict.risk}): ${verdict.reason}`,
      policySource: `mode:semi:${verdict.source}`
    }
  }

  // manual (default)
  return {
    ...base,
    classification: 'needs_confirmation',
    reason: classified.classification === 'needs_confirmation'
      ? classified.reason
      : 'Modo manual: toda ação que altera estado precisa da sua aprovação.',
    policySource: 'mode:manual'
  }
}

function containsGovernanceControl(action, depth=0) {
 if(depth>8)return true;
 if(['resolveGovernanceConfirmation','setGovernancePolicy'].includes(action.tool))return true;
 if(action.tool==='run_runtime_tool')return containsGovernanceControl({tool:action.input?.tool,input:action.input?.args},depth+1);
 if(action.tool==='run_tool')return containsGovernanceControl({tool:action.input?.name,input:action.input?.input},depth+1);
 if(action.tool==='run_parallel')return (action.input?.tools||[]).some(c=>containsGovernanceControl({tool:c.name,input:c.input},depth+1));
 return false;
}

export async function evaluateAction(action = {}, { authorize, requireReview = false, reviewSource = null, continuation = null } = {}) {
  const classified = classifyAction(action)
  if (requireReview && containsGovernanceControl(action)) {classified.classification='blocked';classified.reason='A equipe não pode resolver aprovações nem alterar a própria governança.';}
  const command = describeCommand(action, {full:requireReview})
  const hash = actionHash({ sessionId: action.sessionId, tool: classified.tool, target: classified.target, input: classified.input })
  const policy = requireReview ? {mode:'manual',preset:'read_only',prompt:''} : action.sessionId ? getPolicy(action.sessionId) : { mode: DEFAULT_MODE, preset: 'read_only', prompt: '' }
  const gated = await applyMode({ action, classified, policy, command, hash, authorize })

  const duplicate = requireReview && gated.classification==='needs_confirmation' ? store.governanceDecision.query({sessionId:action.sessionId,actionHash:hash,status:'pending'}, {limit:1})[0] : null;
  const persistedDecision = duplicate && pendingActions.has(duplicate.id) ? duplicate : await store.governanceDecision.push({
    sessionId: action.sessionId,
    tool: classified.tool,
    target: classified.target,
    classification: gated.classification,
    reason: gated.reason,
    actionHash: hash,
    status: gated.classification === 'safe' ? 'allowed' : gated.classification === 'blocked' ? 'blocked' : 'pending',
    createdAt: new Date().toISOString(),
    // Guardado como texto para a UI reconstruir o card sem depender do
    // pendingActions em memória (que some no restart).
    command: JSON.stringify(command)
  })
  // `governanceDecision` é um RecordProxy estrito. Estes campos são contexto
  // derivado da política atual, não colunas do schema persistido; atribuí-los
  // ao record lança e, no caminho de uma tool, derruba o processo inteiro.
  // Decoramos uma cópia para auditoria/UI, preservando a decisão durável com
  // o contrato que já existe em schema.prisma.
  const decision = {
    ...persistedDecision,
    policySource: gated.policySource,
    mode: policy.mode,
    preset: policy.preset,
    autoApproved: gated.autoApproved,
  }
  if (decision.status === 'pending') {
    pendingActions.set(decision.id, {
      sessionId: action.sessionId,
      tool: action.tool,
      input: structuredClone(action.input ?? {}),
      actionHash: hash,
      reportReview: requireReview && reviewSource !== 'presence',
      continuation: reviewSource === 'presence' ? structuredClone(continuation) : null,
    })
  }
  await audit(decision)
  if (decision.status === 'pending' && (!requireReview || reviewSource === 'presence')) {
    // A central é opcional: a governança continua fail-closed se ela não
    // estiver instalada ou temporariamente indisponível.
    try {
      await eventDispatcher('notifications:publish', {
        id: `governance:${decision.id}`,
        source: 'governance',
        kind: 'action_required',
        title: 'Aprovação necessária',
        message: decision.reason || `A ação ${decision.tool} aguarda sua aprovação.`,
        priority: 5,
        action: { kind: 'governance', sessionId: decision.sessionId, decisionId: decision.id },
      })
    } catch { /* a decisão durável nunca depende da central */ }
    // O Hermes materializa esta mesma decisão como uma notificação Android.
    // O corpo abre o card da sessão; os botões respondem sem abrir o app.
    try {
      await eventDispatcher('device:notify', {
        id: `governance:${decision.id}`,
        title: 'Approval required',
        message: decision.reason || `The action ${decision.tool} requires approval.`,
        click: approvalDeepLink(decision.sessionId),
        discreteId: `governance:${decision.id}`,
        interaction: 'confirm',
        priority: 5,
        context: { kind: 'governance', sessionId: decision.sessionId, decisionId: decision.id },
      })
    } catch { /* a decisão continua disponível no card mesmo sem Hermes */ }
  }
  return {
    allowed: decision.status === 'allowed',
    classification: decision.classification,
    reason: decision.reason,
    decisionId: decision.id,
    mode: policy.mode,
    preset: policy.preset,
    autoApproved: gated.autoApproved,
    riskLevel: gated.riskLevel,
    policySource: gated.policySource,
    command,
    structuredInput: decision.classification === 'needs_confirmation' ? structuredInput(decision, command) : undefined
  }
}

/** Consome uma aprovação uma única vez e valida que ela libera a mesma ação. */
export async function consumeApproval({ sessionId, decisionId, tool, input = {} } = {}) {
  if (!sessionId || !decisionId) throw new Error('sessionId e decisionId são obrigatórios')
  const decision = store.governanceDecision.findOne({ id: decisionId, sessionId })
  if (!decision) throw new Error('Confirmação não encontrada nesta sessão')
  if (decision.status === 'consumed') throw new Error('Confirmação já foi consumida e não pode ser reutilizada')
  if (decision.status !== 'approved') throw new Error('Confirmação não foi aprovada')
  const classified = classifyAction({ sessionId, tool, input })
  const hash = actionHash({ sessionId, tool: classified.tool, target: classified.target, input: classified.input })
  if (hash !== decision.actionHash) throw new Error('A confirmação não corresponde à ação solicitada')
  decision.status = 'consumed'
  decision.consumedAt = new Date().toISOString()
  await audit(decision)
  return { allowed: true, decisionId: decision.id }
}

/** Reivindica a próxima ação já aprovada para retomada determinística pelo loop. */
export async function claimApprovedAction({ sessionId } = {}) {
  if (!sessionId) return null
  const decision = store.governanceDecision.query({ sessionId, status: 'approved' }, { sort: 'resolvedAt ASC', limit: 1 })[0]
  if (!decision) return null
  const pending = pendingActions.get(decision.id)
  if (!pending) return null // fail-closed depois de restart ou de perda de memória
  await consumeApproval({ sessionId, decisionId: decision.id, tool: pending.tool, input: pending.input })
  pendingActions.delete(decision.id)
  return { decisionId: decision.id, tool: pending.tool, input: pending.input }
}

/** Internal continuation constraints come from the executor, never from tool JSON. */
export function approvedContinuation({ sessionId } = {}) {
  const decision = store.governanceDecision.query({ sessionId, status: 'approved' }, { sort: 'resolvedAt ASC', limit: 1 })[0]
  const value = decision && pendingActions.get(decision.id)?.continuation
  return value ? structuredClone(value) : null
}

/** Indica se há uma aprovação ainda recuperável nesta execução do processo. */
export function hasApprovedAction({ sessionId } = {}) {
  if (!sessionId) return false
  const decision = store.governanceDecision.query({ sessionId, status: 'approved' }, { sort: 'resolvedAt ASC', limit: 1 })[0]
  return !!decision && pendingActions.has(decision.id)
}

export async function resolveConfirmation({ sessionId, decisionId, approved } = {}, { deferResume = false, resolutionSource = 'structured_input' } = {}) {
  if (!sessionId || !decisionId || typeof approved !== 'boolean') throw new Error('sessionId, decisionId e approved são obrigatórios')
  const decision = store.governanceDecision.findOne({ id: decisionId, sessionId })
  if (!decision) throw new Error('Confirmação não encontrada nesta sessão')
  // Retries can happen after the HTTP response was persisted but lost on the
  // way back to the browser. Accept only the exact same resolution as an
  // idempotent acknowledgement. This never resumes or consumes the action a
  // second time; conflicting answers remain rejected.
  if (decision.status !== 'pending') {
    const previousApproved = decision.status === 'approved' || decision.status === 'consumed'
    const previousDenied = decision.status === 'denied'
    if ((approved && previousApproved) || (!approved && previousDenied)) {
      return { id: decision.id, status: decision.status, alreadyResolved: true }
    }
    throw new Error('Confirmação já foi resolvida e não pode ser reutilizada')
  }
  if (pendingActions.get(decision.id)?.reportReview && !deferResume) throw new Error('Revise esta proposta pela Mesa de relatórios da equipe no Andar.');
  if (approved && !pendingActions.has(decision.id)) throw new Error('Proposta expirada após reinício. Solicite uma nova proposta.');
  decision.status = approved ? 'approved' : 'denied'
  decision.resolution = approved ? `approved_by_${resolutionSource}` : `denied_by_${resolutionSource}`
  decision.resolvedAt = new Date().toISOString()
  await audit(decision)
  try {
    await dispatchEvent('notifications:resolve', {
      id: `governance:${decision.id}`,
      resolution: approved ? 'approved' : 'denied',
    })
  } catch { /* resolução da governança não depende da interface */ }
  // A retomada é um sinal interno: não cria mensagem do usuário e não depende
  // de a LLM interpretar uma frase de continuação. A decisão já é durável,
  // portanto falhar ao acordar o worker não a desfaz.
  if (approved && !deferResume) {
    try { await eventDispatcher('governance:approved', { sessionId, decisionId: decision.id }) } catch { /* worker pode estar indisponível */ }
  }
  return { id: decision.id, status: decision.status }
}

/** Resolve somente IDs de notificações emitidas pela própria governança. */
export async function resolveDeviceConfirmation({ id, action } = {}) {
  const notificationId = String(id || '')
  if (!notificationId.startsWith('governance:')) return null
  if (action !== 'confirm' && action !== 'cancel') return null
  const decisionId = notificationId.slice('governance:'.length)
  if (!decisionId) return null
  const decision = store.governanceDecision.findOne({ id: decisionId })
  if (!decision?.sessionId) return null
  return resolveConfirmation(
    { sessionId: decision.sessionId, decisionId, approved: action === 'confirm' },
    { resolutionSource: 'android_notification' },
  )
}

/**
 * Uma decisão pelo id, dentro da sessão dona dela.
 *
 * consumeApproval() recusa tudo que não esteja `approved` com a mesma mensagem,
 * então quem chama de fora não conseguia separar "o humano negou" de "essa
 * aprovação não serve para esta ação". Ler o status resolve isso sem afrouxar
 * nada: o consumo continua sendo o único caminho que libera a execução.
 */
export function getDecision({ sessionId, decisionId } = {}) {
  if (!sessionId || !decisionId) return null
  return store.governanceDecision.findOne({ id: decisionId, sessionId }) ?? null
}

export function listDecisions({ sessionId, limit = 50 } = {}) {
  const filter = sessionId ? { sessionId } : {}
  return store.governanceDecision.query(filter, { sort: 'createdAt DESC', limit: Math.min(Math.max(Number(limit) || 50, 1), 200) })
}

function parseCommand(decision) {
  if (!decision.command) return null
  try { return JSON.parse(decision.command) } catch { return null }
}

/**
 * Lista confirmações ainda pendentes (aguardando Aprovar/Negar), com os campos
 * prontos pra exibição num widget. Sem sessionId, devolve as pendências de
 * todas as sessões — é o que o widget global de confirmações consome.
 */
export function listPending({ sessionId } = {}) {
  const filter = { status: 'pending' }
  if (sessionId) filter.sessionId = sessionId
  const rows = store.governanceDecision.query(filter, { sort: 'createdAt DESC', limit: 200 })
  return rows.map(decision => {
    const command = parseCommand(decision)
    return {
      id: decision.id,
      sessionId: decision.sessionId,
      tool: decision.tool,
      target: decision.target || null,
      reason: decision.reason,
      policySource: decision.policySource || null,
      createdAt: decision.createdAt,
      // O card mostra o comando real e cada parâmetro, não só a pergunta.
      command,
      confirmLabel: 'Aprovar ação',
      cancelLabel: 'Negar ação',
      question: `Confirmar: ${decision.tool}${decision.target ? ` (${decision.target})` : ''}? ${decision.reason}`
    }
  })
}

export function getSessionPolicy({ sessionId } = {}) {
  if (!sessionId) throw new Error('sessionId é obrigatório')
  return { ...getPolicy(sessionId), modes: MODES, presets: PRESET_IDS }
}

export function setSessionPolicy(args = {}) {
  return setPolicy(args)
}

export function listSessionPolicies() {
  return listPolicies()
}

export function safeActionForAudit(action) {
  const { input, ...rest } = action || {}
  return { ...rest, input: redact(input || {}) }
}
