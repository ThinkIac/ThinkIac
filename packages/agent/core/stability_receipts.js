

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_FILE = join(dirname(fileURLToPath(import.meta.url)), '../data/stability-receipts.json')
const TTL = 24 * 60 * 60_000

export function createStabilityReceipts({ file = DEFAULT_FILE, now = Date.now } = {}) {
  function read() {
    try { const data = JSON.parse(readFileSync(file, 'utf8')); return { ...data, receipts: data.receipts || [], candidates: data.candidates || [] } }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { schemaVersion: 2, receipts: [], candidates: [] } }
  }
  function save(store) {
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file) && store.schemaVersion !== 2 && !existsSync(`${file}.v1.bak`)) copyFileSync(file, `${file}.v1.bak`)
    store.schemaVersion = 2
    writeFileSync(`${file}.tmp`, JSON.stringify(store, null, 2))
    renameSync(`${file}.tmp`, file)
  }
  function recordLocalChange(payload = {}) {
    if (!payload.sessionId || !payload.runId || !payload.path || !payload.hash) throw new Error('Local evidence requires sessionId, runId, path and hash')
    const store = read()
    const existing = store.candidates.find(item => item.sessionId === payload.sessionId && item.runId === payload.runId && item.operationId === payload.operationId && payload.operationId && item.path === payload.path && item.hash === payload.hash)
    if (existing) return existing
    const change = {
      id: randomUUID(), sessionId: payload.sessionId, runId: payload.runId,
      taskId: payload.taskId || payload.runId, operationId: payload.operationId || null,
      path: payload.path, hash: payload.hash, pkg: payload.pkg || null,
      checks: payload.checks || [], at: now(),
    }
    store.candidates.push(change)
    save(store)
    return change
  }
  function record(status, payload = {}) {
    const store = read()
    const id = payload.receiptId || JSON.stringify([payload.pkg || payload.package, payload.candidateId || randomUUID(), payload.candidateHash || null, status])
    const existing = store.receipts.find(item => item.receiptId === id)
    if (existing) return existing
    const suppliedAuthors = Array.isArray(payload.authors) ? payload.authors.filter(a => a.sessionId && a.runId) : []
    if (payload.sessionId && payload.runId) suppliedAuthors.push({ sessionId: payload.sessionId, runId: payload.runId, taskId: payload.taskId || payload.runId })
    const authors = [...new Map(suppliedAuthors.map(a => {
      const author = { sessionId: a.sessionId, runId: a.runId, taskId: a.taskId || a.runId }
      return [JSON.stringify(author), author]
    })).values()]
    const identityConflict = !!payload.candidateId && store.receipts.some(r => r.pkg === String(payload.pkg || payload.package || 'desconhecido') && r.candidateId === payload.candidateId && r.candidateHash && payload.candidateHash && r.candidateHash !== payload.candidateHash)
    const receipt = {
      schemaVersion: 2, id, receiptId: id, status,
      sessionId: authors.length === 1 ? authors[0].sessionId : null,
      runId: authors.length === 1 ? authors[0].runId : null,
      taskId: payload.taskId || (authors.length === 1 ? authors[0].taskId || authors[0].runId : null),
      authors, operationIds: [...new Set(payload.operationIds || [])],
      pkg: String(payload.pkg || payload.package || 'desconhecido'),
      candidateId: payload.candidateId || null, candidateHash: payload.candidateHash || null,
      at: now(), producedAt: payload.producedAt ?? null, expiresAt: now() + TTL,
      identityConflict,
      activated: status === 'stable' && payload.activated === true && !!payload.candidateId && !!payload.candidateHash && !identityConflict,
      restaged: payload.restaged ?? null, restoredCandidateHash: payload.restoredCandidateHash || null,
      error: String(payload.error || '').slice(0, 1500), checks: payload.checks || [],
      files: payload.files || [], checkpointRef: payload.checkpointRef || null,
    }
    store.receipts.push(receipt)
    save(store)
    return receipt
  }
  function list({ sessionId, runId, taskId, pkg, candidateHash, includeExpired = true } = {}) {
    return read().receipts.filter(r =>
      (!(sessionId || runId || taskId) || r.authors?.some(a =>
        (!sessionId || a.sessionId === sessionId) &&
        (!runId || a.runId === runId) &&
        (!taskId || (a.taskId || a.runId) === taskId))) &&
      (!pkg || r.pkg === pkg) && (!candidateHash || r.candidateHash === candidateHash) &&
      (includeExpired || (r.expiresAt || r.at + TTL) > now()))
  }
  function deliveries(filter = {}) {
    const groups = new Map()
    const receipts = list(filter)
    const hashes = new Map()
    for (const r of read().receipts) {
      if (!r.candidateId || !r.candidateHash) continue
      const identity = JSON.stringify([r.pkg, r.candidateId])
      if (!hashes.has(identity)) hashes.set(identity, new Set())
      hashes.get(identity).add(r.candidateHash)
    }
    for (const r of receipts) {
      const conflict = r.identityConflict || hashes.get(JSON.stringify([r.pkg, r.candidateId]))?.size > 1
      const key = JSON.stringify([r.taskId, r.pkg, r.candidateId || r.id, r.candidateHash])
      const current = groups.get(key)
      if (current && (current.producedAt ?? current.at) > (r.producedAt ?? r.at)) continue
      groups.set(key, { taskId: r.taskId, runId: r.runId, package: r.pkg,
        candidateId: r.candidateId, candidateHash: r.candidateHash,
        localValidation: 'unknown', runtimeValidation: conflict ? 'identity_conflict' : r.status === 'stable' ? 'passed' : r.status,
        activation: conflict ? 'unknown' : r.activated ? 'confirmed' : r.status === 'rolled_back' && r.restaged ? 'restored' : 'unknown',
        receiptId: r.receiptId || r.id, producedAt: r.producedAt, at: r.at })
    }
    const local = read().candidates.filter(item =>
      (!filter.sessionId || item.sessionId === filter.sessionId) &&
      (!filter.runId || item.runId === filter.runId) &&
      (!filter.taskId || item.taskId === filter.taskId) &&
      (!filter.pkg || item.pkg === filter.pkg) && !filter.candidateHash)
    const latest = new Map()
    for (const item of local) {
      const key = JSON.stringify([item.taskId, item.pkg, item.path])
      const previous = latest.get(key)
      if (!previous || item.at >= previous.at) latest.set(key, item)
    }
    return [...groups.values(), ...local.map(item => ({
      taskId: item.taskId, runId: item.runId, package: item.pkg,
      candidateId: null, candidateHash: null, path: item.path, sourceHash: item.hash,
      localChange: 'confirmed',
      localValidation: item.checks.some(check => check.ok === false) ? 'failed'
        : item.checks.length && item.checks.every(check => check.ok === true) ? 'passed' : 'unknown',
      checks: item.checks, evidenceId: item.id,
      applicable: latest.get(JSON.stringify([item.taskId, item.pkg, item.path])).id === item.id,
      runtimeValidation: 'unknown', activation: 'unknown', at: item.at,
    }))]
  }
  function promptFor(sessionId, { runId, taskId } = {}) {
    if (!runId && !taskId) return ''
    const filter = { sessionId, runId, taskId, includeExpired: false }
    const projections = deliveries(filter)
    const currentIds = new Set(projections.map(r => r.receiptId))
    return list(filter).filter(r => currentIds.has(r.receiptId)).map(r => {
      const label = projections.some(item => item.receiptId === r.receiptId && item.runtimeValidation === 'identity_conflict') ? 'IDENTIDADE DIVERGENTE; aceite não comprovado' : r.status === 'stable' ? (r.activated ? 'ACEITA E ATIVADA' : 'VALIDADA; ativação não comprovada') : r.status === 'rolled_back' ? 'REVERTIDA' : 'REJEITADA'
      return `## Evidência do Runtime\n${label}: pacote ${r.pkg}, candidato ${r.candidateId || 'desconhecido'}, hash ${r.candidateHash || 'desconhecido'}, recibo ${r.receiptId}.\n${r.error}\n${r.status === 'rolled_back' ? `Restauração validada: ${r.restaged === true ? 'sim' : 'não comprovada'}.` : ''}\nEste recibo vale somente para o conteúdo e a execução identificados; não autoriza reparos fora do pedido.`
    }).join('\n\n')
  }
  return {
    
    markPotentialMutation: () => null,
    recordRejected: payload => record('rejected', payload),
    recordRolledBack: payload => record('rolled_back', payload),
    recordStable: payload => record('stable', payload),
    recordLocalChange,
    localChanges: ({ sessionId, runId, taskId } = {}) => read().candidates.filter(item =>
      (!sessionId || item.sessionId === sessionId) && (!runId || item.runId === runId) && (!taskId || item.taskId === taskId)),
    list, deliveries, promptFor, _read: read,
  }
}
export const stabilityReceipts = createStabilityReceipts()
