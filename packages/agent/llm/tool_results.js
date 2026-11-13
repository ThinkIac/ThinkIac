export const DEFAULT_TOOL_RESULT_MAX_CHARS = 24_000

function stringifyToolResult(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? 'null'
  } catch {
    return '{"error":"resultado não serializável"}'
  }
}

export function serializeToolResult(value, maxChars = DEFAULT_TOOL_RESULT_MAX_CHARS) {
  const serialized = stringifyToolResult(value)
  if (serialized.length <= maxChars) return serialized

  return `${serialized.slice(0, maxChars)}\n\n[tool result truncated] original_chars=${serialized.length} kept_chars=${maxChars}`
}
