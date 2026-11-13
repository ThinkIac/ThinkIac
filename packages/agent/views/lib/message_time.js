export function messageTimestamp(message) {
  if (message?.role === 'user') return message?.metadata?.timestamp ?? ''
  return message?.createdAt ?? message?.timestamp ?? ''
}

export function formatMessageTime(value, timeZone) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(timeZone ? { timeZone } : {}),
    }).format(date)
  } catch {
    return ''
  }
}

export function copyMessageTiming(message) {
  return {
    ...(message?.metadata ? { metadata: message.metadata } : {}),
    ...(message?.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message?.timestamp ? { timestamp: message.timestamp } : {}),
  }
}
