const { createHash } = require('node:crypto')

function normalizeIntent(message) {
  return String(message || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function intentHash(message) {
  return createHash('sha256').update(normalizeIntent(message)).digest('hex').slice(0, 20)
}

function classificationCacheKey({ sessionId = '', message = '', toolsHash = '' } = {}) {
  return `${sessionId}:${intentHash(message)}:${toolsHash}`
}

module.exports = { normalizeIntent, intentHash, classificationCacheKey }
