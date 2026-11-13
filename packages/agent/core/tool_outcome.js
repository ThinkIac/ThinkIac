const DEFAULT_ERROR = Object.freeze({
  code: 'TOOL_FAILED',
  message: 'A ferramenta informou falha sem fornecer detalhes.',
  retryable: false,
  category: 'tool',
})




export function jsonSafeValue(value) {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null) return value
  const seen = new WeakSet()
  try {
    return JSON.parse(JSON.stringify(value, (key, current) => {
      if (key === '_scriba') return '[Runtime]'
      if (typeof current === 'bigint') return String(current)
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) return '[Circular]'
        seen.add(current)
      }
      return current
    }))
  } catch {
    return '[resultado não serializável]'
  }
}

export function publicToolOutcome(outcome) {
  return {
    ...outcome,
    value: jsonSafeValue(outcome?.value),
    error: outcome?.error ? jsonSafeValue(outcome.error) : null,
    metrics: jsonSafeValue(outcome?.metrics ?? {}),
  }
}

function errorShape(error, fallbackCategory = 'tool') {
  if (!error) return { ...DEFAULT_ERROR, category: fallbackCategory }
  if (typeof error === 'string') {
    return { code: 'TOOL_FAILED', message: error, retryable: false, category: fallbackCategory }
  }
  return {
    code: String(error.code || error.name || 'TOOL_FAILED'),
    message: String(error.message || error.error || 'A ferramenta informou uma falha.'),
    retryable: error.retryable === true,
    category: String(error.category || fallbackCategory),
    ...(error.actionRequired ? { actionRequired: String(error.actionRequired) } : {}),
  }
}

export function isToolOutcome(value) {
  return Boolean(value && typeof value === 'object'
    && typeof value.ok === 'boolean'
    && Object.hasOwn(value, 'value')
    && Object.hasOwn(value, 'error')
    && Object.hasOwn(value, 'changedState')
    && Object.hasOwn(value, 'metrics'))
}

export function normalizeToolOutcome(value, metadata = {}) {
  if (isToolOutcome(value)) return {
    ...value,
    error: value.error ? { ...value.error } : null,
    operationId: value.operationId ?? metadata.operationId ?? null,
    metrics: { ...value.metrics, ...metadata.metrics },
  }

  const explicitlyFailed = Boolean(value && typeof value === 'object'
    && (value.success === false || value.ok === false))
  const error = explicitlyFailed
    ? errorShape(value.error || value.message, value.category || 'tool')
    : null

  return {
    ok: !explicitlyFailed,
    value,
    error,
    changedState: metadata.changedState ?? value?.changedState ?? null,
    operationId: metadata.operationId ?? value?.operationId ?? null,
    metrics: { ...(value?.metrics || {}), ...(metadata.metrics || {}),
      ...(metadata.durationMs == null ? {} : { durationMs: metadata.durationMs }) },
  }
}

export function toolOutcomeError(error, metadata = {}) {
  return {
    ok: false,
    value: null,
    error: errorShape(error, metadata.category || 'unexpected'),
    changedState: metadata.changedState ?? null,
    operationId: metadata.operationId ?? null,
    metrics: { ...(metadata.metrics || {}),
      ...(metadata.durationMs == null ? {} : { durationMs: metadata.durationMs }) },
  }
}

export function legacyToolResult(outcome) {
  if (outcome.ok) return jsonSafeValue(outcome.value)
  return outcome.error?.message || DEFAULT_ERROR.message
}
