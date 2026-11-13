import { readConfig } from './config.js'

export async function githubRequest(path, { method = 'GET', body } = {}) {
  const { token } = await readConfig()
  if (!token) throw new Error('Configure o token do GitHub em Settings > Chaves de integrações > GitHub.')
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text.slice(0, 500) } }
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${data?.message || response.statusText}`)
  return data
}

export function repositoryPath(owner, repo, suffix = '') {
  const safeOwner = String(owner || '').trim()
  const safeRepo = String(repo || '').trim()
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(safeOwner)) throw new Error('Owner do GitHub inválido.')
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(safeRepo) || safeRepo === '.' || safeRepo === '..') throw new Error('Repositório inválido.')
  return `/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}${suffix}`
}
