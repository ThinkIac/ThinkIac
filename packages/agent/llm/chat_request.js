import { createHash } from 'node:crypto'


export function buildChatRequest({ model, system, messages, tools = [], stream = false,
  maxTokens, temperature, slot, sessionId, openrouter = {}, contextLimit = null, onBudget = null }) {
  const body = { model, messages: [{ role: 'system', content: system }, ...messages] }
  if (stream) body.stream = true
  if (tools.length) body.tools = tools.map(t => ({ type: 'function', function: {
    name: t.name, description: t.description, parameters: t.input_schema,
  } }))
  if (maxTokens) body.max_tokens = maxTokens
  if (temperature != null) body.temperature = temperature
  let isOpenRouter = false
  try { isOpenRouter = new URL(slot?.url).hostname === 'openrouter.ai' } catch {}
  if (isOpenRouter) {
    if (openrouter.provider) body.provider = structuredClone(openrouter.provider)
    if (openrouter.session_affinity === true && sessionId) {
      body.session_id = createHash('sha256').update(JSON.stringify([slot?.id, sessionId])).digest('hex')
    }
  }
  if (contextLimit != null) {
    if (!Number.isFinite(contextLimit) || contextLimit <= 0) throw new Error('BAG_INVALID_CONTEXT_LIMIT')
    const outputReserve = body.max_tokens || Math.min(4096, Math.floor(contextLimit / 4))
    
    
    if (body.messages.some(m => typeof m.content !== 'string' && m.content != null)) throw new Error('BAG_MULTIMODAL_BUDGET_UNAVAILABLE')
    const inputBound = Buffer.byteLength(JSON.stringify(body)) + 32 * body.messages.length + 256
    const metric = { inputUpperBound: inputBound, outputReserve, contextLimit, accounting: 'utf8_upper_bound' }
    onBudget?.(metric)
    if (inputBound + outputReserve > contextLimit) throw Object.assign(new Error('BAG_CONTEXT_EXCEEDS_BUDGET'), { budget: metric })
    body.max_tokens = outputReserve
  }
  return body
}

export function bagContextLimit(config, slot, model, selected) {
  if (config?.bag?.enforce_budget !== true) return null
  const configured = config.bag.context_limits?.[slot.id]?.[model]
  const matched = selected?.model === model && selected?.metadata?.poolName === slot.poolName
  const limit = configured ?? (matched ? selected?.capabilities?.contextWindow : null)
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('BAG_CONTEXT_LIMIT_UNKNOWN')
  return limit
}
