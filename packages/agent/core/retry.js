const DEFAULT_POLICY = Object.freeze({ maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2_000 })

export function normalizeRetryPolicy(value = {}) {
  const number = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback
  return {
    maxAttempts: Math.max(1, Math.min(5, Math.floor(number(value.maxAttempts, DEFAULT_POLICY.maxAttempts)))),
    baseDelayMs: Math.max(0, number(value.baseDelayMs, DEFAULT_POLICY.baseDelayMs)),
    maxDelayMs: Math.max(0, number(value.maxDelayMs, DEFAULT_POLICY.maxDelayMs)),
  }
}

function wait(ms, signal) {
  if (!ms) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }, { once: true })
  })
}

function isRetryable(error) {
  if (!error || error.name === 'AbortError' || error.noRetry === true) return false
  const status = Number(error.status ?? error.statusCode)
  if ([400, 401, 403, 404, 409, 422].includes(status)) return false
  return error.retryable !== false
}

export async function withRetry(operation, policyValue = {}, {
  signal, onRetry, random = Math.random, shouldRetry = isRetryable,
} = {}) {
  const policy = normalizeRetryPolicy(policyValue)
  let lastError
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try { return await operation(attempt) }
    catch (error) {
      lastError = error
      if (attempt >= policy.maxAttempts || !shouldRetry(error, attempt)) throw error
      const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** (attempt - 1)))
      const delay = Math.min(policy.maxDelayMs, Math.round(exponential * (0.75 + random() * 0.5)))
      await onRetry?.({ attempt, nextAttempt: attempt + 1, delayMs: delay, error })
      await wait(delay, signal)
    }
  }
  throw lastError
}

