import {
  existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, unlinkSync, writeFileSync,
} from 'fs'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const CORE_DIR = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_DURABLE_RUNS_DIR = join(CORE_DIR, '..', 'data', 'durable-runs')
const RECOVERABLE = new Set(['running', 'recovering'])

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

export class DurableRunStore {
  constructor({ dir = DEFAULT_DURABLE_RUNS_DIR, ownerId = randomUUID(), bootId = randomUUID(), now = Date.now, leaseMs = 30_000, maxRecoveryAttempts = 3 } = {}) {
    this.dir = dir
    this.ownerId = ownerId
    
    
    this.bootId = bootId
    this.now = now
    this.leaseMs = leaseMs
    this.maxRecoveryAttempts = maxRecoveryAttempts
    mkdirSync(this.dir, { recursive: true })
  }

  path(id) { return join(this.dir, `${id}.json`) }

  get(id) {
    try { return JSON.parse(readFileSync(this.path(id), 'utf8')) }
    catch { return null }
  }

  write(run) {
    const next = { ...run, updatedAt: new Date(this.now()).toISOString() }
    const target = this.path(next.id)
    const temporary = `${target}.${this.ownerId}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temporary, target)
    return clone(next)
  }

  update(id, updater) {
    const current = this.get(id)
    if (!current) return null
    return this.write(updater(clone(current)))
  }

  start({ sessionId, message, maxIterations = null, taskId = null, origin = null }) {
    const timestamp = new Date(this.now()).toISOString()
    const id = randomUUID()
    return this.write({
      id, taskId: taskId || id, sessionId, message, maxIterations, origin,
      status: 'running', ownerId: this.ownerId, bootId: this.bootId,
      leaseExpiresAt: this.now() + this.leaseMs,
      checkpoint: { phase: 'accepted', iteration: 0, at: timestamp },
      inFlightTool: null, createdAt: timestamp, attempts: 0, recoverAfter: null,
    })
  }

  heartbeat(id) {
    return this.update(id, run => ({ ...run, ownerId: this.ownerId, bootId: this.bootId, leaseExpiresAt: this.now() + this.leaseMs }))
  }

  checkpoint(id, { phase, iteration = 0, ...details }) {
    return this.update(id, run => ({
      ...run,
      ownerId: this.ownerId, bootId: this.bootId,
      leaseExpiresAt: this.now() + this.leaseMs,
      checkpoint: { phase, iteration, ...details, at: new Date(this.now()).toISOString() },
    }))
  }

  toolStarted(id, toolCall, iteration, recovery = {}) {
    return this.update(id, run => ({
      ...run,
      ownerId: this.ownerId, bootId: this.bootId,
      leaseExpiresAt: this.now() + this.leaseMs,
      checkpoint: { phase: 'tool-started', iteration, at: new Date(this.now()).toISOString() },
      inFlightTool: {
        id: toolCall.id, name: toolCall.name, input: clone(toolCall.input),
        status: 'unknown', startedAt: new Date(this.now()).toISOString(),
        operationId: recovery.operationId || randomUUID(),
        recoveryPolicy: recovery.policy || 'reconcile',
        reconcileTool: recovery.reconcileTool || null,
      },
    }))
  }

  toolCompleted(id, toolCallId, outcome = {}) {
    return this.update(id, run => ({
      ...run,
      checkpoint: {
        phase: 'tool-completed', iteration: run.checkpoint?.iteration ?? 0,
        toolCallId, ok: outcome.ok !== false, at: new Date(this.now()).toISOString(),
      },
      inFlightTool: null,
      leaseExpiresAt: this.now() + this.leaseMs,
    }))
  }

  complete(id, result = '') {
    return this.update(id, run => ({
      ...run, status: 'completed', result: String(result).slice(0, 2_000),
      leaseExpiresAt: null, completedAt: new Date(this.now()).toISOString(), inFlightTool: null,
    }))
  }

  fail(id, error) {
    return this.update(id, run => ({
      ...run, status: 'failed', error: String(error), leaseExpiresAt: null,
      failedAt: new Date(this.now()).toISOString(),
    }))
  }

  list() {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter(name => name.endsWith('.json'))
      .map(name => this.get(name.slice(0, -5)))
      .filter(Boolean)
  }

  listRecoverable() {
    const now = this.now()
    return this.list().filter(run => RECOVERABLE.has(run.status)
      && Number(run.recoverAfter || 0) <= now
      && Number(run.attempts || 0) < this.maxRecoveryAttempts
      && (run.bootId !== this.bootId || Number(run.leaseExpiresAt || 0) < now))
  }

  claim(id) {
    const run = this.get(id)
    const recoverable = run && RECOVERABLE.has(run.status)
      && Number(run.recoverAfter || 0) <= this.now()
      && Number(run.attempts || 0) < this.maxRecoveryAttempts
      && (run.bootId !== this.bootId || Number(run.leaseExpiresAt || 0) < this.now())
    if (!recoverable) return null
    return this.write({
      ...run, status: 'recovering', ownerId: this.ownerId, bootId: this.bootId,
      leaseExpiresAt: this.now() + this.leaseMs, attempts: Number(run.attempts || 0) + 1,
      recoverAfter: null,
      recoveredAt: new Date(this.now()).toISOString(),
    })
  }

  scheduleRetry(id, error, delayMs) {
    return this.update(id, run => {
      const exhausted = Number(run.attempts || 0) >= this.maxRecoveryAttempts
      return {
        ...run, status: exhausted ? 'quarantined' : 'running', ownerId: this.ownerId, bootId: this.bootId,
        error: String(error), leaseExpiresAt: null,
        recoverAfter: exhausted ? null : this.now() + Math.max(0, Number(delayMs) || 0),
        lastRecoveryErrorAt: new Date(this.now()).toISOString(),
        ...(exhausted ? { failedAt: new Date(this.now()).toISOString(), failureReason: 'recovery-attempt-limit' } : {}),
      }
    })
  }

  compact(id) {
    return this.update(id, run => {
      if (run.status !== 'completed' || run.compacted) return run
      const { message, result, ...rest } = run
      return { ...rest, compacted: true, compactedAt: new Date(this.now()).toISOString() }
    })
  }

  maintain({
    maxAgeMs = 30 * 24 * 3600 * 1000,
    maxCompleted = 1_000,
    compactAfterMs = 7 * 24 * 3600 * 1000,
    dryRun = true,
  } = {}) {
    const completed = this.list()
      .filter(run => run.status === 'completed')
      .sort((a, b) => Date.parse(b.completedAt || b.updatedAt || 0) - Date.parse(a.completedAt || a.updatedAt || 0))
    const remove = new Set()
    const compact = []
    completed.forEach((run, index) => {
      const completedAt = Date.parse(run.completedAt || run.updatedAt || 0)
      const age = Math.max(0, this.now() - completedAt)
      if (age > maxAgeMs || index >= maxCompleted) remove.add(run.id)
      else if (!run.compacted && age >= compactAfterMs) compact.push(run.id)
    })
    const plan = { dryRun, compact, remove: [...remove], total: completed.length }
    if (!dryRun) {
      for (const id of compact) this.compact(id)
      for (const id of remove) this.remove(id)
    }
    return plan
  }

  remove(id) {
    try { unlinkSync(this.path(id)); return true }
    catch { return false }
  }
}

export const durableRuns = new DurableRunStore()
