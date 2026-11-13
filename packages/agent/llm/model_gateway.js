function parseArguments(value) {
  if (value && typeof value === 'object') return value
  try { return JSON.parse(value || '{}') }
  catch { return { _raw: value, _error: 'invalid-json' } }
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? usage.total_tokens ?? 0)
      || Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) + Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
  }
}

export function normalizeModelResponse(raw, { mode = 'call' } = {}) {
  const message = raw?.choices?.[0]?.message || {}
  const simple = typeof raw?.text === 'string' && !raw?.choices
  const toolCalls = (message.tool_calls || raw?.toolCalls || raw?.tool_calls || []).map(call => ({
    id: call.id ?? null,
    name: call.name ?? call.function?.name ?? null,
    input: call.input ?? parseArguments(call.function?.arguments),
  }))
  const explicitlyFailed = raw?.success === false || raw?.ok === false
  return {
    ok: !explicitlyFailed,
    text: simple ? raw.text : String(message.content ?? raw?.text ?? ''),
    reasoning: message.reasoning_content ?? message.reasoning ?? raw?.reasoning ?? null,
    toolCalls,
    usage: normalizeUsage(raw?.usage),
    model: raw?._model ?? raw?.model ?? null,
    provider: raw?._provider ?? raw?.provider ?? null,
    stopReason: raw?.choices?.[0]?.finish_reason ?? raw?.stopReason ?? 'stop',
    error: explicitlyFailed ? {
      code: String(raw?.error?.code || raw?.code || 'MODEL_FAILED'),
      message: String(raw?.error?.message || raw?.error || 'A chamada ao modelo falhou.'),
      retryable: raw?.error?.retryable === true || raw?.retryable === true,
      category: String(raw?.error?.category || 'provider'),
    } : null,
    mode,
    raw,
  }
}

function modelError(error) {
  return {
    ok: false, text: '', reasoning: null, toolCalls: [], usage: normalizeUsage(),
    model: null, provider: null, stopReason: 'error', raw: null,
    error: {
      code: String(error?.code || error?.name || 'MODEL_FAILED'),
      message: String(error?.message || 'A chamada ao modelo falhou.'),
      retryable: error?.retryable === true,
      category: 'provider',
    },
  }
}

export class ModelGateway {
  constructor(adapters = {}) { this.adapters = adapters }

  async request({ mode = 'call', ...options } = {}) {
    const adapter = this.adapters[mode]
    if (typeof adapter !== 'function') return { ...modelError(new Error(`Adapter de modelo ausente: ${mode}`)), mode }
    try {
      return normalizeModelResponse(await adapter(options), { mode })
    } catch (error) {
      return { ...modelError(error), mode }
    }
  }

  async legacy(options = {}) {
    const response = await this.request(options)
    if (!response.ok) {
      const error = new Error(response.error.message)
      Object.assign(error, response.error, { modelResponse: response })
      throw error
    }
    return response.raw
  }
}
