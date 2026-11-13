import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const SWE_RESULT_PROTOCOL = 'thinkiac.swe-result/v1'
export const SWE_WORKFLOW_PROTOCOL = 'thinkiac.swe-workflow/v1'
export const SWE_ARTIFACT_PROTOCOL = 'thinkiac.swe-artifact/v1'
export const SWE_BENCHMARK_PROTOCOL = 'thinkiac.swe-benchmark/v1'
export const SWE_RESULT_SCHEMA = Object.freeze({
  type: 'object',
  required: ['protocol', 'taskId', 'status', 'objective', 'baselineRef', 'reproduction', 'changes', 'validations', 'diff', 'remainingRisks', 'traceRef', 'startedAt', 'finishedAt'],
  properties: {
    protocol: { const: SWE_RESULT_PROTOCOL }, taskId: { type: 'string' }, objective: { type: 'string' },
    status: { type: 'string', enum: ['completed', 'partial', 'failed', 'blocked', 'cancelled'] },
    baselineRef: { type: 'string' }, reproduction: { type: 'object' }, changes: { type: 'array', items: { type: 'object' } },
    validations: { type: 'array', items: { type: 'object' } }, diff: { type: 'object' }, remainingRisks: { type: 'array' },
    traceRef: { type: 'string' }, startedAt: { type: 'string' }, finishedAt: { type: 'string' },
  },
})

export function createSweWorkflowProfile(overrides = {}) {
  return {
    protocol: SWE_WORKFLOW_PROTOCOL,
    enabled: overrides.enabled ?? false,
    phase: overrides.phase ?? 'framed',
    validationPolicy: overrides.validationPolicy ?? 'affected',
    allowedTools: overrides.allowedTools ?? ['read_file', 'list_dir', 'search_code', 'diff_preview', 'patch_file', 'patch_file_multi', 'run_shell', 'workspace_baseline', 'resolve_validation'],
    budget: { maxSteps: 40, maxDurationMs: 1_200_000, maxCommandMs: 300_000, maxChangedFiles: 20, ...overrides.budget },
    artifactThresholdBytes: overrides.artifactThresholdBytes ?? 16_384,
    ...overrides,
  }
}

export async function runSweWorkflow({ taskId = randomUUID(), objective, workspace, artifactRoot, isolation = 'in_place', execute }) {
  if (typeof execute !== 'function') throw new TypeError('execute é obrigatório')
  const startedAt = new Date().toISOString()
  const baseline = await captureWorkspaceBaseline(workspace)
  const store = createArtifactStore(artifactRoot)
  const baselineArtifact = await store.put('baseline', baseline, { taskId })
  let isolated = null
  let executionRoot = resolve(workspace)
  if (isolation === 'worktree') {
    isolated = await prepareWorktree(workspace, { taskId })
    if (isolated.success) executionRoot = isolated.root
  }
  let payload
  try {
    payload = await execute({ taskId, objective, root: executionRoot, baseline, isolated, store })
  } catch (error) {
    payload = { status: 'failed', remainingRisks: [error.message], trace: [{ type: 'execution_error', error: error.message }] }
  }
  const traceArtifact = await store.put('trace', payload.trace ?? [], { taskId })
  const diffValue = payload.diff?.content ?? payload.diff ?? ''
  const diffArtifact = await store.put('diff', diffValue, { taskId })
  const result = createSweResult({
    taskId, objective, status: payload.status ?? 'partial', baselineRef: baselineArtifact.id,
    reproduction: payload.reproduction, changes: payload.changes, validations: payload.validations,
    diff: { artifactRef: diffArtifact.id, reviewed: payload.diff?.reviewed === true },
    remainingRisks: payload.remainingRisks, traceRef: traceArtifact.id, startedAt, finishedAt: new Date().toISOString(),
  })
  const contract = validateSweResult(result)
  if (!contract.valid && result.status === 'completed') result.status = 'partial'
  return { result, contract: validateSweResult(result), baseline, isolated, artifacts: { baseline: baselineArtifact, trace: traceArtifact, diff: diffArtifact } }
}

const SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi,
  /((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
]

export function redactSweEvidence(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '$1[REDACTED]')
  return text
}

export function createArtifactStore(root, { maxInlineBytes = 16_384 } = {}) {
  const artifactRoot = resolve(root)
  return Object.freeze({
    root: artifactRoot,
    async put(kind, value, metadata = {}) {
      const content = redactSweEvidence(value)
      const digest = sha256(content)
      const id = `sha256:${digest}`
      await mkdir(artifactRoot, { recursive: true })
      await writeFile(join(artifactRoot, `${digest}.data`), content, { flag: 'wx' }).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
      const envelope = { protocol: SWE_ARTIFACT_PROTOCOL, id, kind, bytes: Buffer.byteLength(content), digest: id, createdAt: new Date().toISOString(), metadata }
      await writeFile(join(artifactRoot, `${digest}.json`), `${JSON.stringify(envelope, null, 2)}\n`)
      return { ...envelope, inline: envelope.bytes <= maxInlineBytes ? content : undefined, truncated: envelope.bytes > maxInlineBytes }
    },
    async get(id) {
      const digest = String(id).replace(/^sha256:/, '')
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('artifactRef inválida')
      const [metadata, content] = await Promise.all([
        readFile(join(artifactRoot, `${digest}.json`), 'utf8'),
        readFile(join(artifactRoot, `${digest}.data`), 'utf8'),
      ])
      return { ...JSON.parse(metadata), content }
    },
  })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function inside(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

async function git(root, args) {
  return execFileAsync('git', ['-C', root, ...args], { timeout: 10_000, maxBuffer: 1024 * 1024 })
}

export async function captureWorkspaceBaseline(root) {
  const workspaceRoot = resolve(root)
  const capturedAt = new Date().toISOString()
  try {
    const [{ stdout: top }, { stdout: head }, { stdout: status }] = await Promise.all([
      git(workspaceRoot, ['rev-parse', '--show-toplevel']),
      git(workspaceRoot, ['rev-parse', 'HEAD']),
      git(workspaceRoot, ['status', '--porcelain=v1', '-z']),
    ])
    const gitRoot = top.trim()
    const rawRecords = status.split('\0').filter(Boolean)
    const records = []
    for (let index = 0; index < rawRecords.length; index++) {
      const record = rawRecords[index]
      const statusCode = record.slice(0, 2)
      const renamed = statusCode.includes('R') || statusCode.includes('C')
      const rawPath = renamed ? rawRecords[++index] : record.slice(3)
      records.push({ statusCode, rawPath })
    }
    const preexistingChanges = records.map(({ statusCode, rawPath }) => {
      const absolute = resolve(gitRoot, rawPath)
      let fingerprint = null
      if (inside(gitRoot, absolute) && existsSync(absolute)) {
        try { fingerprint = sha256(readFileSync(absolute)) } catch {}
      }
      return { path: relative(workspaceRoot, absolute) || rawPath, status: statusCode, fingerprint }
    })
    return {
      protocol: 'thinkiac.swe-baseline/v1',
      workspace: { root: workspaceRoot, isolation: 'in_place' },
      vcs: { kind: 'git', root: gitRoot, head: head.trim(), dirty: records.length > 0 },
      preexistingChanges,
      capturedAt,
      baselineRef: `sha256:${sha256(JSON.stringify({ head: head.trim(), records }))}`,
    }
  } catch (error) {
    return {
      protocol: 'thinkiac.swe-baseline/v1',
      workspace: { root: workspaceRoot, isolation: 'in_place' },
      vcs: { kind: 'none', dirty: null },
      preexistingChanges: [],
      capturedAt,
      diagnostic: `Git indisponível para o workspace: ${error.message}`,
      baselineRef: `sha256:${sha256(`${workspaceRoot}:${capturedAt}`)}`,
    }
  }
}

export async function prepareWorktree(root, { taskId = randomUUID(), revision = 'HEAD', destination } = {}) {
  const workspaceRoot = resolve(root)
  const baseline = await captureWorkspaceBaseline(workspaceRoot)
  if (baseline.vcs.kind !== 'git') return { success: false, strategy: 'in_place', baseline, diagnostic: baseline.diagnostic }
  const target = destination ? resolve(destination) : await mkdtemp(join(tmpdir(), `thinkiac-swe-${taskId.replace(/[^a-zA-Z0-9_-]/g, '_')}-`))
  if (inside(baseline.vcs.root, target)) return { success: false, strategy: 'in_place', baseline, diagnostic: 'Worktree deve ficar fora do repositório de origem' }
  try {
    await git(baseline.vcs.root, ['worktree', 'add', '--detach', target, revision])
    return {
      success: true, strategy: 'worktree', taskId, root: target,
      sourceRoot: baseline.vcs.root, revision, baseline, retained: true,
      cleanup: { automatic: false, command: `git -C ${JSON.stringify(baseline.vcs.root)} worktree remove ${JSON.stringify(target)}` },
      diagnostic: baseline.vcs.dirty ? 'Mudanças locais não foram copiadas; o worktree parte da revisão indicada' : null,
    }
  } catch (error) {
    return { success: false, strategy: 'in_place', baseline, root: workspaceRoot, diagnostic: `Falha ao criar worktree: ${error.message}` }
  }
}

export async function inspectWorktree(worktree) {
  if (!worktree?.root || worktree.strategy !== 'worktree') throw new TypeError('worktree inválido')
  const [{ stdout: status }, { stdout: diff }] = await Promise.all([
    git(worktree.root, ['status', '--porcelain=v1']),
    git(worktree.root, ['diff', '--binary', '--no-ext-diff']),
  ])
  return { root: worktree.root, dirty: Boolean(status.trim()), status: status.trim().split('\n').filter(Boolean), diff, retained: true }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

export function findPackageRoot(workspaceRoot, target = workspaceRoot) {
  const root = resolve(workspaceRoot)
  let cursor = resolve(target)
  if (!inside(root, cursor)) return null
  try { if (statSync(cursor).isFile()) cursor = dirname(cursor) } catch {}
  while (inside(root, cursor)) {
    if (existsSync(join(cursor, 'package.json'))) return cursor
    if (cursor === root) break
    cursor = dirname(cursor)
  }
  return existsSync(join(root, 'package.json')) ? root : null
}

export function resolveValidationCommands(workspaceRoot, target = workspaceRoot) {
  const packageRoot = findPackageRoot(workspaceRoot, target)
  if (!packageRoot) return { packageRoot: null, commands: [], diagnostic: 'Nenhum package.json aplicável encontrado' }
  const manifest = readJson(join(packageRoot, 'package.json')) ?? {}
  const declared = manifest.thinkiac?.validation
  const commands = []
  if (declared && typeof declared === 'object') {
    for (const kind of ['syntax', 'test', 'lint', 'typecheck']) {
      for (const command of Array.isArray(declared[kind]) ? declared[kind] : []) {
        commands.push({ kind, command, source: 'thinkiac.validation' })
      }
    }
  } else {
    const scripts = manifest.scripts ?? {}
    for (const kind of ['test', 'lint', 'typecheck']) {
      if (typeof scripts[kind] === 'string') commands.push({ kind, command: `npm run ${kind}`, source: `scripts.${kind}` })
    }
  }
  return {
    package: manifest.name ?? null,
    packageRoot,
    relativePackageRoot: relative(resolve(workspaceRoot), packageRoot) || '.',
    timeoutMs: declared?.timeoutMs ?? 300_000,
    commands,
    diagnostic: commands.length ? null : 'Nenhum comando de validação confiável declarado',
  }
}

export function createSweResult(input = {}) {
  return {
    protocol: SWE_RESULT_PROTOCOL,
    taskId: input.taskId ?? randomUUID(),
    status: input.status ?? 'partial',
    objective: input.objective ?? '',
    baselineRef: input.baselineRef ?? null,
    reproduction: input.reproduction ?? { status: 'reproduction_unavailable', evidenceRefs: [] },
    changes: input.changes ?? [],
    validations: input.validations ?? [],
    diff: input.diff ?? { artifactRef: null, reviewed: false },
    remainingRisks: input.remainingRisks ?? [],
    traceRef: input.traceRef ?? null,
    startedAt: input.startedAt ?? new Date().toISOString(),
    finishedAt: input.finishedAt ?? new Date().toISOString(),
  }
}

export function validateSweResult(result) {
  const errors = []
  if (result?.protocol !== SWE_RESULT_PROTOCOL) errors.push(`protocol deve ser ${SWE_RESULT_PROTOCOL}`)
  for (const field of ['taskId', 'status', 'objective', 'startedAt', 'finishedAt']) {
    if (typeof result?.[field] !== 'string' || !result[field]) errors.push(`${field} é obrigatório`)
  }
  for (const field of ['baselineRef', 'traceRef']) {
    if (typeof result?.[field] !== 'string' || !result[field]) errors.push(`${field} é obrigatório`)
  }
  if (!result?.reproduction || typeof result.reproduction.status !== 'string' || !Array.isArray(result.reproduction.evidenceRefs)) errors.push('reproduction inválida')
  if (!result?.diff || typeof result.diff.reviewed !== 'boolean') errors.push('diff inválido')
  if (!Array.isArray(result?.remainingRisks)) errors.push('remainingRisks deve ser array')
  if (!['completed', 'partial', 'failed', 'blocked', 'cancelled'].includes(result?.status)) errors.push('status inválido')
  if (!Array.isArray(result?.changes)) errors.push('changes deve ser array')
  if (!Array.isArray(result?.validations)) errors.push('validations deve ser array')
  if (result?.status === 'completed' && result.changes?.length > 0) {
    if (!result.diff?.reviewed) errors.push('completed com mudanças exige diff revisado')
    if (!result.validations?.some((item) => item.status === 'passed')) errors.push('completed com mudanças exige validação aprovada')
  }
  if (result?.validations?.some((item) => item.status === 'passed' && item.exitCode !== 0)) {
    errors.push('validação com exitCode diferente de zero não pode ser passed')
  }
  return { valid: errors.length === 0, errors }
}

export function scoreSweRun({ caseDefinition, result, metrics = {} }) {
  const validation = validateSweResult(result)
  const passed = result?.validations?.filter((item) => item.status === 'passed').length ?? 0
  const required = caseDefinition?.acceptance?.commands?.length ?? 0
  const changed = new Set((result?.changes ?? []).map((item) => item.path))
  const forbidden = (caseDefinition?.acceptance?.forbiddenPaths ?? []).filter((path) => changed.has(path))
  return {
    issueResolution: validation.valid && result.status === 'completed' && passed >= required,
    evidenceCompleteness: validation.valid && Boolean(result.baselineRef) && Boolean(result.traceRef),
    workspacePreservation: metrics.workspacePreservation !== false,
    scopePrecision: forbidden.length === 0,
    toolCalls: metrics.toolCalls ?? null,
    durationMs: metrics.durationMs ?? null,
    forbiddenPathsChanged: forbidden,
  }
}

export function compareSweTargets(runs, { benchmarkVersion = 1 } = {}) {
  const groups = new Map()
  for (const run of runs) {
    if (!run.target || !run.caseId || !run.score) throw new TypeError('run exige target, caseId e score')
    const values = groups.get(run.target) ?? []
    values.push(run)
    groups.set(run.target, values)
  }
  const targets = [...groups].map(([target, values]) => {
    const resolved = values.filter((item) => item.score.issueResolution).length
    const durations = values.map((item) => item.score.durationMs).filter(Number.isFinite).sort((a, b) => a - b)
    return { target, samples: values.length, resolved, resolutionRate: resolved / values.length, medianDurationMs: durations.length ? durations[Math.floor(durations.length / 2)] : null, comparableCases: [...new Set(values.map((item) => item.caseId))].sort() }
  })
  return { protocol: SWE_BENCHMARK_PROTOCOL, benchmarkVersion, targets, comparable: targets.length >= 2 && targets.every((item) => JSON.stringify(item.comparableCases) === JSON.stringify(targets[0].comparableCases)), measuredAt: new Date().toISOString() }
}
