/**
 * Serializa retomadas internas por sessão. Várias aprovações antes de o
 * worker começar viram uma única retomada; uma aprovação que chega durante a
 * execução agenda exatamente mais uma passagem depois dela.
 */
export function createGovernanceResumeCoordinator({ isActive, delay, resume }) {
  const workers = new Map()

  function schedule(sessionId) {
    if (!sessionId) return Promise.resolve()
    const existing = workers.get(sessionId)
    if (existing) {
      existing.requested = true
      return existing.promise
    }

    const worker = { requested: true, promise: null }
    worker.promise = (async () => {
      try {
        while (worker.requested) {
          worker.requested = false
          while (isActive(sessionId)) await delay()
          await resume(sessionId)
        }
      } finally {
        workers.delete(sessionId)
      }
    })()
    workers.set(sessionId, worker)
    return worker.promise
  }

  return { schedule }
}
