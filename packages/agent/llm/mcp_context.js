/**
 * Resolve a sessão que deve acompanhar chamadas do proxy MCP HTTP.
 *
 * Uma sessão de processo é a fonte de verdade: ela é estabelecida pelo
 * chamador que abriu o subprocesso e não pode ser sobrescrita pelo modelo.
 * Argumentos da tool nunca são fonte de identidade: eles são controlados pelo
 * modelo e não podem assumir a política de outra sessão. Um cliente externo
 * sem binding de processo continua anônimo e só pode executar leituras.
 */
export function resolveMcpSessionId(args = {}, env = process.env) {
  const bound = env.AGENT_SESSION_ID || env.AGENT_ENGINEER_SESSION_ID
  if (typeof bound === 'string' && bound.trim()) return bound.trim()
  return null
}

export function buildMcpHeaders(args = {}, env = process.env) {
  const sessionId = resolveMcpSessionId(args, env)
  return {
    'Content-Type': 'application/json',
    ...(sessionId ? { 'x-session-id': sessionId } : {}),
  }
}

export class McpToolError extends Error {
  constructor(payload = {}, status = 500) {
    super(payload.error || `HTTP ${status} ao chamar tool MCP`)
    this.name = 'McpToolError'
    this.status = status
    this.code = payload.code || 'MCP_TOOL_ERROR'
    this.decisionId = payload.decisionId || null
    this.blocked = payload.blocked === true
    this.blockedBy = payload.blockedBy || null
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      status: this.status,
      blocked: this.blocked,
      blockedBy: this.blockedBy,
      ...(this.decisionId ? { decisionId: this.decisionId } : {}),
    }
  }
}

export function createMcpToolError(payload, status) {
  return new McpToolError(payload, status)
}

export function serializeMcpError(error) {
  if (error instanceof McpToolError) return error.toJSON()
  return {
    error: error?.message || String(error),
    code: error?.code || 'MCP_CLIENT_ERROR',
    status: error?.status || 500,
  }
}
