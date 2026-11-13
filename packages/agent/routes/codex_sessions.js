

import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { discoverTerminalCodexAccounts } from '../llm/terminal_accounts.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(PKG_DIR, 'agent.config.json')
const ID_RE = /^[a-zA-Z0-9_-]{8,128}$/
const pending = []
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

function accounts() {
  let manual = []
  try { manual = (JSON.parse(readFileSync(CONFIG, 'utf8')).llm?.pools ?? []).find(p => p.provider === 'codex-cli')?.cli?.accounts ?? [] } catch {}
  const terminal = discoverTerminalCodexAccounts()
  const known = new Set(manual.map(a => a.config_dir))
  return [...manual.map(a => ({ ...a, kind: 'manual', profileId: null })), ...terminal.filter(a => !known.has(a.config_dir)).map(a => ({ ...a, kind: 'terminal', profileId: a.name.slice(9) }))]
}
function walk(dir, out = []) {
  let xs; try { xs = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const x of xs) { const p = join(dir, x.name); if (x.isDirectory()) walk(p, out); else if (x.isFile() && x.name.endsWith('.jsonl')) out.push(p) }
  return out
}
function meta(file, account) {
  let text; try { text = readFileSync(file, 'utf8').slice(0, 128 * 1024) } catch { return null }
  let cwd = null, title = null, id = null
  for (const line of text.split('\n')) {
    try {
      const o = JSON.parse(line); const p = o.payload ?? o
      id ??= p.id ?? p.session_id ?? p.sessionId
      cwd ??= p.cwd
      const content = p.message?.content ?? p.text ?? p.input
      const candidate = typeof content === 'string' ? content : Array.isArray(content) ? content.find(x => typeof x === 'string' || x?.text)?.text : null
      if (!title && candidate && !candidate.startsWith('<')) title = candidate.trim().slice(0, 120)
    } catch {}
  }
  id ??= basename(file, '.jsonl').replace(/^rollout-/, '')
  if (!ID_RE.test(String(id)) || !title) return null
  let mtime = 0; try { mtime = statSync(file).mtimeMs } catch {}
  return { id: String(id), cwd: cwd || account.home || '', title, mtime, account: account.name, accountKind: account.kind, profileId: account.profileId, config_dir: account.config_dir }
}
function scan() { return accounts().flatMap(a => walk(join(a.config_dir, 'sessions')).map(f => meta(f, a)).filter(Boolean)).sort((a,b) => b.mtime-a.mtime).slice(0,300) }

export async function listCodexSessions() {
  /**
   * @register_router codex-sessions
   * @method GET
   */
  try { return { success: true, sessions: scan() } } catch (e) { return { success:false, error:e.message } }
}
export async function openCodexSession(req) {
  /**
   * @register_router codex-sessions/open
   * @method POST
   */
  const id = req.body?.sessionId
  if (!ID_RE.test(String(id || ''))) return { success:false, error:'sessionId inválido' }
  const s = scan().find(x => x.id === id)
  if (!s) return { success:false, error:'sessão não encontrada' }
  const profileId = s.accountKind === 'terminal' ? (s.profileId || 'default') : 'default'
  const env = s.accountKind === 'manual' ? `CODEX_HOME=${shq(s.config_dir)} ` : ''
  
  
  
  pending.push({ profileId, label: s.title, initCommand: `cd ${shq(s.cwd || '.')} && ${env}codex exec resume ${shq(s.id)}` , ts: Date.now() })
  return { success:true }
}
export async function launchCodexSession(req) {
  /**
   * @register_router codex-sessions/launch
   * @method POST
   */
  if (req.body?.kind !== 'new') return { success:false, error:'kind inválido' }
  pending.push({ profileId:'default', label:'Nova sessão Codex', initCommand:'codex', ts:Date.now() })
  return { success:true }
}
export async function pendingCodexSessions() {
  /**
   * @register_router codex-sessions/pending
   * @method GET
   */
  return { success:true, opens: pending.splice(0, pending.length) }
}
