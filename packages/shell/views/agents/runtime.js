import * as agent from './adapters/agent.js'
import * as scriba from './adapters/scriba.js'
import { DEFAULT_AGENT_ID, resolveAgent } from './catalog.js'
import { createAgentRuntime } from '../../../agent/runtime/index.js'

const runtime = createAgentRuntime({
  defaultAgentId: DEFAULT_AGENT_ID,
  definitions: [
    { ...resolveAgent('agent'), adapter: agent },
    { ...resolveAgent('scriba'), adapter: scriba },
  ],
})

export const activateAgent = runtime.activateAgent
export const currentAgentId = runtime.currentAgentId
export const capabilities = runtime.capabilities
export const hasCapability = runtime.hasCapability
export const request = runtime.request
export const requestForAgent = runtime.requestForAgent
export const resourceUrl = runtime.resourceUrl
export const connect = runtime.connect
export const connectAll = runtime.connectAll
export const send = runtime.send
export const subscribe = runtime.subscribe
export const subscribeAll = runtime.subscribeAll
export const on = runtime.on
export const onReopen = runtime.onReopen
export const setUiState = runtime.setUiState
export const sendSnapshot = runtime.sendSnapshot
export const onCommand = runtime.onCommand
export const isReady = runtime.isReady
