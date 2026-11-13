export function createSessionActivationGuard() {
    let generation = 0;

    return {
        begin(sessionId) {
            generation += 1;
            return { sessionId, generation };
        },

        isCurrent(token, activeSessionId, activeIsApp = false) {
            return Boolean(
                token
                && !activeIsApp
                && token.generation === generation
                && token.sessionId === activeSessionId,
            );
        },
    };
}
