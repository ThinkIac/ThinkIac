/**
 * Regressão: uma chamada MCP externa de bags declara sessionId no payload,
 * mas não dispõe de AGENT_SESSION_ID no processo. O proxy precisa propagar
 * esse valor em x-session-id para a governança não tratá-la como anônima.
 *
 * Roda com: node llm/mcp_context.test.js
 */
import {
  buildMcpHeaders,
  createMcpToolError,
  resolveMcpSessionId,
  serializeMcpError,
} from './mcp_context.js'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  ✅ ${message}`)
  } else {
    failed++
    console.error(`  ❌ ${message}`)
  }
}

assert(
  resolveMcpSessionId({ sessionId: 'orbit-forjada' }, {}) === null,
  'não aceita sessionId controlado pelos argumentos da tool',
)

assert(
  buildMcpHeaders({ sessionId: 'orbit-forjada' }, {})['x-session-id'] === undefined,
  'não propaga uma identidade sem binding confiável do processo',
)

assert(
  resolveMcpSessionId({ sessionId: 'tentativa-de-troca' }, { AGENT_SESSION_ID: 'orbit-vinculada' }) === 'orbit-vinculada',
  'a sessão vinculada no ambiente prevalece sobre o argumento da tool',
)

assert(
  resolveMcpSessionId({}, {}) === null,
  'mantém chamadas sem sessão como não rastreáveis',
)

const structured = serializeMcpError(createMcpToolError({
  error: 'confirme',
  code: 'CONFIRMATION_REQUIRED',
  blocked: true,
  blockedBy: 'governance',
  decisionId: 'decision-1',
}, 409))

assert(
  structured.code === 'CONFIRMATION_REQUIRED' &&
    structured.status === 409 &&
    structured.decisionId === 'decision-1' &&
    structured.blockedBy === 'governance',
  'preserva metadados estruturados do bloqueio até o cliente MCP',
)

console.log(`\n${failed === 0 ? '✅' : '❌'} mcp_context: ${passed} passaram, ${failed} falharam`)
process.exit(failed === 0 ? 0 : 1)
