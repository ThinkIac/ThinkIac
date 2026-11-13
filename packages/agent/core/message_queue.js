







const queues = new Map() 

export function enqueue(sessionId, text) {
  if (!queues.has(sessionId)) queues.set(sessionId, [])
  queues.get(sessionId).push(text)
  return queues.get(sessionId).length
}

export function drain(sessionId) {
  const q = queues.get(sessionId)
  if (!q || q.length === 0) return []
  queues.delete(sessionId)
  return q
}

export function clear(sessionId) {
  queues.delete(sessionId)
}

export function size(sessionId) {
  return queues.get(sessionId)?.length ?? 0
}
