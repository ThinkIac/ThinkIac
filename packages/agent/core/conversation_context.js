

export function buildRecentUserContext(messages = [], currentMessage = '', { limit = 3, maxChars = 6_000 } = {}) {
  const current = String(currentMessage ?? '').trim()
  const recent = [...messages]
    .reverse()
    .filter(message => message?.role === 'user')
    .map(message => String(message.content ?? '').trim())
    .filter(Boolean)

  const entries = current && recent[0] !== current ? [current, ...recent] : recent
  return entries.slice(0, limit).join('\n\n').slice(0, maxChars)
}
