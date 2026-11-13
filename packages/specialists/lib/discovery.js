// specialists/lib/discovery.js — leitura e parsing de AGENT.md em todo o runtime.
//
// Fonte única de descoberta: qualquer pacote com um AGENT.md na raiz vira um
// "especialista genérico" candidato. `aurora/core/skills.js` reusa exatamente
// este módulo para o roteamento de skills — antes cada um tinha seu próprio
// scanner + parser de frontmatter, e os dois podiam divergir silenciosamente.

import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))          // .../specialists/lib
const SPECIALISTS_DIR = join(PKG_DIR, '..')                       // .../specialists
export const PACKAGES_DIR = join(SPECIALISTS_DIR, '..')           // .../packages
export const PROJECT_DIR = join(PACKAGES_DIR, '..')               // .../thinkiac

function sourcePath(path) {
  return path.startsWith(PROJECT_DIR + '/') ? path.slice(PROJECT_DIR.length + 1) : path
}

export function sha256(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

// ── Frontmatter ──────────────────────────────────────────────────────────

export function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: content.trim() }
  const meta = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: m[2].trim() }
}

export const isTrue = (v) => typeof v === 'string' && v.trim().toLowerCase() === 'true'

export function parseCommaList(value) {
  if (typeof value !== 'string') return null
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

export function firstHeading(body) {
  const m = body.match(/^#{1,3}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * Lista os diretórios de pacotes existentes (exclui ocultos e não-diretórios).
 */
export function listPackageDirs() {
  if (!existsSync(PACKAGES_DIR)) return []
  return readdirSync(PACKAGES_DIR).filter(d => {
    if (d.startsWith('.')) return false
    try { return statSync(join(PACKAGES_DIR, d)).isDirectory() } catch { return false }
  })
}

/**
 * Descobre e parseia todo AGENT.md do runtime — um por pacote, mais o AGENT.md
 * raiz do projeto (quando existir e `includeRoot` não for desligado).
 *
 * @param {object} opts
 * @param {string[]} opts.excludePackages - pacotes a pular (ex.: ['aurora'] pro
 *   roteador de skills, que trata o AGENT.md da própria aurora como a
 *   personality base, não como uma skill roteável).
 * @param {boolean} opts.includeRoot - inclui o AGENT.md na raiz do projeto.
 * @returns {Array<{pkg, name, description, language, pinned, event, tools, body, absolutePath, path, hash}>}
 */
export function discoverAgentFiles({ excludePackages = [], includeRoot = true } = {}) {
  const exclude = new Set(excludePackages)
  const entries = []

  for (const pkg of listPackageDirs()) {
    if (exclude.has(pkg)) continue
    const p = join(PACKAGES_DIR, pkg, 'AGENT.md')
    if (existsSync(p)) entries.push({ pkg, path: p })
  }

  if (includeRoot) {
    const rootAgent = join(PROJECT_DIR, 'AGENT.md')
    if (existsSync(rootAgent)) entries.push({ pkg: null, path: rootAgent })
  }

  const files = []
  for (const { pkg, path } of entries) {
    let raw
    try { raw = readFileSync(path, 'utf8') } catch { continue }
    const { meta, body } = parseFrontmatter(raw)
    if (!body) continue
    files.push({
      pkg,
      name: meta.name || (pkg ? pkg : basename(dirname(path))),
      description: meta.description || firstHeading(body),
      language: meta.language || null,
      pinned: isTrue(meta.always) || isTrue(meta.alway), // aceita o typo comum
      event: meta.event || null,
      tools: parseCommaList(meta.tools),
      body,
      absolutePath: path,
      path: sourcePath(path),
      hash: sha256(raw),
    })
  }
  return files
}

/**
 * Uma única entrada, pelo nome do pacote dono do AGENT.md (ou null pro raiz).
 */
export function readAgentFile(pkg) {
  const path = pkg ? join(PACKAGES_DIR, pkg, 'AGENT.md') : join(PROJECT_DIR, 'AGENT.md')
  if (!existsSync(path)) return null
  return discoverAgentFiles({ includeRoot: !pkg }).find(f => f.pkg === pkg) ?? null
}
