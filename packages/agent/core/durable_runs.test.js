import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DurableRunStore } from './durable_runs.js'

function fixture(now = 1_000) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-durable-runs-'))
  let time = now
  const store = new DurableRunStore({ dir, ownerId: 'worker-a', now: () => time, leaseMs: 100 })
  return { dir, store, advance: ms => { time += ms } }
}

test('persiste execução e checkpoints com escrita válida', () => {
  const { dir, store } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'continue', maxIterations: 8 })
  store.checkpoint(run.id, { phase: 'llm-complete', iteration: 1 })

  const persisted = JSON.parse(readFileSync(join(dir, `${run.id}.json`), 'utf8'))
  assert.equal(persisted.status, 'running')
  assert.equal(persisted.sessionId, 'session-1')
  assert.equal(persisted.checkpoint.phase, 'llm-complete')
  assert.equal(persisted.maxIterations, 8)
})

test('recria o diretório removido antes de uma gravação atômica', () => {
  const { dir, store } = fixture()
  rmSync(dir, { recursive: true })

  const run = store.start({ sessionId: 'session-1', message: 'continue' })

  assert.equal(existsSync(join(dir, `${run.id}.json`)), true)
})

test('só oferece recuperação depois que o lease expira', () => {
  const { store, advance } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'continue' })
  assert.deepEqual(store.listRecoverable(), [])

  advance(101)
  assert.deepEqual(store.listRecoverable().map(item => item.id), [run.id])
})

test('um boot novo recupera imediatamente sem aguardar a lease anterior', () => {
  const { dir, store } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'continue' })
  const restarted = new DurableRunStore({ dir, ownerId: 'worker-b', bootId: 'boot-b', now: () => 1_000, leaseMs: 100 })

  assert.deepEqual(restarted.listRecoverable().map(item => item.id), [run.id])
  assert.equal(restarted.claim(run.id)?.status, 'recovering')
})

test('claim impede dois workers de recuperar a mesma execução', () => {
  const { dir, store, advance } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'continue' })
  advance(101)

  const workerB = new DurableRunStore({ dir, ownerId: 'worker-b', bootId: store.bootId, now: () => 1_101, leaseMs: 100 })
  assert.equal(workerB.claim(run.id)?.status, 'recovering')
  assert.equal(store.claim(run.id), null)
})

test('respeita backoff e limita as tentativas de recuperação', () => {
  const { dir, store, advance } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'continue' })
  const restarted = new DurableRunStore({ dir, ownerId: 'worker-b', bootId: 'boot-b', now: () => 1_000, leaseMs: 100, maxRecoveryAttempts: 2 })
  restarted.claim(run.id)
  restarted.scheduleRetry(run.id, 'provider unavailable', 50)
  assert.deepEqual(restarted.listRecoverable(), [])

  advance(50)
  const later = new DurableRunStore({ dir, ownerId: 'worker-c', bootId: 'boot-c', now: () => 1_050, leaseMs: 100, maxRecoveryAttempts: 2 })
  assert.ok(later.claim(run.id))
  later.scheduleRetry(run.id, 'provider unavailable', 0)
  assert.deepEqual(later.listRecoverable(), [])
})

test('tool interrompida permanece desconhecida e nunca vira concluída', () => {
  const { store } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'continue' })
  store.toolStarted(run.id, { id: 'call-1', name: 'send_email', input: { to: 'a@b.test' } }, 2)

  const saved = store.get(run.id)
  assert.equal(saved.inFlightTool.status, 'unknown')
  assert.equal(saved.inFlightTool.name, 'send_email')
  assert.equal(saved.inFlightTool.recoveryPolicy, 'reconcile')
  assert.ok(saved.inFlightTool.operationId)

  store.toolCompleted(run.id, 'call-1', { ok: true })
  assert.equal(store.get(run.id).inFlightTool, null)
})

test('execuções concluídas não são recuperáveis', () => {
  const { store, advance } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'continue' })
  store.complete(run.id, 'feito')
  advance(1_000)
  assert.deepEqual(store.listRecoverable(), [])
})

test('retenção é dry-run por padrão e compacta apenas quando aplicada', () => {
  const { store, advance } = fixture()
  const run = store.start({ sessionId: 'session-1', message: 'conteúdo sensível e longo' })
  store.complete(run.id, 'resultado longo')
  advance(10_000)

  const plan = store.maintain({ compactAfterMs: 1, maxAgeMs: 100_000 })
  assert.equal(plan.dryRun, true)
  assert.deepEqual(plan.compact, [run.id])
  assert.equal(store.get(run.id).message, 'conteúdo sensível e longo')

  store.maintain({ compactAfterMs: 1, maxAgeMs: 100_000, dryRun: false })
  const compacted = store.get(run.id)
  assert.equal(compacted.compacted, true)
  assert.equal('message' in compacted, false)
  assert.equal('result' in compacted, false)
})

test('runs além da idade/quantidade entram no plano sem remoção automática', () => {
  const { store, advance } = fixture()
  const first = store.start({ sessionId: 's', message: '1' }); store.complete(first.id)
  advance(10)
  const second = store.start({ sessionId: 's', message: '2' }); store.complete(second.id)
  advance(10)

  const plan = store.maintain({ maxCompleted: 1, maxAgeMs: 15 })
  assert.ok(plan.remove.includes(first.id))
  assert.ok(store.get(first.id), 'dry-run preserva o journal')
})

test('tentativas de recovery esgotadas são colocadas em quarentena lógica', () => {
  const { dir, store } = fixture()
  const run = store.start({ sessionId: 's', message: 'x' })
  const restarted = new DurableRunStore({ dir, ownerId: 'b', bootId: 'b', now: () => 1_000, maxRecoveryAttempts: 1 })
  restarted.claim(run.id)
  restarted.scheduleRetry(run.id, 'boom', 0)
  const saved = restarted.get(run.id)
  assert.equal(saved.status, 'quarantined')
  assert.equal(saved.failureReason, 'recovery-attempt-limit')
  assert.deepEqual(restarted.listRecoverable(), [])
})
