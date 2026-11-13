import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const cleanId = value => String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'default'

export class SessionStore {
  constructor(directory) { this.directory = directory; mkdirSync(directory, { recursive: true }) }
  path(id) { return join(this.directory, `${cleanId(id)}.json`) }
  load(id) {
    try { return JSON.parse(readFileSync(this.path(id), 'utf8')) } catch { return { id, messages: [], workspace: null, model: 'auto', updatedAt: null } }
  }
  save(session) {
    const target = this.path(session.id)
    const next = { ...session, updatedAt: new Date().toISOString() }
    const temp = `${target}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8'); renameSync(temp, target)
    return next
  }
  list() {
    return readdirSync(this.directory).filter(name => name.endsWith('.json')).map(name => this.load(name.slice(0, -5))).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  }
  erase(id) { try { unlinkSync(this.path(id)) } catch {} }
}
