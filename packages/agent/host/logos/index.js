/**
 * Integração de host, deliberadamente fora de agent/runtime e fora de Logos.
 * Logos fornece somente suas capacidades genéricas: pipeline LLM e MCP/tools.
 */
import { createAgentExecutor } from '../../runtime/index.js'
import { estimateCostUsd } from '../../core/turn_cost.js'
import { dispatchEvent, emit, getMcpTools } from 'logos'

export function createLogosAgentExecutor() {
  return createAgentExecutor({
    callModel: (payload, context) => dispatchEvent('llm:call', payload, context),
    resolveTools: () => getMcpTools(),
    emitTrace: (trace, context) => emit('agent-runtime:trace', trace, context),
    estimateCost: estimateCostUsd,
  })
}

const executor = createLogosAgentExecutor()
export const runAgentTask = (options) => executor.run(options)
export const runChainTask = (steps, initial) => executor.runChain(steps, initial)
