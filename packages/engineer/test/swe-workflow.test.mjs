import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SWE_RESULT_PROTOCOL,
  captureWorkspaceBaseline,
  compareSweTargets,
  createArtifactStore,
  createSweResult,
  inspectWorktree,
  prepareWorktree,
  redactSweEvidence,
  runSweWorkflow,
  resolveValidationCommands,
  validateSweResult,
} from '../lib/swe-workflow.js'
import { loadSweCorpus, materializeSweFixture, runSweCorpus } from '../lib/swe-corpus.js'
import { listDir, readFile, runShell, searchCode } from '../index.js'

test('resultado SWE exige revisão e validação observável quando há mudanças', () => {
  const incomplete = createSweResult({
    taskId: 'task-1', objective: 'corrigir', status: 'completed', baselineRef: 'baseline:1', traceRef: 'trace:1', changes: [{ path: 'index.js' }],
  })
  assert.equal(incomplete.protocol, SWE_RESULT_PROTOCOL)
  assert.equal(validateSweResult(incomplete).valid, false)

  const complete = {
    ...incomplete,
    diff: { artifactRef: 'diff:1', reviewed: true },
    validations: [{ kind: 'test', status: 'passed', exitCode: 0 }],
  }
  assert.deepEqual(validateSweResult(complete), { valid: true, errors: [] })
})

test('exit code não zero nunca valida como passed', () => {
  const result = createSweResult({ taskId: 'task-2', objective: 'validar', status: 'partial', baselineRef: 'baseline:2', traceRef: 'trace:2' })
  result.validations = [{ kind: 'test', status: 'passed', exitCode: 1 }]
  assert.match(validateSweResult(result).errors.join(' '), /exitCode/)
})

test('resolvedor respeita manifesto thinkiac e faz fallback para scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swe-validation-'))
  try {
    const declared = join(root, 'declared')
    const fallback = join(root, 'fallback')
    await mkdir(declared)
    await mkdir(fallback)
    await writeFile(join(declared, 'package.json'), JSON.stringify({ name: 'declared', thinkiac: { validation: { test: ['node --test'], timeoutMs: 1234 } } }))
    await writeFile(join(fallback, 'package.json'), JSON.stringify({ name: 'fallback', scripts: { test: 'node --test', lint: 'eslint .' } }))
    assert.deepEqual(resolveValidationCommands(root, declared).commands, [{ kind: 'test', command: 'node --test', source: 'thinkiac.validation' }])
    assert.deepEqual(resolveValidationCommands(root, fallback).commands.map(({ kind, command }) => ({ kind, command })), [
      { kind: 'test', command: 'npm run test' }, { kind: 'lint', command: 'npm run lint' },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('baseline degrada com diagnóstico fora de Git', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swe-baseline-'))
  try {
    const baseline = await captureWorkspaceBaseline(root)
    assert.equal(baseline.vcs.kind, 'none')
    assert.match(baseline.diagnostic, /Git indisponível/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('tools de observação paginam sem remover campos legados', async () => {
  const file = new URL('../package.json', import.meta.url).pathname
  const read = await readFile({ path: file, start_line: 1, max_lines: 1 })
  assert.equal(read.success, true)
  assert.equal(read.coverage.returned, 1)
  assert.equal(read.truncated, true)
  assert.equal(typeof read.content, 'string')

  const listed = await listDir({ path: new URL('..', import.meta.url).pathname, depth: 1, limit: 1 })
  assert.equal(listed.entries.length, 1)
  assert.equal(listed.coverage.returned, 1)

  const searched = await searchCode({ query: 'engineer', path: new URL('..', import.meta.url).pathname, file_pattern: '*.json', max_results: 1 })
  assert.ok(searched.matches.length <= 1)
  assert.equal(typeof searched.count, 'number')
})

test('run_shell normaliza sucesso, falha e timeout', async () => {
  const passed = await runShell({ command: 'node -e "process.stdout.write(\'ok\')"' })
  assert.equal(passed.status, 'passed')
  assert.equal(passed.exitCode, 0)
  assert.equal(passed.truncated, false)

  const failed = await runShell({ command: 'node -e "process.exit(7)"' })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.exitCode, 7)

  const timeout = await runShell({ command: 'node -e "setTimeout(() => {}, 5000)"', timeout: 1000 })
  assert.equal(timeout.status, 'timed_out')
  assert.equal(timeout.timedOut, true)
})

test('artefatos extensos são endereçados por conteúdo e redigidos', async () => {
  const root = await mkdtemp(join(tmpdir(), 'swe-artifacts-'))
  try {
    const store = createArtifactStore(root, { maxInlineBytes: 4 })
    const saved = await store.put('trace', 'token=super-secret-value')
    assert.equal(saved.truncated, true)
    assert.match((await store.get(saved.id)).content, /\[REDACTED\]/)
    assert.doesNotMatch(redactSweEvidence('Authorization: Bearer abc'), /abc/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('worktree é opt-in, isolado e permanece retido para inspeção', async () => {
  const source = await mkdtemp(join(tmpdir(), 'swe-source-'))
  let isolated
  const runGit = (...args) => new Promise((resolvePromise, reject) => execFile('git', ['-C', source, ...args], (error, stdout) => error ? reject(error) : resolvePromise(stdout)))
  try {
    await runGit('init')
    await runGit('config', 'user.email', 'test@example.invalid')
    await runGit('config', 'user.name', 'Test')
    await writeFile(join(source, 'index.js'), 'export const value = 1\n')
    await runGit('add', 'index.js')
    await runGit('commit', '-m', 'fixture')
    isolated = await prepareWorktree(source, { taskId: 'case-1' })
    assert.equal(isolated.success, true)
    await writeFile(join(isolated.root, 'index.js'), 'export const value = 2\n')
    const inspection = await inspectWorktree(isolated)
    assert.equal(inspection.dirty, true)
    assert.match(inspection.diff, /value = 2/)
    assert.equal(inspection.retained, true)
  } finally {
    if (isolated?.root) {
      await runGit('worktree', 'remove', '--force', isolated.root).catch(() => {})
      await rm(isolated.root, { recursive: true, force: true })
    }
    await rm(source, { recursive: true, force: true })
  }
})

test('corpus versionado tem dez casos e produz manifesto inclusive em falha', async () => {
  const corpus = await loadSweCorpus(new URL('../benchmark/swe-corpus.v1.json', import.meta.url))
  assert.equal(corpus.cases.length, 10)
  const run = await runSweCorpus({
    corpus, target: 'fixture@local',
    executeCase: async (caseDefinition) => createSweResult({ taskId: caseDefinition.id, objective: caseDefinition.issue, status: 'failed', baselineRef: 'baseline:1', traceRef: 'trace:1' }),
  })
  assert.equal(run.total, 10)
  assert.ok(run.cases.every((item) => item.contract.valid))
})

test('todas as fixtures do corpus são materializáveis e versionadas', async () => {
  const corpus = await loadSweCorpus(new URL('../benchmark/swe-corpus.v1.json', import.meta.url))
  const parent = await mkdtemp(join(tmpdir(), 'swe-fixtures-'))
  try {
    const fixtures = []
    for (const caseDefinition of corpus.cases) fixtures.push(await materializeSweFixture(caseDefinition, join(parent, caseDefinition.id)))
    assert.equal(fixtures.length, 10)
    assert.ok(fixtures.every((fixture) => /^[a-f0-9]{40}$/.test(fixture.revision)))
    assert.equal(fixtures.find((fixture) => fixture.dirty)?.dirty, true)
  } finally { await rm(parent, { recursive: true, force: true }) }
})

test('comparação só é comparável com os mesmos casos em dois targets', () => {
  const score = { issueResolution: true, durationMs: 10 }
  const comparison = compareSweTargets([
    { target: 'a@x', caseId: 'one', score },
    { target: 'b@y', caseId: 'one', score },
  ])
  assert.equal(comparison.comparable, true)
  assert.equal(comparison.targets[0].resolutionRate, 1)
})

test('orquestração persiste evidências e rebaixa conclusão sem validação', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'swe-run-'))
  const artifacts = await mkdtemp(join(tmpdir(), 'swe-run-artifacts-'))
  try {
    const execution = await runSweWorkflow({
      taskId: 'run-case', objective: 'alterar', workspace, artifactRoot: artifacts,
      execute: async () => ({ status: 'completed', changes: [{ path: 'index.js' }], diff: { content: 'diff', reviewed: true }, trace: [{ type: 'final' }] }),
    })
    assert.equal(execution.result.status, 'partial')
    assert.equal(execution.contract.valid, true)
    assert.match(execution.result.baselineRef, /^sha256:/)
    assert.match(execution.result.traceRef, /^sha256:/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(artifacts, { recursive: true, force: true })
  }
})
