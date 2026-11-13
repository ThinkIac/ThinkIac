





import { existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { discoverTerminalCodexAccounts } from '../llm/terminal_accounts.js'

const CODEX_BINARY = process.env.CODEX_BINARY || 'codex'
const REQUEST_TIMEOUT_MS = 20_000
const CACHE_MS = 60_000
const MAX_STDERR = 2_000
const cache = new Map()

function accountName(name) {
  return name?.startsWith('terminal:') ? name.slice('terminal:'.length) : name
}

function accountEnv(account) {
  const env = { ...process.env, HOME: account.home, CODEX_HOME: account.config_dir }
  for (const key of Object.keys(env)) {
    if (key.startsWith('XDG_')) delete env[key]
  }
  return env
}

function rpcLine(method, id, params = {}) {
  return `${JSON.stringify({ method, id, params })}\n`
}

function friendlyError(error, stderr = '') {
  const detail = String(stderr || error?.message || '').trim()
  if (/not logged in|authentication|unauthorized|401/i.test(detail)) return 'sessão expirada; faça login novamente'
  if (/ENOENT|not found/i.test(detail)) return 'Codex CLI não encontrado'
  if (/timed out|timeout/i.test(detail)) return 'consulta excedeu o tempo limite'
  return detail.split('\n').pop()?.slice(0, 220) || 'quota indisponível'
}

/**
 * Abre um app-server efêmero, consulta conta/limites/atividade e encerra assim
 * que as três respostas chegam. O processo não recebe prompts nem acesso novo:
 * ele usa apenas a autenticação já persistida pelo próprio Codex no perfil.
 */
function readAccount(account) {
  return new Promise((resolve) => {
    let settled = false
    let stdoutBuffer = ''
    let stderr = ''
    const replies = new Map()
    let child
    let timer

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child && !child.killed) child.kill('SIGTERM')
      resolve(result)
    }

    const maybeFinish = () => {
      if (![1, 2, 3, 4].every(id => replies.has(id))) return
      const failure = [1, 2, 3].map(id => replies.get(id)?.error).find(Boolean)
      if (failure) {
        finish({ ok: false, error: friendlyError(new Error(failure.message), stderr) })
        return
      }
      const accountResult = replies.get(2)?.result || {}
      const limitsResult = replies.get(3)?.result || {}
      const usageResult = replies.get(4)?.result || null
      finish({
        ok: true,
        account: accountResult.account || null,
        requiresOpenaiAuth: !!accountResult.requiresOpenaiAuth,
        rateLimits: limitsResult.rateLimits || null,
        rateLimitsByLimitId: limitsResult.rateLimitsByLimitId || null,
        rateLimitResetCredits: limitsResult.rateLimitResetCredits || null,
        usage: usageResult,
      })
    }

    try {
      child = spawn(CODEX_BINARY, ['app-server', '--stdio'], {
        env: accountEnv(account),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ ok: false, error: friendlyError(error) })
      return
    }

    timer = setTimeout(() => {
      finish({ ok: false, error: friendlyError(new Error('timeout'), stderr) })
    }, REQUEST_TIMEOUT_MS)

    child.on('error', error => finish({ ok: false, error: friendlyError(error, stderr) }))
    child.stderr.on('data', chunk => {
      if (stderr.length < MAX_STDERR) stderr += String(chunk).slice(0, MAX_STDERR - stderr.length)
    })
    child.stdout.on('data', chunk => {
      stdoutBuffer += String(chunk)
      let newline
      while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newline).trim()
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (!line) continue
        try {
          const message = JSON.parse(line)
          if (message.id != null) replies.set(Number(message.id), message)
        } catch {
          
        }
      }
      maybeFinish()
    })
    child.on('close', () => {
      if (!settled) finish({ ok: false, error: friendlyError(new Error('Codex encerrou sem responder'), stderr) })
    })

    child.stdin.write(rpcLine('initialize', 1, {
      clientInfo: { name: 'thinkiac-codex-quota', title: 'Thinkiac Codex Quota', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    }))
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
    child.stdin.write(rpcLine('account/read', 2, { refreshToken: false }))
    child.stdin.write(rpcLine('account/rateLimits/read', 3))
    child.stdin.write(rpcLine('account/usage/read', 4))
  })
}

/**
 * Consome um crédito de reset usando o app-server do próprio perfil. A ação
 * nunca recebe nem devolve o token do Codex, e o navegador deve pedir
 * confirmação antes de chegar aqui.
 */
function consumeResetCredit(account) {
  return new Promise((resolve) => {
    let settled = false
    let stdoutBuffer = ''
    let stderr = ''
    let child
    let timer

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child && !child.killed) child.kill('SIGTERM')
      resolve(result)
    }

    try {
      child = spawn(CODEX_BINARY, ['app-server', '--stdio'], {
        env: accountEnv(account),
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish({ ok: false, error: friendlyError(error) })
      return
    }

    timer = setTimeout(() => finish({ ok: false, error: friendlyError(new Error('timeout'), stderr) }), REQUEST_TIMEOUT_MS)
    child.on('error', error => finish({ ok: false, error: friendlyError(error, stderr) }))
    child.stderr.on('data', chunk => {
      if (stderr.length < MAX_STDERR) stderr += String(chunk).slice(0, MAX_STDERR - stderr.length)
    })
    child.stdout.on('data', chunk => {
      stdoutBuffer += String(chunk)
      let newline
      while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newline).trim()
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (!line) continue
        try {
          const message = JSON.parse(line)
          if (Number(message.id) !== 2) continue
          if (message.error) return finish({ ok: false, error: friendlyError(new Error(message.error.message), stderr) })
          return finish({ ok: true, result: message.result || null })
        } catch {
          
        }
      }
    })
    child.on('close', () => {
      if (!settled) finish({ ok: false, error: friendlyError(new Error('Codex encerrou sem responder'), stderr) })
    })

    child.stdin.write(rpcLine('initialize', 1, {
      clientInfo: { name: 'thinkiac-codex-quota', title: 'Thinkiac Codex Quota', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    }))
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`)
    child.stdin.write(rpcLine('account/rateLimitResetCredit/consume', 2))
  })
}

async function fetchAccount(account, force = false) {
  const name = accountName(account.name)
  if (!existsSync(join(account.config_dir, 'auth.json'))) {
    return { name, ok: false, error: 'sem login' }
  }

  const cached = cache.get(account.config_dir)
  if (!force && cached && Date.now() - cached.timestamp < CACHE_MS) {
    return { name, cached: true, ...cached.data }
  }

  const data = await readAccount(account)
  if (data.ok) cache.set(account.config_dir, { timestamp: Date.now(), data })
  return { name, ...data }
}

export async function codexUsage(req) {
  /**
   * @register_router codex-usage
   * @method GET
   *
   * `?refresh=1` ignora o cache. A resposta contém apenas metadados de conta,
   * snapshots de quota e atividade agregada; nenhuma credencial é exposta.
   */
  try {
    const force = String(req?.query?.refresh || '') === '1'
    const accounts = await Promise.all(discoverTerminalCodexAccounts().map(a => fetchAccount(a, force)))
    return {
      success: true,
      accounts,
      logged_in: accounts.length,
      updatedAt: Math.floor(Date.now() / 1000),
    }
  } catch (error) {
    return { success: false, accounts: [], logged_in: 0, error: error.message || 'falha ao consultar quotas' }
  }
}

export async function resetCodexUsage(req) {
  /**
   * @register_router codex-usage/:name/reset
   * @method POST
   *
   * Consome um crédito de reset da conta indicada. O endpoint só atende
   * perfis de Terminal descobertos localmente e invalida a quota em cache.
   */
  try {
    const name = accountName(req?.params?.name)
    const account = discoverTerminalCodexAccounts().find(item => accountName(item.name) === name)
    if (!account || !existsSync(join(account.config_dir, 'auth.json'))) {
      return { success: false, error: 'perfil Codex não encontrado ou sem login' }
    }
    const result = await consumeResetCredit(account)
    if (!result.ok) return { success: false, error: result.error || 'não foi possível consumir o reset' }
    cache.delete(account.config_dir)
    return { success: true, reset: result.result }
  } catch (error) {
    return { success: false, error: error.message || 'falha ao consumir o reset' }
  }
}
