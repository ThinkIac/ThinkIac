import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { privateDirectory, readConfig, saveConfig } from './config.js'

const exec = promisify(execFile)
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPOS_ROOT = path.join(privateDirectory(), 'repos')

function safeRepo(repo) {
  const name = String(repo || '').trim()
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..') throw new Error('Nome de repositório local inválido.')
  return name
}

function safeBranch(branch) {
  const value = String(branch || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(value) || value.includes('..') || value.includes('@{') || value.endsWith('/') || value.endsWith('.') || value.endsWith('.lock')) throw new Error('Nome de branch inválido.')
  return value
}

export function repositoryDirectory(repo) { return path.join(REPOS_ROOT, safeRepo(repo)) }

async function ensureKey() {
  const settings = await readConfig()
  if (!settings.privateKey || !settings.publicKey) {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    // Convert the raw Ed25519 public key to the OpenSSH wire format.
    const raw = publicKey.subarray(-32)
    const type = Buffer.from('ssh-ed25519')
    const field = value => Buffer.concat([Buffer.from([0, 0, 0, value.length]), value])
    const blob = Buffer.concat([field(type), field(raw)])
    const opensshPublic = `ssh-ed25519 ${blob.toString('base64')} thinkiac-github`
    settings.privateKey = privateKey
    settings.publicKey = opensshPublic
    await fs.mkdir(privateDirectory(), { recursive: true, mode: 0o700 })
    await fs.writeFile(path.join(privateDirectory(), 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
    await fs.chmod(path.join(privateDirectory(), 'settings.json'), 0o600)
  }
  return settings
}

export async function publicSshKey() { return (await ensureKey()).publicKey }

async function git(repo, args) {
  const cwd = repositoryDirectory(repo)
  await fs.mkdir(REPOS_ROOT, { recursive: true, mode: 0o700 })
  const settings = await ensureKey()
  const keyFile = path.join(privateDirectory(), 'github_ed25519')
  await fs.writeFile(keyFile, settings.privateKey, { mode: 0o600 })
  await fs.chmod(keyFile, 0o600)
  const sshCommand = `ssh -i "${keyFile}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
  const { stdout } = await exec('git', ['-c', `core.sshCommand=${sshCommand}`, ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: sshCommand },
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trim()
}

export async function cloneRepository({ owner, repo, defaultBranch } = {}) {
  safeRepo(repo)
  await fs.mkdir(REPOS_ROOT, { recursive: true, mode: 0o700 })
  const target = repositoryDirectory(repo)
  try { await fs.access(path.join(target, '.git')); throw new Error(`O repositório ${repo} já foi clonado.`) }
  catch (error) { if (error.message.includes('já foi clonado')) throw error }
  const settings = await ensureKey()
  const keyFile = path.join(privateDirectory(), 'github_ed25519')
  await fs.writeFile(keyFile, settings.privateKey, { mode: 0o600 })
  await fs.chmod(keyFile, 0o600)
  const sshCommand = `ssh -i "${keyFile}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`
  const cloneArgs = ['clone']
  if (defaultBranch) cloneArgs.push('--branch', safeBranch(defaultBranch))
  cloneArgs.push(`git@github.com:${owner}/${repo}.git`, target)
  await exec('git', cloneArgs, {
    cwd: PACKAGE_ROOT, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: sshCommand }, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  })
  const { name, email } = await readConfig()
  if (name) await exec('git', ['config', 'user.name', name], { cwd: target })
  if (email) await exec('git', ['config', 'user.email', email], { cwd: target })
  return { path: target }
}

export async function setGitIdentity(repo, name, email) {
  const settings = await readConfig()
  const next = await saveConfig({ name: name ?? settings.name, email: email ?? settings.email, token: settings.token })
  const cwd = repositoryDirectory(repo)
  await exec('git', ['config', 'user.name', next.name], { cwd })
  await exec('git', ['config', 'user.email', next.email], { cwd })
  return { name: next.name, email: next.email }
}

export async function pullRepository(repo, branch) {
  const args = ['pull', '--ff-only', 'origin']
  if (branch) args.push(safeBranch(branch))
  return { output: await git(repo, args) }
}

export async function pushRepository(repo, branch, message) {
  const cwd = repositoryDirectory(repo)
  const { name, email } = await readConfig()
  if (name) await exec('git', ['config', 'user.name', name], { cwd })
  if (email) await exec('git', ['config', 'user.email', email], { cwd })
  await git(repo, ['add', '--all'])
  const status = await git(repo, ['status', '--porcelain'])
  if (status) {
    if (!String(message || '').trim()) throw new Error('Informe uma mensagem de commit quando houver alterações locais.')
    await git(repo, ['commit', '-m', String(message).slice(0, 500)])
  }
  const args = ['push', '-u', 'origin']
  if (branch) args.push(safeBranch(branch))
  return { output: await git(repo, args), committed: Boolean(status) }
}

export async function createBranch(repo, branch, from = 'HEAD') {
  const name = safeBranch(branch)
  await git(repo, ['switch', '-c', name, from])
  return { branch: name }
}

export async function localBranches(repo) {
  const output = await git(repo, ['branch', '--format=%(refname:short)'])
  return { branches: output ? output.split('\n') : [] }
}
