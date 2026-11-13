export function retryTurnInput(history, assistantIndex) {
    if (!Number.isInteger(assistantIndex) || !history[assistantIndex]?.timedOut) return null;
    for (let i = assistantIndex - 1; i >= 0; i--) {
        const item = history[i];
        if (item.role !== 'user' || item.queued) continue;
        const text = item.content || '';
        const attachments = item.attachments || [];
        return text || attachments.length ? { text, attachments } : null;
    }
    return null;
}
