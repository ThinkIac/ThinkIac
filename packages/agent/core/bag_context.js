import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(value).digest('hex')
const size = value => Buffer.byteLength(JSON.stringify(value))
const tokens = value => Math.ceil(JSON.stringify(value).length / 4)

export function refreshOperationalBag(system, content) {
  const start = '--- BEGIN UNTRUSTED CONTEXT (agent:bag) ---'
  const end = '--- END UNTRUSTED CONTEXT ---'
  const rendered = content ? `${start}\n${content.replace(/--- (BEGIN|END) UNTRUSTED CONTEXT/g, '[quoted boundary] $1 UNTRUSTED CONTEXT')}\n${end}` : ''
  const from = system.indexOf(start)
  const to = from < 0 ? -1 : system.indexOf(end, from + start.length)
  if (to >= 0) return system.slice(0, from) + rendered + system.slice(to + end.length)
  return content ? `${system}\n\n${rendered}` : system
}




export function compactBagReads(messages) {
  const calls = new Map()
  for (const message of messages) for (const call of message.tool_calls || []) {
    if (call.function?.name === 'read_file') calls.set(call.id, true)
  }
  const seen = new Map()
  const output = messages.slice()
  let duplicates = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'tool' || !calls.has(message.tool_call_id) || typeof message.content !== 'string') continue
    let value
    try { value = JSON.parse(message.content) } catch { continue }
    if (value?.success !== true || typeof value.content !== 'string' || typeof value.absolute !== 'string'
      || value.partial || value.truncated || value.readVersion?.stable === false) continue
    const key = JSON.stringify([value.absolute, value.readVersion?.hash || null, digest(value.content)])
    const retained = seen.get(key)
    if (retained) {
      const replacement = { ...message, content: JSON.stringify({ success: true, absolute: value.absolute,
        reused: true, historical: true, same_content_as_tool_call_id: retained,
        note: 'Conteúdo completo idêntico preservado no resultado referenciado desta requisição.' }) }
      if (size(replacement) < size(message)) { output[i] = replacement; duplicates++ }
    } else seen.set(key, message.tool_call_id)
  }
  return { messages: output, metrics: { duplicates, beforeBytes: size(messages), afterBytes: size(output),
    savedBytes: size(messages) - size(output), tokenAccounting: 'not_measured' } }
}





export function compactArchivedReads(messages, { receipts = new Map(), taskId, maxTokens } = {}) {
  const budget = Number(maxTokens)
  if (!Number.isFinite(budget) || budget <= 0) return { messages, archived: 0, overBudget: false }
  let currentUser = -1
  const reads = new Set()
  messages.forEach((m, i) => {
    if (m.role === 'user') currentUser = i
    for (const call of m.tool_calls || []) if (call.function?.name === 'read_file') reads.add(call.id)
  })
  const output = messages.slice()
  let used = tokens(output), archived = 0
  for (let i = 0; i < currentUser && used > budget; i++) {
    const m = output[i], receipt = receipts.get(m.tool_call_id)
    if (m.role !== 'tool' || !reads.has(m.tool_call_id) || !taskId || receipt?.taskId !== taskId || !Number.isInteger(receipt?.revision)) continue
    let value
    try { value = JSON.parse(m.content) } catch { continue }
    if (value?.success !== true || typeof value.content !== 'string' || value.partial || value.truncated) continue
    const replacement = { ...m, content: JSON.stringify({ success: true, historical: true,
      absolute: value.absolute, excerpt: value.content.slice(0, 256), coverage: 'partial',
      evidence: { tool: 'bag_retrieve_evidence', revision: receipt.revision, offset: 0 },
      note: 'Resultado completo arquivado; recuperar por revisão para consultar outros trechos.' }) }
    const saving = tokens(m) - tokens(replacement)
    if (saving > 0) { output[i] = replacement; used -= saving; archived++ }
  }
  return { messages: output, archived, overBudget: used > budget, inputUpperBound: used }
}

export function compactHistoryToBudget(messages, { maxTokens } = {}) {
  const budget = Number(maxTokens)
  if (!Number.isFinite(budget) || budget <= 0 || tokens(messages) <= budget) {
    return { messages, droppedTurns: 0, overBudget: false, estimatedTokens: tokens(messages) }
  }
  const turns = []
  let current = []
  for (const message of messages) {
    if (message?.role === 'user' && current.length) {
      turns.push(current)
      current = []
    }
    current.push(message)
  }
  if (current.length) turns.push(current)
  const retained = []
  let used = 0
  let compactedTurns = 0
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turnTokens = tokens(turns[index])
    if (retained.length && used + turnTokens > budget) {
      
      
      const projected = turns[index].flatMap(message => {
        if (message.role === 'tool') return []
        if (message.role === 'assistant' && message.tool_calls?.length) {
          if (!message.content) return []
          const { tool_calls, ...textMessage } = message
          return [textMessage]
        }
        return [message]
      })
      if (projected.length !== turns[index].length || turns[index].some(m => m.tool_calls?.length)) compactedTurns++
      retained.unshift(projected)
      used += tokens(projected)
    } else {
      retained.unshift(turns[index])
      used += turnTokens
    }
  }
  return {
    messages: retained.flat(),
    droppedTurns: 0,
    compactedTurns,
    overBudget: used > budget,
    estimatedTokens: used,
  }
}



export function prepareBagDelivery(previous, messages, { forceCheckpoint = false } = {}) {
  const hashes = messages.map(m => digest(JSON.stringify(m)))
  const prior = previous?.delivery?.hashes
  const compatible = !forceCheckpoint && previous?.threadId && previous.status === 'completed'
    && Array.isArray(prior) && prior.length > 0 && prior.length < hashes.length
    && prior.every((h, i) => hashes[i] === h)
  const offset = compatible ? prior.length : 0
  return { messages: messages.slice(offset), manifest: { hashes, mode: compatible ? 'delta' : 'checkpoint',
    base: compatible ? previous.delivery.digest : null, digest: digest(JSON.stringify(hashes)) } }
}
