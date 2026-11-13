const FALLBACK_TIMEZONE = 'UTC'

function validTimezone(value) {
  if (typeof value !== 'string' || value.length > 80) return false
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function finiteInRange(value, min, max) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : null
}

export function normalizeMessageMetadata(input = {}, now = new Date()) {
  const receivedAt = now.toISOString()
  const parsedTimestamp = new Date(input?.timestamp)
  const timestamp = Number.isNaN(parsedTimestamp.getTime()) ? receivedAt : parsedTimestamp.toISOString()
  const timezone = validTimezone(input?.timezone) ? input.timezone : FALLBACK_TIMEZONE
  const metadata = { timestamp, timezone, receivedAt }
  if (input?.input_mode === 'audio') metadata.input_mode = 'audio'

  const latitude = finiteInRange(input?.location?.latitude, -90, 90)
  const longitude = finiteInRange(input?.location?.longitude, -180, 180)
  if (latitude !== null && longitude !== null && input?.location?.consent === 'one_time') {
    const approximate = input.location.precision !== 'precise'
    const accuracy = finiteInRange(input.location.accuracyMeters, 0, 1_000_000)
    metadata.location = {
      latitude: approximate ? Number(latitude.toFixed(2)) : Number(latitude.toFixed(6)),
      longitude: approximate ? Number(longitude.toFixed(2)) : Number(longitude.toFixed(6)),
      ...(accuracy !== null ? { accuracyMeters: Math.round(accuracy) } : {}),
      precision: approximate ? 'approximate' : 'precise',
      consent: 'one_time',
    }
  }
  return metadata
}

export function formatMessageForModel(message) {
  const content = String(message?.content ?? '')
  if (message?.role !== 'user' || !message?.metadata) return content
  const metadata = message.metadata
  const lines = [
    '[Message metadata]',
    `timestamp: ${metadata.timestamp}`,
    `timezone: ${metadata.timezone}`,
    `received_at: ${metadata.receivedAt}`,
  ]
  if (metadata.origin === 'presence') lines.push('origin: presence (iniciativa interna; não escrita pelo usuário)')
  if (metadata.location) {
    const { latitude, longitude, precision, accuracyMeters } = metadata.location
    const accuracy = accuracyMeters == null ? '' : `, accuracy ${accuracyMeters}m`
    lines.push(`location: ${latitude}, ${longitude} (${precision}${accuracy}; one-time consent)`)
  }
  lines.push('[/Message metadata]')
  return `${lines.join('\n')}\n\n${content}`
}
