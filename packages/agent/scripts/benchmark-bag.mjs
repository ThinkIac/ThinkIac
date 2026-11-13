import { compactBagReads, compactArchivedReads } from '../core/bag_context.js'
import { BagStore } from '../core/bag_store.js'

// Offline, deterministic payload benchmark. No model call, no token/cost claim.
const store = new BagStore(':memory:')
const scope = { tenantId: 'benchmark', workspaceId: 'fixture', taskId: 'task' }
const messages = [{ role: 'user', content: 'Inspect the parser; preserve its public API.' }]
const receipts = new Map()
try {
  for (let i = 0; i < 6; i++) {
    const id = `read-${i}`
    const value = { success: true, absolute: '/fixture/parser.js', content: `// revision ${i < 4 ? 1 : 2}\n` + 'export const parse = value => JSON.parse(value);\n'.repeat(200) }
    messages.push({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{"path":"parser.js"}' } }] })
    messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(value) })
    const receipt = store.append(scope, { key: id, type: 'tool_result', payload: { callId: id }, evidence: JSON.stringify(value) })
    receipts.set(id, { revision: receipt.evidenceRevision, taskId: 'task' })
  }
  messages.push({ role: 'assistant', content: 'Version 2 was observed; tests remain pending.' })
  messages.push({ role: 'user', content: 'Continue. Correction: do not change the public API.' })
  const duplicateOnly = compactBagReads(messages)
  const archived = compactArchivedReads(messages, { receipts, taskId: 'task', maxTokens: 8000 })
  const combined = compactBagReads(archived.messages)
  const bytes = value => Buffer.byteLength(JSON.stringify(value))
  const baselineBytes = bytes(messages), compactedBytes = bytes(combined.messages)
  console.log(JSON.stringify({ benchmark: 'agent-bag-offline-v1', measuredAt: new Date().toISOString(),
    scenario: 'six reads, two versions, explicit correction, continuation',
    baselineBytes, duplicateOnlyBytes: bytes(duplicateOnly.messages), compactedBytes,
    savedBytes: baselineBytes - compactedBytes, reductionPercent: Number((100 * (baselineBytes - compactedBytes) / baselineBytes).toFixed(2)),
    archivedReads: archived.archived, exactDuplicateReads: duplicateOnly.metrics.duplicates,
    originalMessages: messages.length, projectedMessages: combined.messages.length,
    tokens: null, cost: null, providerCalls: 0,
    limitations: ['Synthetic payload, not task success evaluation', 'No billed token measurement', 'No Runtime promotion receipt'],
  }, null, 2))
} finally { store.close() }
