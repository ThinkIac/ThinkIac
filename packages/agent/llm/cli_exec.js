

















import { spawn } from 'node:child_process'
import { classifyCliFailure, describeCliFailure } from './cli_failures.js'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024 










const BENIGN_STDERR = [
  /Ignoring \d+ permissions?\.allow entries/i,
  /has not been trusted/i,
  /Run Claude Code interactively here once/i,
]

function stripBenign(text) {
  return String(text || '')
    .split('\n')
    .filter(line => line.trim() && !BENIGN_STDERR.some(re => re.test(line)))
    .join(' ')
    .trim()
}




function ndjsonErrors(stdout) {
  const out = []
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim()
    if (!t || t[0] !== '{') continue
    let obj
    try { obj = JSON.parse(t) } catch { continue }
    if (Array.isArray(obj?.errors) && obj.errors.length) {
      for (const e of obj.errors) out.push(typeof e === 'string' ? e : JSON.stringify(e))
    } else if (obj?.is_error && typeof obj.result === 'string') {
      out.push(obj.result)
    
    
    
    
    } else if (obj?.type === 'error' && typeof obj.message === 'string') {
      out.push(obj.message)
    } else if (obj?.type === 'turn.failed' && typeof obj.error?.message === 'string') {
      out.push(obj.error.message)
    }
  }
  return out.join(' | ').trim()
}



function analyzeFailure(stderr, stdout, bin, account) {
  
  
  const detail = (
    ndjsonErrors(stdout) ||
    stripBenign(stderr) ||
    String(stderr || stdout || '')
  ).replace(/\s+/g, ' ').trim()
  
  
  
  
  
  
  if (bin === 'codex' && /401|missing bearer|unauthorized|not logged in|please login/i.test(detail)) {
    const hint = 'No Codex account is logged in. Open a Terminal profile and run `codex login` — Agent auto-discovers any logged-in profile.'
    return { suffix: detail ? `: ${hint} (codex: ${detail.slice(0, 800)})` : `: ${hint}`, kind: 'auth' }
  }
  
  
  
  const kind = classifyCliFailure(detail)
  const explanation = describeCliFailure(kind, { bin, account })
  if (explanation) {
    return { suffix: detail ? `: ${explanation} (${bin}: ${detail.slice(0, 800)})` : `: ${explanation}`, kind }
  }
  return { suffix: detail ? `: ${detail.slice(0, 1200)}` : '', kind }
}

/**
 * Executa um binário CLI local, envia `input` via stdin e resolve com o stdout.
 *
 * @param {object} opts
 * @param {string}   opts.bin         - binário a executar (ex: "claude", "ollama")
 * @param {string[]} [opts.args]      - argv (sem o nome do binário)
 * @param {string}   opts.input       - conteúdo enviado via stdin (o prompt)
 * @param {string}   [opts.cwd]       - diretório de execução
 * @param {object}   [opts.env]       - variáveis de ambiente extras, mescladas com
 *                                      process.env (ex: { CLAUDE_CONFIG_DIR } pra
 *                                      isolar qual conta/login o binário usa)
 * @param {string}   [opts.accountLabel] - nome da conta do pool (só pra mensagem
 *                                      de erro: "Conta X está sem crédito")
 * @param {number}   [opts.timeoutMs=120000] - 0/null/Infinity desliga o timeout
 *                                      (necessário para tarefas longas de Engineer
 *                                      que podem ficar esperando um ask_user)
 * @param {number}   [opts.maxBuffer=10485760]
 * @param {AbortSignal} [opts.signal] - permite cancelar o subprocesso externamente
 * @returns {Promise<{ stdout: string, commandExecuted: string }>}
 * @throws {Error} com .commandExecuted, .stderr, .stdout, .killed, .signal anexados
 */
export function execCliProvider({
  bin,
  args = [],
  input,
  cwd,
  env,
  accountLabel = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBuffer = DEFAULT_MAX_BUFFER,
  signal,
}) {
  if (!bin || typeof bin !== 'string') {
    return Promise.reject(new Error('[cli_exec] "bin" é obrigatório (nome do binário CLI)'))
  }

  const commandExecuted = [bin, ...args].join(' ')

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(bin, args, {
        cwd: cwd || undefined,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      const reason = err.code === 'ENOENT' ? `binário "${bin}" não encontrado no PATH` : err.message
      const wrapped = new Error(`[cli:${bin}] ${reason}`)
      wrapped.commandExecuted = commandExecuted
      reject(wrapped)
      return
    }

    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let timedOut = false
    let externallyAborted = false

    const finish = (fn) => { if (!settled) { settled = true; fn() } }

    const hasTimeout = timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0
    const timeoutHandle = hasTimeout
      ? setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
      : null

    const onAbort = () => { externallyAborted = true; child.kill('SIGTERM') }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxBuffer) stdout = Buffer.concat([stdout, chunk])
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxBuffer) stderr = Buffer.concat([stderr, chunk])
    })

    child.on('error', (err) => {
      cleanup()
      finish(() => {
        const reason = err.code === 'ENOENT' ? `binário "${bin}" não encontrado no PATH` : err.message
        const { suffix, kind } = analyzeFailure(stderr.toString('utf8'), stdout.toString('utf8'), bin, accountLabel)
        const wrapped = new Error(`[cli:${bin}] ${reason}${suffix}`)
        wrapped.commandExecuted = commandExecuted
        wrapped.stderr = stderr.toString('utf8').trim()
        wrapped.stdout = stdout.toString('utf8').trim()
        wrapped.failureKind = kind
        wrapped.account = accountLabel
        reject(wrapped)
      })
    })

    child.on('close', (code, killSignal) => {
      cleanup()
      finish(() => {
        const out = stdout.toString('utf8').trim()
        const err = stderr.toString('utf8').trim()

        if (code === 0 && !timedOut && !externallyAborted) {
          resolve({ stdout: out, commandExecuted })
          return
        }

        const reason = timedOut
          ? `timeout após ${timeoutMs}ms`
          : externallyAborted
            ? 'abortado externamente'
            : `saiu com código ${code}${killSignal ? ` (sinal ${killSignal})` : ''}`

        const { suffix, kind } = analyzeFailure(err, out, bin, accountLabel)
        const wrapped = new Error(`[cli:${bin}] ${reason}${suffix}`)
        wrapped.commandExecuted = commandExecuted
        wrapped.stderr = err
        wrapped.stdout = out
        wrapped.killed = timedOut || externallyAborted
        wrapped.signal = killSignal || null
        wrapped.failureKind = kind
        wrapped.account = accountLabel
        reject(wrapped)
      })
    })

    child.stdin.on('error', () => { /* EPIPE etc. — 'close'/'error' do child tratam o resto */ })
    child.stdin.write(input ?? '')
    child.stdin.end()
  })
}

/**
 * Variante streaming: executa o binário CLI em modo NDJSON (--output-format
 * stream-json) e chama `onEvent(obj)` para cada linha JSON emitida no stdout,
 * em tempo real — sem esperar o processo terminar. É o que dá pro Agent
 * mostrar reasoning/tool-steps do Claude "acontecendo", igual OpenRouter,
 * em vez de só o texto final de uma vez (limitação documentada do modo -p).
 *
 * Faz o mesmo tratamento de timeout/abort/erro de execCliProvider. Além do
 * streaming via onEvent, ainda acumula o stdout bruto e resolve com ele, pra
 * quem quiser um fallback de parse pós-fato.
 *
 * @param {object}   opts            - mesmos campos de execCliProvider, mais:
 * @param {(evt:object)=>void} opts.onEvent - callback por linha JSON parseada.
 *                                      Linhas não-JSON são ignoradas (o CLI às
 *                                      vezes emite avisos soltos). Exceções
 *                                      lançadas por onEvent são engolidas pra
 *                                      não derrubar o parse do resto do stream.
 * @returns {Promise<{ stdout: string, commandExecuted: string }>}
 */
export function execCliProviderStream({
  bin,
  args = [],
  input,
  cwd,
  env,
  accountLabel = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBuffer = DEFAULT_MAX_BUFFER,
  signal,
  onEvent,
}) {
  if (!bin || typeof bin !== 'string') {
    return Promise.reject(new Error('[cli_exec] "bin" é obrigatório (nome do binário CLI)'))
  }
  if (typeof onEvent !== 'function') {
    return Promise.reject(new Error('[cli_exec] execCliProviderStream requer onEvent (use execCliProvider p/ modo não-streaming)'))
  }

  const commandExecuted = [bin, ...args].join(' ')

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(bin, args, {
        cwd: cwd || undefined,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      const reason = err.code === 'ENOENT' ? `binário "${bin}" não encontrado no PATH` : err.message
      const wrapped = new Error(`[cli:${bin}] ${reason}`)
      wrapped.commandExecuted = commandExecuted
      reject(wrapped)
      return
    }

    let rawOut = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let lineBuf = '' 
    let settled = false
    let timedOut = false
    let externallyAborted = false

    const finish = (fn) => { if (!settled) { settled = true; fn() } }

    const hasTimeout = timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0
    const timeoutHandle = hasTimeout
      ? setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, timeoutMs)
      : null

    const onAbort = () => { externallyAborted = true; child.kill('SIGTERM') }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const emitLine = (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let obj
      try {
        obj = JSON.parse(trimmed)
      } catch {
        return 
      }
      try {
        onEvent(obj)
      } catch (e) {
        
        console.warn(`[cli_exec] onEvent lançou (evento ignorado): ${e.message}`)
      }
    }

    child.stdout.on('data', (chunk) => {
      if (rawOut.length < maxBuffer) rawOut = Buffer.concat([rawOut, chunk])
      lineBuf += chunk.toString('utf8')
      let nl
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, nl)
        lineBuf = lineBuf.slice(nl + 1)
        emitLine(line)
      }
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxBuffer) stderr = Buffer.concat([stderr, chunk])
    })

    child.on('error', (err) => {
      cleanup()
      finish(() => {
        const reason = err.code === 'ENOENT' ? `binário "${bin}" não encontrado no PATH` : err.message
        const { suffix, kind } = analyzeFailure(stderr.toString('utf8'), rawOut.toString('utf8'), bin, accountLabel)
        const wrapped = new Error(`[cli:${bin}] ${reason}${suffix}`)
        wrapped.commandExecuted = commandExecuted
        wrapped.stderr = stderr.toString('utf8').trim()
        wrapped.stdout = rawOut.toString('utf8').trim()
        wrapped.failureKind = kind
        wrapped.account = accountLabel
        reject(wrapped)
      })
    })

    child.on('close', (code, killSignal) => {
      cleanup()
      if (lineBuf.length) emitLine(lineBuf) 
      finish(() => {
        const out = rawOut.toString('utf8').trim()
        const err = stderr.toString('utf8').trim()

        if (code === 0 && !timedOut && !externallyAborted) {
          resolve({ stdout: out, commandExecuted })
          return
        }

        const reason = timedOut
          ? `timeout após ${timeoutMs}ms`
          : externallyAborted
            ? 'abortado externamente'
            : `saiu com código ${code}${killSignal ? ` (sinal ${killSignal})` : ''}`

        const { suffix, kind } = analyzeFailure(err, out, bin, accountLabel)
        const wrapped = new Error(`[cli:${bin}] ${reason}${suffix}`)
        wrapped.commandExecuted = commandExecuted
        wrapped.stderr = err
        wrapped.stdout = out
        wrapped.killed = timedOut || externallyAborted
        wrapped.signal = killSignal || null
        wrapped.failureKind = kind
        wrapped.account = accountLabel
        reject(wrapped)
      })
    })

    child.stdin.on('error', () => { /* EPIPE etc. — 'close'/'error' do child tratam o resto */ })
    child.stdin.write(input ?? '')
    child.stdin.end()
  })
}
