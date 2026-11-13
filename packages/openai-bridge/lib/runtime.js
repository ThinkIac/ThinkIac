import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { getCodexCliProfile } from './model-catalog.js'

const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`)

export class CodexRuntime {
  constructor({ store, root, profilesDir, emit, sessionsUpdated }) { this.store = store; this.root = resolve(root); this.profilesDir = profilesDir; this.emit = emit; this.sessionsUpdated = sessionsUpdated; this.active = new Map(); this.cursors = new Map() }
  workspace(sessionId) { return this.store.load(sessionId).workspace || this.root }
  validateWorkspace(value) {
    const path = resolve(value || this.root)
    if (!inside(this.root, path)) throw new Error('Workspace fora do projeto não é permitido.')
    if (!existsSync(path)) throw new Error('Workspace não existe.')
    return path
  }
  setWorkspace(sessionId, path) { const session = this.store.load(sessionId); session.workspace = this.validateWorkspace(path); return this.store.save(session) }
  browse(path) {
    const current = this.validateWorkspace(path || this.root)
    return { root: this.root, path: current, parent: current === this.root ? null : dirname(current), entries: readdirSync(current, { withFileTypes: true }).filter(entry => entry.isDirectory()).filter(entry => !['node_modules', '.git'].includes(entry.name)).slice(0, 200).map(entry => ({ name: entry.name, path: resolve(current, entry.name), type: 'directory' })) }
  }
  status(sessionId) { return { active: this.active.has(sessionId), workspace: this.workspace(sessionId) } }
  history(sessionId) { return this.store.load(sessionId).messages }
  cursor(sessionId) { return this.cursors.get(sessionId) ?? [] }
  event(sessionId, event, data = {}) { const events = this.cursors.get(sessionId) ?? []; const item = { id: (events.at(-1)?.id ?? 0) + 1, epoch: this.active.get(sessionId)?.runId ?? 'idle', event, data }; events.push(item); if (events.length > 500) events.shift(); this.cursors.set(sessionId, events); this.emit(sessionId, item); return item }
  async send({ sessionId = 'default', message }) {
    if (!String(message || '').trim()) throw new Error('message é obrigatória')
    if (this.active.has(sessionId)) return { queued: true, accepted: false, error: 'Esta V1 aceita um turno por sessão; aguarde ou cancele o atual.' }
    const session = this.store.load(sessionId); const workspace = this.validateWorkspace(session.workspace || this.root)
    const profile = getCodexCliProfile(this.profilesDir, session.model)
    if (!profile) throw new Error('Nenhum perfil do Terminal está autenticado no Codex. Abra o Terminal e execute codex login.')
    session.workspace = workspace; session.messages.push({ role: 'user', content: message, timestamp: new Date().toISOString() }); this.store.save(session)
    const env = { ...process.env, HOME: profile.home, CODEX_HOME: profile.configDir }
    for (const key of Object.keys(env)) if (key.startsWith('XDG_')) delete env[key]
    const runId = crypto.randomUUID(); const child = spawn('codex', ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'workspace-write', '--approve-for-me', '--cd', workspace, '--add-dir', workspace, ...(session.model && session.model !== 'auto' ? ['--model', session.model] : []), message], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const state = { child, runId, text: '', buffer: '' }; this.active.set(sessionId, state); this.sessionsUpdated('turn_start', sessionId); this.event(sessionId, 'user_message', { text: message }); this.event(sessionId, 'step', { label: 'Codex iniciou no workspace selecionado' })
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => this.consume(sessionId, chunk)); child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { if (String(chunk).trim()) this.event(sessionId, 'step', { label: String(chunk).trim().slice(0, 500) }) })
    child.on('error', error => this.finish(sessionId, error)); child.on('close', code => this.finish(sessionId, code === 0 ? null : new Error(`Codex encerrou com código ${code}.`)))
    return { accepted: true, session_id: sessionId, run_id: runId }
  }
  consume(sessionId, chunk) { const state = this.active.get(sessionId); if (!state) return; state.buffer += chunk; const lines = state.buffer.split('\n'); state.buffer = lines.pop() ?? ''; for (const line of lines) { try { this.handleJson(sessionId, JSON.parse(line)) } catch { /* linhas não JSON não interrompem o stream */ } } }
  handleJson(sessionId, event) {
    const state = this.active.get(sessionId); if (!state) return
    const item = event.item ?? {}; const type = String(event.type ?? item.type ?? '')
    if (type.includes('command_execution')) this.event(sessionId, 'step', { label: item.command || item.aggregated_output || 'Executando comando' })
    if (type.includes('reasoning')) this.event(sessionId, 'step', { label: item.text || 'Raciocinando' })
    const text = item.text ?? event.text ?? (item.type === 'agent_message' ? item.content : null)
    if (typeof text === 'string' && text.length > state.text.length && (type.includes('item') || item.type === 'agent_message')) { const delta = text.slice(state.text.length); state.text = text; this.event(sessionId, 'token', { text: delta }) }
  }
  finish(sessionId, error) { const state = this.active.get(sessionId); if (!state) return; this.active.delete(sessionId); if (state.buffer) try { this.handleJson(sessionId, JSON.parse(state.buffer)) } catch {} const session = this.store.load(sessionId); const content = state.text || (error ? `Erro: ${error.message}` : 'Codex concluiu sem texto.') ; session.messages.push({ role: 'assistant', content, timestamp: new Date().toISOString() }); this.store.save(session); this.event(sessionId, error ? 'error' : 'done', error ? { error: error.message } : { response: content, timestamp: new Date().toISOString() }); this.sessionsUpdated(error ? 'turn_error' : 'turn_end', sessionId) }
  cancel(sessionId) { const state = this.active.get(sessionId); if (!state) return false; state.child.kill('SIGTERM'); setTimeout(() => { if (this.active.get(sessionId) === state) state.child.kill('SIGKILL') }, 2000).unref(); return true }
  setModel(sessionId, model) { const session = this.store.load(sessionId); session.model = model || 'auto'; return this.store.save(session) }
}
