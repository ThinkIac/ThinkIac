import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { classifyCliFailure } from './cli_failures.js'
import { requestCodexApproval } from './codex_approval.js'



export function runCodexAppServer({ bin, args, input, cwd, env, model, sessionId,
  resumeThreadId = null, onThread = null,
  timeoutMs = 120_000, signal, onToken, onProgress, approvalTimeoutMs,
  executionMode = 'runtime-controlled', requestApproval = requestCodexApproval } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Codex cancelado.'), { name: 'AbortError' })); return }
    const lifecycle = new AbortController()
    let child, lines, timer, killTimer, performedAction = false, done = false, seq = 0, stderr = '', text = '', threadId
    const pending = new Map()
    const items = new Map()
    let approvalsPending = 0, completedTurnId = null, activeTurnId = null
    const armTimeout = () => {
      clearTimeout(timer)
      if (!done && !approvalsPending && timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => finish(new Error(`Codex excedeu ${timeoutMs}ms.`)), timeoutMs)
      }
    }
    const finish = (error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      lifecycle.abort()
      for (const rpc of pending.values()) rpc.reject(error ?? new Error('Codex encerrado.'))
      pending.clear()
      lines?.close()
      child?.stdin.end()
      child?.kill('SIGTERM')
      if (child) {
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
        killTimer.unref()
      }
      if (error) {
        error.noRetry = performedAction
        error.stderr = stderr
        error.failureKind = classifyCliFailure(`${error.message} ${stderr}`)
        reject(error)
      } else {
        resolve({ choices: [{ message: { content: text, tool_calls: undefined }, finish_reason: 'stop' }], model, threadId, turnId: completedTurnId })
      }
    }
    const abort = () => finish(Object.assign(new Error('Codex cancelado.'), { name: 'AbortError' }))
    const send = (message) => { if (!done) child.stdin.write(`${JSON.stringify(message)}\n`) }
    const rpc = (method, params) => new Promise((resolve, reject) => {
      if (done) { reject(new Error('Codex encerrado.')); return }
      const id = ++seq
      pending.set(id, { resolve, reject, method })
      send({ id, method, params })
    })
    try {
      child = spawn(bin, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) { finish(error); return }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    armTimeout()
    child.on('error', finish)
    child.stdin.on('error', error => { if (!done) finish(error) })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000) })
    child.on('close', code => {
      clearTimeout(killTimer)
      if (!done) finish(new Error(`Codex encerrou antes de concluir o turno (${code}): ${stderr.slice(-2000)}`))
    })
    lines = createInterface({ input: child.stdout })
    const handle = async message => {
      if (message.id != null && !message.method) {
        const task = pending.get(message.id)
        if (!task) return
        pending.delete(message.id)
        if (message.error) task.reject(new Error(message.error.message ?? JSON.stringify(message.error)))
        else {
          if (task.method === 'turn/start') activeTurnId = message.result?.turn?.id || null
          task.resolve(message.result)
        }
        return
      }
      if (message.id != null && message.method) {
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(message.method)) {
          if (!threadId || message.params?.threadId !== threadId) {
            send({ id: message.id, error: { code: -32602, message: 'Thread de aprovação inválida.' } }); return
          }
          const item = items.get(message.params.itemId)
          const request = { ...message, params: { ...message.params, ...(item ? { item } : {}) } }
          let decision
          approvalsPending++
          clearTimeout(timer)
          try {
            decision = await requestApproval(request, { sessionId, signal: lifecycle.signal, timeoutMs: approvalTimeoutMs })
          } catch { decision = { decision: 'decline' } }
          finally { approvalsPending--; armTimeout() }
          const accepted = decision?.decision === 'accept'
          const result = message.method === 'item/permissions/requestApproval'
            ? { permissions: accepted ? message.params.permissions : {}, scope: 'turn' }
            : { decision: accepted ? 'accept' : 'decline' }
          send({ id: message.id, result })
        } else {
          
          send({ id: message.id, error: { code: -32601, message: `Pedido Codex não suportado: ${message.method}` } })
        }
        return
      }
      const p = message.params ?? {}
      if (threadId && p.threadId && p.threadId !== threadId) return
      if (message.method === 'item/started' || message.method === 'item/completed') {
        const item = p.item ?? {}
        items.set(item.id, item)
        if (item.type === 'agentMessage' && message.method === 'item/completed') {
          if (item.phase === 'commentary') onProgress?.({ type: 'reasoning', text: item.text ?? '' })
          else text = item.text ?? text
        } else if (['commandExecution', 'fileChange', 'mcpToolCall'].includes(item.type)) {
          performedAction = true
          const runtimeControlled = executionMode === 'runtime-controlled' && item.type === 'mcpToolCall'
          const details = {
            itemId: item.id, threadId, name: item.tool ?? item.server ?? item.type,
            origin: runtimeControlled ? 'runtime' : 'codex-native',
            governed: runtimeControlled,
          }
          if (message.method === 'item/started') onProgress?.({ type: 'tool-step', ...details, input: item.command ?? item.arguments ?? item.changes })
          else onProgress?.({ type: 'tool-result', ...details, coverage: 'partial', content: String(item.aggregatedOutput ?? JSON.stringify(item.result ?? item.changes ?? '')).slice(0, 4000) })
        }
      } else if (message.method === 'item/reasoning/summaryTextDelta') {
        onProgress?.({ type: 'reasoning', text: p.delta ?? '' })
      } else if (message.method === 'thread/tokenUsage/updated') {
        onProgress?.({ type: 'codex-usage', usage: p.tokenUsage?.last ?? p.tokenUsage?.total })
      } else if (message.method === 'turn/completed') {
        if (!activeTurnId || p.turn?.id !== activeTurnId) return
        if (p.turn?.status !== 'completed') finish(new Error(p.turn?.error?.message ?? `Turno Codex ${p.turn?.status ?? 'falhou'}.`))
        else { completedTurnId = p.turn?.id || null; if (text) onToken?.(text); finish() }
      } else if (message.method === 'error' && !p.willRetry) {
        finish(new Error(p.error?.message ?? 'Erro Codex.'))
      }
    }
    lines.on('line', line => {
      let message
      try { message = JSON.parse(line) } catch { finish(new Error('Resposta inválida do Codex App Server.')); return }
      handle(message).catch(finish)
    })
    ;(async () => {
      await rpc('initialize', { clientInfo: { name: 'agent', version: '1.0.0' }, capabilities: {} })
      send({ method: 'initialized', params: {} })
      const started = await rpc(resumeThreadId ? 'thread/resume' : 'thread/start', {
        ...(resumeThreadId ? { threadId: resumeThreadId } : {}), cwd, ...(model ? { model } : {}),
      })
      threadId = started.thread.id
      await onThread?.({ threadId, resumed: Boolean(resumeThreadId) })
      await rpc('turn/start', { threadId, input: [{ type: 'text', text: input, text_elements: [] }] })
    })().catch(finish)
  })
}
