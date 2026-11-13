import { runAgent } from '../core/agent.js'
import { pushAgentStatus } from '../utils/stream.js'
import { clearSession } from '../memory/session.js'
import { hasPendingQuestion, resolvePendingQuestion } from '../core/pending_questions.js'
import { eventCall as $ } from '../host/agent_host.js'
import { addTurnUsage, resetTurnUsage, getTurnUsage } from '../core/turn_usage.js'
import { scheduleGovernanceResume } from '../routes/chat.js'
import { stabilityReceipts } from '../core/stability_receipts.js'
export { onAgentResponsePublished, onDeviceResponse } from './mobile_notifications.js'

export { resetTurnUsage, getTurnUsage }

export async function onAgentTokenUsage({ usage, model, provider, sessionId }) {
  /**
   * @register_hook agent:token:usage
   */
  addTurnUsage(sessionId, { usage, model, provider })
}

export function onGovernanceApproved({ sessionId }) {
    /** @register_hook governance:approved */
    scheduleGovernanceResume(sessionId)
    return { sessionId }
}

export function onAgentToolStart(payload) {
    const { sessionId, tool, input, operationId } = payload
    /** @register_hook agent:tool-start */
    stabilityReceipts.markPotentialMutation({ sessionId, tool, input, operationId })
    return payload
}

export function onPackageReloadFailed(payload) {
    /** @register_hook package:reload_failed */
    stabilityReceipts.recordRejected(payload)
    return payload
}

export function onPackageRolledBack(payload) {
    /** @register_hook package:rolled_back */
    stabilityReceipts.recordRolledBack(payload)
    return payload
}

export function onReloadStable(payload) {
    /** @register_hook reload:stable */
    stabilityReceipts.recordStable(payload)
    return payload
}

export async function chat({ message, sessionId = 'default', onProgress = null }) {
    /**
     * @register_hook chat
     */

    
    
    
    if (message && hasPendingQuestion(sessionId)) {
        resolvePendingQuestion(sessionId, message)
        return '(resposta encaminhada para a tarefa em andamento)'
    }

    
    $('agent:message', { message, sessionId }).catch(() => {});

    try {
        !onProgress && (onProgress = (progress) => {
            pushAgentStatus(sessionId, 'running', progress?.label ?? '')
        });

        return message ?
            await runAgent(message, sessionId, onProgress)
            : {
                status: 400,
                data: {
                    error: 'message is required'
                }
            };
    } catch (e) {
        return {
            status: 500,
            data: {
                error: e.message
            }
        };
    }
};

export async function onClearSession({ sessionId }) {
    /**
     * @register_hook clearSession
     */
    if (!sessionId) return { success: false, error: 'sessionId is required' };

    try {
        clearSession(sessionId);
        return { success: true, cleared: sessionId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}
