


const estimateTokens = (content) => Math.ceil(String(content || '').length / 4)

export function measureInputSegments({ system = '', messages = [], tools = [] } = {}) {
  const serialized = value => JSON.stringify(value ?? '')
  const toolResults = messages.filter(message => message?.role === 'tool')
  const conversation = messages.filter(message => message?.role !== 'tool')
  const segments = {
    system: estimateTokens(system),
    history: estimateTokens(serialized(conversation)),
    toolResults: estimateTokens(serialized(toolResults)),
    toolSchemas: estimateTokens(serialized(tools)),
  }
  return { ...segments, total: Object.values(segments).reduce((sum, value) => sum + value, 0), accounting: 'chars_estimate' }
}

export function buildInputTrace({ provider, model, approximationLevel, sources = [], dropped = [], diagnostics = [] } = {}, now = new Date()) {
  return {
    version: 1,
    capturedAt: now.toISOString(),
    provider: provider || 'unknown',
    model: model || 'unknown',
    approximationLevel: approximationLevel || 'compact',
    ...(dropped.length ? { dropped: dropped.map(item => ({
      id: String(item.id), source: String(item.source), reason: String(item.reason),
    })) } : {}),
    ...(diagnostics.length ? { diagnostics: diagnostics.map(item => ({
      code: String(item.code),
      ...(Number.isFinite(item.excessTokens) ? { excessTokens: item.excessTokens } : {}),
    })) } : {}),
    sources: sources
      .filter(source => source && source.name)
      .map(source => ({
        type: source.type || 'context',
        name: String(source.name),
        ...(source.path ? { path: String(source.path) } : {}),
        ...(source.activation ? { activation: String(source.activation) } : {}),
        ...(source.purpose ? { purpose: String(source.purpose) } : {}),
        ...(source.validity ? { validity: String(source.validity) } : {}),
        ...(source.hash ? { hash: String(source.hash) } : {}),
        estimatedTokens: Number.isFinite(source.estimatedTokens)
          ? source.estimatedTokens
          : estimateTokens(source.content),
      })),
  }
}
