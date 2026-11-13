import { existsSync } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function inside(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

function labelFor(directory) {
  return path.basename(directory) || directory
}

/**
 * Cria um resolvedor de diretórios. A entrada do cliente nunca é confiada: o
 * caminho e cada symlink são resolvidos antes da autorização.
 */
export function createWorkspaceResolver(roots) {
  const configuredRoots = [...new Set((roots || []).filter(Boolean))]

  async function allowedRoots() {
    const result = []
    for (const configured of configuredRoots) {
      try {
        const resolved = await realpath(configured)
        if ((await lstat(resolved)).isDirectory()) result.push(resolved)
      } catch { /* raiz removida: não a anunciamos */ }
    }
    return [...new Set(result)]
  }

  async function resolve(candidate) {
    if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('Workspace is required')
    let resolved
    try {
      resolved = await realpath(candidate)
      if (!(await lstat(resolved)).isDirectory()) throw new Error('Not a directory')
    } catch (error) {
      if (error.message === 'Not a directory') throw error
      throw new Error('Workspace does not exist or is unavailable')
    }
    const root = (await allowedRoots()).find((item) => inside(resolved, item))
    if (!root) throw new Error('Workspace is not allowed')
    return { path: resolved, root, label: labelFor(resolved) }
  }

  async function list(candidate) {
    const selected = await resolve(candidate)
    const entries = []
    for (const entry of await readdir(selected.path, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const child = path.join(selected.path, entry.name)
      try {
        const resolvedChild = await resolve(child)
        if (resolvedChild.root === selected.root) entries.push({ name: entry.name, path: resolvedChild.path })
      } catch { /* arquivo, link quebrado ou escape: não expor */ }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    const parentPath = path.dirname(selected.path)
    return {
      ...selected,
      parent: selected.path === selected.root ? null : parentPath,
      entries,
    }
  }

  return {
    listRoots: async () => (await allowedRoots()).map((item) => ({ path: item, label: labelFor(item) })),
    resolve,
    list,
  }
}

export function findGitRoot(start = process.cwd()) {
  let current = path.resolve(start)
  try {
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: current,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (topLevel) return path.resolve(topLevel)
  } catch { /* Git ausente ou diretório fora de um worktree: usa fallback */ }

  while (true) {
    if (existsSync(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function workspaceRootsFromEnv(defaultRoot = process.cwd(), envValue = process.env.AGENT_WORKSPACE_ROOTS) {
  const automaticRoot = findGitRoot(defaultRoot) || path.resolve(defaultRoot)
  const configured = (envValue || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
  return [...new Set([automaticRoot, ...configured])]
}

/**
 * Resolve as raízes autorizadas a partir da localização do módulo Agent.
 * Isso torna a escolha independente do cwd adotado pelo supervisor do runtime.
 */
export function workspaceRootsFromModule(moduleUrl, envValue = process.env.AGENT_WORKSPACE_ROOTS) {
  return workspaceRootsFromEnv(path.dirname(fileURLToPath(moduleUrl)), envValue)
}

export async function resolveWorkspaceSelection(resolver, storedWorkspace = null) {
  if (storedWorkspace?.path) return resolver.resolve(storedWorkspace.path)
  const [defaultRoot] = await resolver.listRoots()
  return defaultRoot ? resolver.resolve(defaultRoot.path) : null
}
