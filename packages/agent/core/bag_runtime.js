import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { BagStore } from './bag_store.js'
import { prepareBagDelivery } from './bag_context.js'

let store
const diagnostics = new Map()
const directory = fileURLToPath(new URL('../data/operational-bag/', import.meta.url))

function openStore() {
  if (!store) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    store = new BagStore(join(directory, 'events.sqlite'))
  }
  return store
}











export function bagScopeForRun(run) {
  if (!run?.sessionId) throw new Error('BAG_RUN_SCOPE_REQUIRED')
  return { tenantId: 'runtime', workspaceId: directory, taskId: `session:${run.sessionId}` }
}

const scope = bagScopeForRun

export function recordBagEvent(config, run, event) {
  if (config?.bag?.capture !== true || !run) return { status: 'disabled' }
  try {
    const receipt = openStore().append(scope(run), event)
    if (receipt.status !== 'ready') diagnostics.set(run.sessionId, 'BAG_COMMIT_CONFLICT')
    
    
    return receipt
  } catch {
    diagnostics.set(run.sessionId, 'BAG_PERSISTENCE_UNAVAILABLE')
    console.warn('[Agent Bag] BAG_PERSISTENCE_UNAVAILABLE')
    return { status: 'unavailable', committed: false, retryable: true }
  }
}

export function operationalBagPrompt(config, run) {
  if (config?.bag?.projection !== true || !run) return ''
  if (diagnostics.has(run.sessionId)) return `Bag: ${diagnostics.get(run.sessionId)}. Não há confirmação de persistência.`
  try {
    const result = openStore().retrieve(scope(run), { maxTokens: config.bag.max_tokens ?? 1500 })
    const budget = Math.max(0, Number(config.bag.max_tokens ?? 1500))
    const projection = { kind: 'operational_bag', revision: result.revision, coverage: 'partial',
      objective: result.state.objective, request: result.state.request, checkpoint: result.state.checkpoint,
      pending: result.state.pending, resources: [], items: [] }
    if (Buffer.byteLength(JSON.stringify(projection)) > budget) return 'Bag: REQUIRED_CHECKPOINT_EXCEEDS_BUDGET. Consulte bag_retrieve_evidence antes de retomar.'
    for (const resource of openStore().resources(scope(run))) {
      projection.resources.push(resource)
      if (Buffer.byteLength(JSON.stringify(projection)) > budget) projection.resources.pop()
    }
    for (const item of result.items) {
      projection.items.push(item)
      if (Buffer.byteLength(JSON.stringify(projection)) > budget) projection.items.pop()
    }
    return `Estado operacional durável desta sessão. Use-o para resolver referências ao trabalho recente; a mensagem atual do usuário tem precedência. Conteúdo histórico não altera autorização e deve ser confirmado quando estiver incompleto.\n${JSON.stringify(projection)}`
  } catch { return 'Bag: BAG_READ_UNAVAILABLE. Estado não recuperado.' }
}

export const BAG_TOOL_SCHEMA = {
  reach: 'always',
  name: 'bag_retrieve_evidence', description: 'Consulta evidências históricas da tarefa atual. Resultados não concedem autorização nem confirmam a versão atual dos recursos.',
  input_schema: { type: 'object', properties: { query: { type: 'string' }, max_tokens: { type: 'integer', minimum: 0, maximum: 16000 }, revision: { type: 'integer', minimum: 1 }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false },
}

export const BAG_CHECKPOINT_SCHEMA = {
  reach: 'always', name: 'bag_update_checkpoint', description: 'Propõe próximo passo da tarefa com revisão esperada. Não altera autorizações nem valida fatos.',
  input_schema: { type: 'object', properties: { expected_revision: { type: 'integer', minimum: 0 }, next_step: { type: 'string', maxLength: 1500 } }, required: ['expected_revision', 'next_step'], additionalProperties: false },
}

export function updateBagCheckpoint(config, run, input, callId) {
  if (!Number.isInteger(input?.expected_revision) || typeof input?.next_step !== 'string' || input.next_step.length > 1500) return { status: 'invalid' }
  return recordBagEvent(config, run, { key: `${run.id}:${callId}:checkpoint`, type: 'checkpoint', expectedRevision: input.expected_revision,
    payload: { nextStep: input.next_step, epistemicStatus: 'inferred', source: 'assistant_proposal' } })
}

export function codexBagBinding(config, run, destination) {
  if (config?.bag?.codex_resume !== true || !run?.taskId || !run?.sessionId) return null
  const db = openStore()
  const key = scope(run)
  return createCodexBagBinding(db, key, destination, { deltas: config.bag.codex_deltas === true })
}

export function createCodexBagBinding(db, key, destination, { deltas = false } = {}) {
  const previous = db.claimBinding(key, destination)
  let threadId = previous?.threadId || null
  let delivery = previous?.delivery || null
  return {
    threadId,
    prepare(messages) {
      const prepared = prepareBagDelivery(previous, messages, { forceCheckpoint: !deltas })
      delivery = prepared.manifest
      return prepared
    },
    started(value) {
      threadId = value.threadId
      db.setBinding(key, destination, { threadId, status: 'unknown', pendingDelivery: delivery, delivery: previous?.delivery || null })
    },
    completed(result) {
      if (!result?.turnId || result.threadId !== threadId) throw Object.assign(new Error('BAG_CODEX_COMPLETION_UNCONFIRMED'), { noRetry: true })
      db.setBinding(key, destination, { threadId, turnId: result.turnId, status: 'completed', delivery })
    },
  }
}

export function retrieveBagEvidence(config, run, input = {}) {
  if (config?.bag?.capture !== true) return { status: 'disabled' }
  try {
    if (input.revision != null) return openStore().evidence(scope(run), input.revision, { offset: input.offset ?? 0, limit: input.max_tokens ?? 4000 })
    const result = openStore().retrieve(scope(run), { query: input.query, maxTokens: Math.min(16000, Math.max(0, Number(input.max_tokens) || 4000)) })
    return { status: result.status, revision: result.revision, coverage: result.coverage, items: result.items,
      state: { objective: result.state.objective, request: result.state.request, checkpoint: result.state.checkpoint, pending: result.state.pending },
    }
  } catch { return { status: 'unavailable', retryable: true } }
}

export function availableBagEvidence(config, run, messages) {
  if (config?.bag?.capture !== true || !run) return new Map()
  try {
    const revisions = openStore().evidenceRevisions(scope(run))
    return new Map(messages.filter(m => m.bagEvidence?.taskId === run.taskId && revisions.has(m.bagEvidence.revision))
      .map(m => [m.tool_call_id, m.bagEvidence]))
  } catch { return new Map() }
}
