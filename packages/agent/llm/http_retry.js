const DEFAULT_RETRY = Object.freeze({
  maxAttempts: 2,
  baseDelayMs: 400,
  maxDelayMs: 8000,
  retryableStatus: [408, 425, 429, 500, 502, 503, 504],
})

export function normalizeRetryPolicy(value = {}) {
  
  
  
  value ??= {}
  const number = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback
  return {
    maxAttempts: Math.max(1, Math.min(10, number(value.maxAttempts, DEFAULT_RETRY.maxAttempts))),
    baseDelayMs: Math.max(0, number(value.baseDelayMs, DEFAULT_RETRY.baseDelayMs)),
    maxDelayMs: Math.max(0, number(value.maxDelayMs, DEFAULT_RETRY.maxDelayMs)),
    retryableStatus: new Set(Array.isArray(value.retryableStatus) ? value.retryableStatus.map(Number) : DEFAULT_RETRY.retryableStatus),
  }
}

function retryAfterMs(response) {
  const raw = response?.headers?.get?.('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function wait(ms, signal) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

/** Retries only until an HTTP response is accepted; it never replays a consumed stream. */
export async function fetchWithRetry(url, init, policyValue, { random = Math.random } = {}) {
  const policy = normalizeRetryPolicy(policyValue)
  let lastError
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init)
      if (!policy.retryableStatus.has(response.status) || attempt === policy.maxAttempts) return response
      try { await response.body?.cancel?.() } catch {}
      const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempt - 1)))
      const delay = retryAfterMs(response) ?? Math.round(exponential * (0.75 + random() * 0.5))
      await wait(Math.min(policy.maxDelayMs, delay), init?.signal)
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      lastError = error
      if (attempt === policy.maxAttempts) throw error
      const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempt - 1)))
      await wait(Math.round(exponential * (0.75 + random() * 0.5)), init?.signal)
    }
  }
  throw lastError
}
