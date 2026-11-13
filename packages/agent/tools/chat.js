
import { runAgent } from '../core/agent.js'
import { eventCall } from '../host/agent_host.js'

export async function tool_chat(payload) {
  /**
   * @register_tool tool_chat
   * @description Send a message to agent and receive a response
   * @param {string} message - The message to send
   * @param {string?} session_id - Session ID (default: \"default\")
   */
  const { message, session_id = 'default' } = payload
  if (!message) throw new Error('`message` is required')

  
  eventCall('agent:message', { message, sessionId: session_id }).catch(() => {});

  return await runAgent(message, session_id)
}
