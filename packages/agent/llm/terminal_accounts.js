









import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { ANTIGRAVITY } from './antigravity_cli.js'
import { GEMINI } from './gemini_cli.js'
import { OPENCODE } from './opencode_cli.js'
import { fileURLToPath } from 'url'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const TERMINAL_PROFILES_DIR = join(PKG_DIR, '..', 'terminal', 'profiles')


const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

/** Lista perfis do Terminal que já têm login do Claude Code feito (conta ativa). */
export function discoverTerminalProfileAccounts() {
  if (!existsSync(TERMINAL_PROFILES_DIR)) return []

  let entries
  try {
    entries = readdirSync(TERMINAL_PROFILES_DIR, { withFileTypes: true })
  } catch {
    return []
  }

  return entries
    .filter(d => d.isDirectory() && PROFILE_NAME_RE.test(d.name))
    .map(d => {
      const home = join(TERMINAL_PROFILES_DIR, d.name)
      return {
        name: `terminal:${d.name}`,
        
        
        
        
        
        
        
        
        config_dir: join(home, '.claude'),
        home,
        source: 'terminal-profile',
      }
    })
    .filter(a => existsSync(join(a.config_dir, '.credentials.json')))
}

/**
 * Junta contas registradas manualmente (tela Claude Accounts / agent.config.json)
 * com as auto-descobertas nos perfis do Terminal, sem duplicar por config_dir.
 * Em conflito, a conta manual prevalece (permite override explícito).
 */
export function mergeWithTerminalAccounts(manualAccounts = []) {
  const discovered = discoverTerminalProfileAccounts()
  if (!discovered.length) return manualAccounts

  const known = new Set(manualAccounts.map(a => a.config_dir))
  return [...manualAccounts, ...discovered.filter(a => !known.has(a.config_dir))]
}





export function discoverTerminalCodexAccounts() {
  if (!existsSync(TERMINAL_PROFILES_DIR)) return []
  let entries
  try { entries = readdirSync(TERMINAL_PROFILES_DIR, { withFileTypes: true }) } catch { return [] }

  return entries
    .filter(d => d.isDirectory() && PROFILE_NAME_RE.test(d.name))
    .map(d => {
      const home = join(TERMINAL_PROFILES_DIR, d.name)
      const config_dir = join(home, '.codex')
      return { name: `terminal:${d.name}`, config_dir, home, source: 'terminal-profile' }
    })
    .filter(a => existsSync(join(a.config_dir, 'auth.json')))
}

export function mergeWithTerminalCodexAccounts(manualAccounts = []) {
  const discovered = discoverTerminalCodexAccounts()
  const known = new Set(manualAccounts.map(a => a.config_dir))
  return [...manualAccounts, ...discovered.filter(a => !known.has(a.config_dir))]
}

/**
 * Modelos que o próprio Codex CLI anunciou para contas autenticadas do
 * Terminal. O cache é apenas um catálogo público da CLI: nunca lemos nem
 * expomos auth.json. Falhas e caches ausentes deixam a lista vazia para que o
 * catálogo estático configurado no Agent continue funcionando.
 */
export function discoverTerminalCodexModels(accounts = discoverTerminalCodexAccounts()) {
  const byId = new Map()
  for (const account of accounts) {
    try {
      const cache = JSON.parse(readFileSync(join(account.config_dir, 'models_cache.json'), 'utf8'))
      for (const item of Array.isArray(cache?.models) ? cache.models : []) {
        const id = String(item?.slug ?? '').trim()
        if (!id || byId.has(id)) continue
        byId.set(id, {
          id,
          name: String(item.display_name ?? id),
          purpose: {
            name: 'Codex CLI',
            description: String(item.description ?? '').trim(),
          },
        })
      }
    } catch {
      
    }
  }
  return [...byId.values()]
}







export function discoverTerminalAntigravityAccounts() {
  if (!existsSync(TERMINAL_PROFILES_DIR)) return []
  let entries
  try { entries = readdirSync(TERMINAL_PROFILES_DIR, { withFileTypes: true }) } catch { return [] }

  return entries
    .filter(d => d.isDirectory() && PROFILE_NAME_RE.test(d.name))
    .map(d => {
      const home = join(TERMINAL_PROFILES_DIR, d.name)
      const config_dir = join(home, ANTIGRAVITY.homeDirName)
      return { name: `terminal:${d.name}`, config_dir, home, source: 'terminal-profile' }
    })
    .filter(a => existsSync(join(a.config_dir, ANTIGRAVITY.credentialFile)))
}

export function mergeWithTerminalAntigravityAccounts(manualAccounts = []) {
  const discovered = discoverTerminalAntigravityAccounts()
  const known = new Set(manualAccounts.map(a => a.config_dir))
  return [...manualAccounts, ...discovered.filter(a => !known.has(a.config_dir))]
}




export function discoverTerminalGeminiAccounts() {
  if (!existsSync(TERMINAL_PROFILES_DIR)) return []
  let entries
  try { entries = readdirSync(TERMINAL_PROFILES_DIR, { withFileTypes: true }) } catch { return [] }

  return entries
    .filter(d => d.isDirectory() && PROFILE_NAME_RE.test(d.name))
    .map(d => {
      const home = join(TERMINAL_PROFILES_DIR, d.name)
      return { name: `terminal:${d.name}`, config_dir: join(home, GEMINI.homeDirName), home, source: 'terminal-profile' }
    })
    .filter(a => existsSync(join(a.config_dir, GEMINI.credentialFile)))
}

export function mergeWithTerminalGeminiAccounts(manualAccounts = []) {
  const discovered = discoverTerminalGeminiAccounts()
  const known = new Set(manualAccounts.map(a => a.config_dir))
  return [...manualAccounts, ...discovered.filter(a => !known.has(a.config_dir))]
}




export function discoverTerminalOpencodeAccounts() {
  if (!existsSync(TERMINAL_PROFILES_DIR)) return []
  let entries
  try { entries = readdirSync(TERMINAL_PROFILES_DIR, { withFileTypes: true }) } catch { return [] }

  return entries
    .filter(d => d.isDirectory() && PROFILE_NAME_RE.test(d.name))
    .map(d => {
      const home = join(TERMINAL_PROFILES_DIR, d.name)
      const authFile = join(home, OPENCODE.dataDir, OPENCODE.credentialFile)
      return { name: `terminal:${d.name}`, config_dir: authFile, home, source: 'terminal-profile' }
    })
    .filter(a => existsSync(a.config_dir))
}

export function mergeWithTerminalOpencodeAccounts(manualAccounts = []) {
  const discovered = discoverTerminalOpencodeAccounts()
  const known = new Set(manualAccounts.map(a => a.config_dir))
  return [...manualAccounts, ...discovered.filter(a => !known.has(a.config_dir))]
}
