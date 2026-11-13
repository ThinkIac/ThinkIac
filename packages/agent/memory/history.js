


import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const HIST_DIR = join(PKG_DIR, 'history')
const MAX_VERS = 7

const ensureHist = () => { if (!existsSync(HIST_DIR)) mkdirSync(HIST_DIR, { recursive: true }) }

function slotName(filePath) { return filePath.replace(/[\\/]/g, '__') }
function slotDir(filePath) { return join(HIST_DIR, slotName(filePath)) }

export function listHistory(filePath) {
  ensureHist()
  const dir = slotDir(filePath)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { return null } })
    .filter(Boolean)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
}

export function saveSnapshot(filePath, { session_id = 'unknown', tool_call = 'unknown', reason = '' } = {}) {
  ensureHist()
  if (!existsSync(filePath)) return null
  const dir = slotDir(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const content = readFileSync(filePath, 'utf8')
  const timestamp = new Date().toISOString()
  const entry = { id: timestamp.replace(/[:.]/g, '-'), filePath, timestamp, session_id, tool_call, reason, content }
  writeFileSync(join(dir, `${entry.id}.json`), JSON.stringify(entry, null, 2), 'utf8')
  const all = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  if (all.length > MAX_VERS) all.slice(0, all.length - MAX_VERS).forEach(f => { try { unlinkSync(join(dir, f)) } catch {} })
  return entry
}

export function restoreVersion(filePath, index = 0) {
  const history = listHistory(filePath)
  if (!history.length) return { success: false, error: 'Sem histórico para: ' + filePath }
  if (index < 0 || index >= history.length) return { success: false, error: `Índice ${index} inválido. Disponível: 0–${history.length - 1}` }
  const entry = history[index]
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, entry.content, 'utf8')
    return { success: true, restored_to: entry.timestamp, session_id: entry.session_id, tool_call: entry.tool_call, reason: entry.reason, content_length: entry.content.length }
  } catch (e) { return { success: false, error: e.message } }
}

export function peekLatest(filePath) { return listHistory(filePath)[0] ?? null }

export function clearHistory(filePath) {
  const dir = slotDir(filePath)
  if (!existsSync(dir)) return 0
  const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  files.forEach(f => { try { unlinkSync(join(dir, f)) } catch {} })
  return files.length
}

export function listAllTracked() {
  ensureHist()
  if (!existsSync(HIST_DIR)) return []
  return readdirSync(HIST_DIR)
    .filter(slot => statSync(join(HIST_DIR, slot)).isDirectory())
    .map(slot => {
      const versions = listHistory(slot.replace(/__/g, '/'))
      return { file: slot.replace(/__/g, '/'), versions: versions.length, latest: versions[0]?.timestamp ?? null, oldest: versions[versions.length - 1]?.timestamp ?? null }
    })
    .filter(f => f.versions > 0)
}
