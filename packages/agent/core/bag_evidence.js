import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'



export function readEvidence(tool, outcome) {
  const value = outcome?.value
  if (tool !== 'read_file' || outcome?.ok !== true || value?.success !== true
    || typeof value.content !== 'string' || typeof value.absolute !== 'string'
    || !isAbsolute(value.absolute)) return null
  return {
    path: value.absolute,
    hash: value.readVersion?.hash || createHash('sha256').update(value.content, 'utf8').digest('hex'),
    representation: value.readVersion?.representation || 'returned_utf8_text',
    bytes: value.readVersion?.bytes ?? Buffer.byteLength(value.content),
    coverage: value.truncated || value.partial || value.readVersion?.stable === false ? 'partial' : 'complete',
    reused: value.readVersion?.reused === true,
    invalidated: value.readVersion?.invalidated === true,
    freshness: 'historical',
  }
}

export function captureToolResult(value, limit = 8000) {
  let text
  try { text = typeof value === 'string' ? value : JSON.stringify(value) }
  catch { return { result: '[unserializable tool result]', coverage: 'unknown' } }
  if (typeof text !== 'string') return { result: '[empty tool result]', coverage: 'unknown' }
  return { result: text.slice(0, limit), coverage: text.length > limit ? 'partial' : 'complete' }
}
