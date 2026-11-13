import { randomUUID } from 'crypto'

export function createTurnContext({ runId = null, sessionId, turnId = randomUUID() } = {}) {
  return { runId, turnId, sessionId }
}

export function createIterationContext(turn, iteration, { iterationId = randomUUID() } = {}) {
  return { ...turn, iteration, iterationId }
}

export function createToolContext(iteration, toolCall = {}, { operationId = randomUUID() } = {}) {
  const toolCallId = toolCall.id || randomUUID()
  const context = { ...iteration, toolCallId, operationId }
  return {
    ...context,
    tool: toolCall.name || null,
    correlation: correlationFields(context),
  }
}

export function correlationFields(context = {}) {
  return {
    runId: context.runId ?? null,
    turnId: context.turnId ?? null,
    iterationId: context.iterationId ?? null,
    toolCallId: context.toolCallId ?? null,
    operationId: context.operationId ?? null,
  }
}
