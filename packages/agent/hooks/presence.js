import { cancelPresenceContinuation } from '../routes/chat.js';
import { runAgent } from '../core/agent.js';
import { eventCall } from '../host/agent_host.js';
import { getMessages, replaceMessagesAsync } from '../memory/session.js';
import { createPresenceAdapter } from '../core/presence_adapter.js';

const adapter = createPresenceAdapter({ request: eventCall, run: runAgent, publish: eventCall,
  flush: sessionId => replaceMessagesAsync(sessionId, getMessages(sessionId)) });
export function onPresenceInitiative(payload) {
  /** @register_hook presence:initiative */
  return adapter.handle(payload);
}
export function onPresenceCancel(payload) {
  /** @register_hook presence:cancel */
  if (payload?.schemaVersion !== 1) return payload;
  cancelPresenceContinuation();
  return adapter.cancel();
}
