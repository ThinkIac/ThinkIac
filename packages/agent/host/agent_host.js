

import { createAgentHost } from '../runtime/index.js'
import { broadcast, dispatchEvent, getProxy, onMessage, pushToSession } from 'logos'

const logosHost = createAgentHost({
  events: { call: dispatchEvent },
  sockets: { broadcast, onMessage, pushToSession },
  storage: { getProxy },
})

let host = logosHost

export function configureAgentHost(ports) {
  host = createAgentHost(ports)
  return host
}

export function resetAgentHost() { host = logosHost; return host }
export const eventCall = (...args) => host.events.call(...args)
export const broadcastMessage = (...args) => host.sockets.broadcast(...args)
export const onHostMessage = (...args) => host.sockets.onMessage(...args)
export const pushToHostSession = (...args) => host.sockets.pushToSession(...args)
export const getHostProxy = (...args) => host.storage.getProxy(...args)
