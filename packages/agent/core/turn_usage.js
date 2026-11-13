

















import { estimateCostUsd } from './turn_cost.js'

const turnUsage = new Map() 

export function resetTurnUsage(sessionId) {
  turnUsage.delete(sessionId)
}

export function getTurnUsage(sessionId) {
  return turnUsage.get(sessionId) || null
}

export function addTurnUsage(sessionId, { usage = {}, model = null, provider = null } = {}) {
  if (!sessionId) return
  const prev = turnUsage.get(sessionId) || { prompt_tokens: 0, completion_tokens: 0, cost: 0 }
  
  const cost = (typeof usage.cost === 'number' && usage.cost > 0)
    ? usage.cost
    : estimateCostUsd(model, usage)
  turnUsage.set(sessionId, {
    prompt_tokens: prev.prompt_tokens + (usage.prompt_tokens || 0),
    completion_tokens: prev.completion_tokens + (usage.completion_tokens || 0),
    cost: prev.cost + cost,
    model: model || prev.model,
    provider: provider || prev.provider,
  })
}
