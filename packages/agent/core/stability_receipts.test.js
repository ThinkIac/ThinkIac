import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import inflectPkg from 'inflect'
import { createStabilityReceipts } from './stability_receipts.js'

const { renderTemplate } = inflectPkg
const agentDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function subject() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-stability-receipts-'))
  let time = 1_000
  return {
    receipts: createStabilityReceipts({ file: join(dir, 'receipts.json'), now: () => time }),
    tick: ms => { time += ms },
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const evidence = { sessionId: 's-1', runId: 'r-1', taskId: 't-1', pkg: 'shell', candidateId: 'c-1', candidateHash: 'hash-1' }

test('escrita confirmada persiste após retomada sem comprovar ativação', () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-evidence-'))
  const file = join(dir, 'receipts.json')
  try {
    const first = createStabilityReceipts({ file })
    const change = { ...evidence, operationId: 'op-1', path: '/shell/index.js', hash: 'file-hash' }
    first.recordLocalChange(change)
    first.recordLocalChange(change)
    const resumed = createStabilityReceipts({ file })
    assert.equal(resumed.localChanges({ taskId: 't-1' }).length, 1)
    assert.equal(resumed.localChanges({ runId: 'other' }).length, 0)
    assert.equal(resumed.deliveries().length, 1)
    assert.equal(resumed.deliveries()[0].activation, 'unknown')
    assert.equal(resumed.promptFor('s-1', { runId: 'r-1' }), '')
    assert.throws(() => resumed.recordLocalChange({ path: '/file', hash: 'hash' }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('evento atrasado não regride a projeção do candidato', () => {
  const it = subject()
  try {
    it.receipts.recordRolledBack({ ...evidence, producedAt: 200, restaged: false })
    it.receipts.recordStable({ ...evidence, producedAt: 100, activated: true })
    assert.equal(it.receipts.deliveries()[0].runtimeValidation, 'rolled_back')
    assert.equal(it.receipts.deliveries()[0].activation, 'unknown')
    assert.doesNotMatch(it.receipts.promptFor('s-1', { runId: 'r-1' }), /ACEITA E ATIVADA/)
  } finally { it.close() }
})

test('hash divergente para o mesmo candidato não comprova aceite', () => {
  const it = subject()
  try {
    it.receipts.recordRejected(evidence)
    it.receipts.recordStable({ ...evidence, candidateHash: 'different', activated: true })
    assert.equal(it.receipts.deliveries({ candidateHash: 'different' })[0].activation, 'unknown')
    assert.equal(it.receipts.deliveries({ candidateHash: 'different' })[0].runtimeValidation, 'identity_conflict')
    assert.match(it.receipts.promptFor('s-1', { runId: 'r-1' }), /IDENTIDADE DIVERGENTE/)
  } finally { it.close() }
})

test('recibos exigem vínculo explícito e não atravessam execuções', () => {
  const it = subject()
  try {
    it.receipts.recordRejected({ ...evidence, error: 'SSR failed' })
    assert.match(it.receipts.promptFor('s-1', { runId: 'r-1' }), /REJEITADA/)
    assert.equal(it.receipts.promptFor('s-1', { runId: 'r-2' }), '')
    assert.equal(it.receipts.promptFor('s-2', { runId: 'r-1' }), '')
    assert.equal(it.receipts.promptFor('s-1'), '')
  } finally { it.close() }
})

test('evento legado permanece consultável sem instrução global de reparo', () => {
  const it = subject()
  try {
    it.receipts.markPotentialMutation({ sessionId: 's-1', tool: 'run_shell', input: { command: 'patch shell' } })
    it.receipts.recordRejected({ pkg: 'shell', error: 'SSR failed' })
    assert.equal(it.receipts.list().length, 1)
    assert.equal(it.receipts.promptFor('s-1', { runId: 'r-1' }), '')
  } finally { it.close() }
})

test('ativação exige candidato identificado e confirmação do produtor', () => {
  const it = subject()
  try {
    it.receipts.recordStable({ ...evidence, activated: true })
    assert.match(it.receipts.promptFor('s-1', { runId: 'r-1' }), /ACEITA E ATIVADA/)
    it.receipts.recordStable({ ...evidence, candidateId: 'c-2', candidateHash: null, activated: true })
    assert.equal(it.receipts.deliveries()[1].activation, 'unknown')
  } finally { it.close() }
})

test('eventos duplicados são idempotentes e expiração preserva histórico', () => {
  const it = subject()
  try {
    it.receipts.recordRejected(evidence)
    it.receipts.recordRejected(evidence)
    assert.equal(it.receipts.list().length, 1)
    it.tick(25 * 60 * 60_000)
    assert.equal(it.receipts.promptFor('s-1', { runId: 'r-1' }), '')
    assert.equal(it.receipts.list().length, 1)
  } finally { it.close() }
})

test('filtros de sessão e execução devem corresponder ao mesmo autor', () => {
  const it = subject()
  try {
    it.receipts.recordRejected({ pkg: 'shell', authors: [
      { sessionId: 's-1', runId: 'r-1' }, { sessionId: 's-2', runId: 'r-2' },
    ] })
    assert.equal(it.receipts.list({ sessionId: 's-1', runId: 'r-2' }).length, 0)
  } finally { it.close() }
})

test('rollback sem restaging nunca comprova restauração saudável', () => {
  const it = subject()
  try {
    it.receipts.recordRolledBack({ ...evidence, restaged: false })
    assert.equal(it.receipts.deliveries()[0].activation, 'unknown')
    assert.match(it.receipts.promptFor('s-1', { runId: 'r-1' }), /não comprovada/)
  } finally { it.close() }
})

test('template principal inclui o recibo antes de a Agent decidir', () => {
  const template = readFileSync(join(agentDir, 'prompts', 'system.inflect'), 'utf8')
  const prompt = renderTemplate(template, {
    refinedContext: '', bagSection: '', contextsSection: '', personality: '', runtimeCatalog: '', snapshot: '', skillsBlock: '', proactiveCtx: '', resetNote: '',
    stabilityReceipt: 'RECIBO-TESTE', osContextSection: '', experienceSection: '', promptBlocks: '', sessionSection: '', localTime: '', provider: '', model: '', language: 'pt-BR', style: 'direto', prefs: '', hasAttachments: false,
  }, join(agentDir, 'prompts'))
  assert.match(prompt, /RECIBO-TESTE/)
})

test('hash divergente nunca herda aceite de outro conteúdo', () => {
  const it = subject()
  try {
    it.receipts.recordStable({ ...evidence, activated: true })
    it.receipts.recordRejected({ ...evidence, candidateHash: 'hash-2' })
    assert.equal(it.receipts.deliveries().length, 2)
    assert.equal(it.receipts.deliveries({ candidateHash: 'hash-2' })[0].activation, 'unknown')
  } finally { it.close() }
})

test('nova escrita preserva testes antigos sem aplicá-los ao arquivo novo', () => {
  const it = subject()
  try {
    it.receipts.recordLocalChange({ ...evidence, path: '/shell/index.js', hash: 'old', checks: [{ name: 'syntax', ok: true }] })
    it.tick(1)
    it.receipts.recordLocalChange({ ...evidence, path: '/shell/index.js', hash: 'new' })
    const rows = it.receipts.deliveries({ taskId: 't-1', pkg: 'shell' })
    assert.equal(rows[0].localValidation, 'passed')
    assert.equal(rows[0].applicable, false)
    assert.equal(rows[1].localValidation, 'unknown')
    assert.equal(rows[1].applicable, true)
    assert.equal(it.receipts.deliveries({ sessionId: 'other' }).length, 0)
  } finally { it.close() }
})
