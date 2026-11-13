import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRIVATE = path.join(ROOT, '.private')
const CONFIG = path.join(PRIVATE, 'settings.json')

export async function readConfig() {
  try {
    return { token: '', name: '', email: '', privateKey: '', publicKey: '', ...JSON.parse(await fs.readFile(CONFIG, 'utf8')) }
  } catch (error) {
    if (error.code === 'ENOENT') return { token: '', name: '', email: '', privateKey: '', publicKey: '' }
    throw error
  }
}

export async function saveConfig(values) {
  const current = await readConfig()
  const next = {
    ...current,
    name: String(values.name ?? current.name).trim(),
    email: String(values.email ?? current.email).trim(),
    token: String(values.token ?? current.token).trim(),
  }
  await fs.mkdir(PRIVATE, { recursive: true, mode: 0o700 })
  await fs.writeFile(CONFIG, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await fs.chmod(CONFIG, 0o600)
  return next
}

export function privateDirectory() { return PRIVATE }
