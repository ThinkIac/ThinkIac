import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

let Database = null
try { Database = createRequire(import.meta.url)('better-sqlite3') } catch {}

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const TYPES = new Set(['request', 'tool_started', 'tool_result', 'checkpoint', 'delivery'])


export function sanitizeBagValue(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (/password|secret|authorization|cookie|api.?key|token|reasoning|thinking/i.test(key)) return '[REDACTED]'
    if (typeof item === 'string') return item
      .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
      .replace(/\bsk-[\w-]+/g, '[REDACTED]')
      .replace(/((?:password|senha|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    return item
  }))
}

function scopeKey(scope) {
  for (const field of ['tenantId', 'workspaceId', 'taskId']) {
    if (typeof scope?.[field] !== 'string' || !scope[field]) throw new Error(`BAG_SCOPE_REQUIRED:${field}`)
  }
  return digest([scope.tenantId, scope.workspaceId, scope.taskId])
}

function sanitizeEvidence(text) {
  
  try { return JSON.stringify(sanitizeBagValue(JSON.parse(text))) }
  catch { return sanitizeBagValue(text) }
}

class SqliteBagStore {
  constructor(filename) {
    this.db = new Database(filename)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(`CREATE TABLE IF NOT EXISTS bag_events (
      scope TEXT NOT NULL, sequence INTEGER NOT NULL, event_key TEXT NOT NULL,
      type TEXT NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL, at INTEGER NOT NULL,
      PRIMARY KEY(scope, sequence), UNIQUE(scope,event_key));
      CREATE TABLE IF NOT EXISTS bag_state (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bag_resources (scope TEXT NOT NULL, path TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,path));
      CREATE TABLE IF NOT EXISTS bag_evidence (scope TEXT NOT NULL, revision INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(scope,revision));
      CREATE TABLE IF NOT EXISTS bag_deleted (scope TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS bag_bindings (scope TEXT NOT NULL, destination TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,destination));`)
  }

  append(scope, { key, type, payload, expectedRevision, evidence = null }) {
    const id = scopeKey(scope)
    if (!key || !TYPES.has(type)) throw new Error('BAG_INVALID_EVENT')
    const sanitized = sanitizeBagValue(payload)
    const encoded = JSON.stringify(sanitized)
    if (Buffer.byteLength(encoded) > 128_000) throw new Error('BAG_EVENT_TOO_LARGE')
    const full = typeof evidence === 'string' && Buffer.byteLength(evidence) <= 1024 * 1024
      ? sanitizeEvidence(evidence) : null
    const hash = full === null ? digest([type, sanitized]) : digest([type, sanitized, digest(full)])
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM bag_deleted WHERE scope=?').get(id)) throw new Error('BAG_DELETED')
      const duplicate = this.db.prepare('SELECT sequence,digest FROM bag_events WHERE scope=? AND event_key=?').get(id, key)
      if (duplicate) {
        if (duplicate.digest !== hash) return { status: 'conflict', code: 'IDEMPOTENCY_CONFLICT' }
        return { status: 'ready', revision: duplicate.sequence, committed: true, reused: true,
          ...(full !== null ? { evidenceRevision: duplicate.sequence } : {}),
        }
      }
      const previous = this.get(scope)
      if (expectedRevision != null && previous.revision !== expectedRevision) return { status: 'conflict', revision: previous.revision }
      const revision = previous.revision + 1
      if (full !== null) this.db.prepare('INSERT INTO bag_evidence VALUES (?,?,?)').run(id, revision, full)
      const state = previous.state
      if (type === 'request') { state.objective ||= sanitized; state.request = sanitized; state.pending = state.pending || {} }
      if (type === 'tool_started') Object.defineProperty(state.pending, sanitized.callId, { value: { ...sanitized, status: 'unknown' }, enumerable: true, configurable: true, writable: true })
      if (type === 'tool_result') { delete state.pending[sanitized.callId]; state.lastResult = { ...sanitized, revision } }
      if (type === 'tool_result' && sanitized.resource?.path && sanitized.resource?.hash) {
        const resource = { ...sanitized.resource, revision, callId: sanitized.callId }
        this.db.prepare('INSERT INTO bag_resources VALUES (?,?,?) ON CONFLICT(scope,path) DO UPDATE SET value=excluded.value')
          .run(id, resource.path, JSON.stringify(resource))
      }
      if (type === 'checkpoint') state.checkpoint = sanitized
      if (type === 'delivery') state.delivery = sanitized
      this.db.prepare('INSERT INTO bag_events VALUES (?,?,?,?,?,?,?)').run(id, revision, key, type, encoded, hash, Date.now())
      this.db.prepare('INSERT INTO bag_state VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,state=excluded.state').run(id, revision, JSON.stringify(state))
      return { status: 'ready', committed: true, revision, reused: false, ...(full !== null ? { evidenceRevision: revision } : {}) }
    }).immediate()
  }

  get(scope) {
    const row = this.db.prepare('SELECT revision,state FROM bag_state WHERE scope=?').get(scopeKey(scope))
    return row ? { status: 'ready', revision: row.revision, state: JSON.parse(row.state) }
      : { status: 'empty', revision: 0, state: { pending: {} } }
  }

  retrieve(scope, { query = '', maxTokens = 1500 } = {}) {
    const current = this.get(scope)
    const terms = String(query).toLowerCase().match(/[A-Za-z0-9_./\-\u00C0-\u024F]{3,}/g) || []
    const rows = this.db.prepare('SELECT sequence,type,payload,at FROM bag_events WHERE scope=? ORDER BY sequence DESC').all(scopeKey(scope))
    const ranked = rows.map(row => ({ ...row, score: terms.reduce((n, term) => n + Number(row.payload.toLowerCase().includes(term)), 0) }))
      .sort((a, b) => b.score - a.score || b.sequence - a.sequence)
    const budget = Math.max(0, Math.floor(Number(maxTokens) || 0))
    const items = []; let usedTokens = 0
    for (const row of ranked) {
      
      const tokens = Buffer.byteLength(row.payload) + 64
      if (usedTokens + tokens > budget) continue
      items.push({ revision: row.sequence, type: row.type, payload: JSON.parse(row.payload), at: row.at })
      usedTokens += tokens
    }
    return { ...current, items, usedTokens, coverage: items.length === rows.length ? 'complete' : 'partial' }
  }

  resources(scope, { limit = 50 } = {}) {
    const count = Number.isFinite(limit) ? Math.min(100, Math.max(0, Math.floor(limit))) : 50
    return this.db.prepare("SELECT value FROM bag_resources WHERE scope=? ORDER BY json_extract(value, '$.revision') DESC LIMIT ?")
      .all(scopeKey(scope), count).map(row => JSON.parse(row.value))
  }

  evidence(scope, revision, { offset = 0, limit = 4000 } = {}) {
    if (!Number.isInteger(revision) || revision < 1 || !Number.isInteger(offset) || offset < 0) return { status: 'invalid' }
    const row = this.db.prepare('SELECT content FROM bag_evidence WHERE scope=? AND revision=?').get(scopeKey(scope), revision)
    if (!row) return { status: 'empty' }
    const count = Math.min(16000, Math.max(1, Math.floor(Number(limit) || 4000)))
    const content = row.content.slice(offset, offset + count)
    return { status: 'ready', revision, content, offset, totalCharacters: row.content.length,
      nextOffset: offset + content.length < row.content.length ? offset + content.length : null,
      coverage: offset === 0 && content.length === row.content.length ? 'complete' : 'partial',
      representation: 'sanitized_tool_result', freshness: 'historical' }
  }

  evidenceRevisions(scope) {
    return new Set(this.db.prepare('SELECT revision FROM bag_evidence WHERE scope=?').all(scopeKey(scope)).map(row => row.revision))
  }

  remove(scope) {
    const id = scopeKey(scope)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM bag_resources WHERE scope=?').run(id)
      this.db.prepare('DELETE FROM bag_evidence WHERE scope=?').run(id)
      this.db.prepare('DELETE FROM bag_events WHERE scope=?').run(id)
      this.db.prepare('DELETE FROM bag_state WHERE scope=?').run(id)
      this.db.prepare('DELETE FROM bag_bindings WHERE scope=?').run(id)
      this.db.prepare('INSERT OR IGNORE INTO bag_deleted VALUES (?)').run(id)
    }).immediate()
    return { status: 'ready', deleted: true }
  }

  getBinding(scope, destination) {
    const row = this.db.prepare('SELECT value FROM bag_bindings WHERE scope=? AND destination=?').get(scopeKey(scope), digest(destination))
    return row ? JSON.parse(row.value) : null
  }

  claimBinding(scope, destination) {
    return this.db.transaction(() => {
      const previous = this.getBinding(scope, destination)
      if (previous?.status === 'unknown') throw Object.assign(new Error('BAG_CODEX_TURN_UNKNOWN: reconciliar o turno anterior antes de continuar.'), { noRetry: true })
      this.setBinding(scope, destination, { ...previous, threadId: previous?.threadId || null, status: 'unknown' })
      return previous
    }).immediate()
  }

  setBinding(scope, destination, value) {
    const id = scopeKey(scope)
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM bag_deleted WHERE scope=?').get(id)) throw new Error('BAG_DELETED')
      this.db.prepare('INSERT INTO bag_bindings VALUES (?,?,?) ON CONFLICT(scope,destination) DO UPDATE SET value=excluded.value')
        .run(id, digest(destination), JSON.stringify(value))
    }).immediate()
  }

  close() { this.db.close() }
}

class JsonBagStore {
  constructor(filename) {
    this.filename = filename === ':memory:' ? null : `${filename}.json`
    this.data = this.filename && existsSync(this.filename)
      ? JSON.parse(readFileSync(this.filename, 'utf8'))
      : { scopes: {}, deleted: [] }
  }

  persist() {
    if (!this.filename) return
    const temporary = `${this.filename}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.data)}\n`, { mode: 0o600 })
    renameSync(temporary, this.filename)
  }

  record(scope) {
    const id = scopeKey(scope)
    return [id, this.data.scopes[id] ||= { revision: 0, state: { pending: {} }, events: [], resources: {}, evidence: {}, bindings: {} }]
  }

  append(scope, { key, type, payload, expectedRevision, evidence = null }) {
    const [id, record] = this.record(scope)
    if (this.data.deleted.includes(id)) throw new Error('BAG_DELETED')
    if (!key || !TYPES.has(type)) throw new Error('BAG_INVALID_EVENT')
    const sanitized = sanitizeBagValue(payload)
    const encoded = JSON.stringify(sanitized)
    if (Buffer.byteLength(encoded) > 128_000) throw new Error('BAG_EVENT_TOO_LARGE')
    const full = typeof evidence === 'string' && Buffer.byteLength(evidence) <= 1024 * 1024 ? sanitizeEvidence(evidence) : null
    const hash = full === null ? digest([type, sanitized]) : digest([type, sanitized, digest(full)])
    const duplicate = record.events.find(item => item.key === key)
    if (duplicate) return duplicate.hash === hash
      ? { status: 'ready', revision: duplicate.sequence, committed: true, reused: true, ...(full !== null ? { evidenceRevision: duplicate.sequence } : {}) }
      : { status: 'conflict', code: 'IDEMPOTENCY_CONFLICT' }
    if (expectedRevision != null && record.revision !== expectedRevision) return { status: 'conflict', revision: record.revision }
    const revision = ++record.revision
    const state = record.state
    if (type === 'request') { state.objective ||= sanitized; state.request = sanitized; state.pending ||= {} }
    if (type === 'tool_started') state.pending[sanitized.callId] = { ...sanitized, status: 'unknown' }
    if (type === 'tool_result') { delete state.pending[sanitized.callId]; state.lastResult = { ...sanitized, revision } }
    if (type === 'tool_result' && sanitized.resource?.path && sanitized.resource?.hash) record.resources[sanitized.resource.path] = { ...sanitized.resource, revision, callId: sanitized.callId }
    if (type === 'checkpoint') state.checkpoint = sanitized
    if (type === 'delivery') state.delivery = sanitized
    if (full !== null) record.evidence[revision] = full
    record.events.push({ sequence: revision, key, type, payload: encoded, hash, at: Date.now() })
    this.persist()
    return { status: 'ready', committed: true, revision, reused: false, ...(full !== null ? { evidenceRevision: revision } : {}) }
  }

  get(scope) {
    const [, record] = this.record(scope)
    return record.revision ? { status: 'ready', revision: record.revision, state: structuredClone(record.state) }
      : { status: 'empty', revision: 0, state: { pending: {} } }
  }

  retrieve(scope, { query = '', maxTokens = 1500 } = {}) {
    const [, record] = this.record(scope)
    const terms = String(query).toLowerCase().match(/[A-Za-z0-9_./\-\u00C0-\u024F]{3,}/g) || []
    const rows = record.events.map(row => ({ ...row, score: terms.reduce((n, term) => n + Number(row.payload.toLowerCase().includes(term)), 0) }))
      .sort((a, b) => b.score - a.score || b.sequence - a.sequence)
    const budget = Math.max(0, Math.floor(Number(maxTokens) || 0)); const items = []; let usedTokens = 0
    for (const row of rows) { const tokens = Buffer.byteLength(row.payload) + 64; if (usedTokens + tokens > budget) continue; items.push({ revision: row.sequence, type: row.type, payload: JSON.parse(row.payload), at: row.at }); usedTokens += tokens }
    return { ...this.get(scope), items, usedTokens, coverage: items.length === rows.length ? 'complete' : 'partial' }
  }

  resources(scope, { limit = 50 } = {}) { const [, record] = this.record(scope); return Object.values(record.resources).sort((a, b) => b.revision - a.revision).slice(0, Math.min(100, Math.max(0, Math.floor(limit)))) }
  evidence(scope, revision, { offset = 0, limit = 4000 } = {}) { const [, record] = this.record(scope); if (!Number.isInteger(revision) || revision < 1 || !Number.isInteger(offset) || offset < 0) return { status: 'invalid' }; const full = record.evidence[revision]; if (full == null) return { status: 'empty' }; const count = Math.min(16000, Math.max(1, Math.floor(Number(limit) || 4000))); const content = full.slice(offset, offset + count); return { status: 'ready', revision, content, offset, totalCharacters: full.length, nextOffset: offset + content.length < full.length ? offset + content.length : null, coverage: offset === 0 && content.length === full.length ? 'complete' : 'partial', representation: 'sanitized_tool_result', freshness: 'historical' } }
  evidenceRevisions(scope) { const [, record] = this.record(scope); return new Set(Object.keys(record.evidence).map(Number)) }
  remove(scope) { const id = scopeKey(scope); delete this.data.scopes[id]; if (!this.data.deleted.includes(id)) this.data.deleted.push(id); this.persist(); return { status: 'ready', deleted: true } }
  getBinding(scope, destination) { const [, record] = this.record(scope); return record.bindings[digest(destination)] ?? null }
  claimBinding(scope, destination) { const previous = this.getBinding(scope, destination); if (previous?.status === 'unknown') throw Object.assign(new Error('BAG_CODEX_TURN_UNKNOWN: reconciliar o turno anterior antes de continuar.'), { noRetry: true }); this.setBinding(scope, destination, { ...previous, threadId: previous?.threadId || null, status: 'unknown' }); return previous }
  setBinding(scope, destination, value) { const [id, record] = this.record(scope); if (this.data.deleted.includes(id)) throw new Error('BAG_DELETED'); record.bindings[digest(destination)] = value; this.persist() }
  close() {}
}

export class BagStore {
  constructor(filename) {
    return Database ? new SqliteBagStore(filename) : new JsonBagStore(filename)
  }
}
