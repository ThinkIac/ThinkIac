'use strict';

function reactiveConfig(config = {}) {
    const raw = config?.classification?.decision?.reactive || {};
    return {
        enabled: raw.enabled === true,
        mode: raw.mode === 'assist' ? 'assist' : 'shadow',
        maxCallsPerTurn: Math.max(0, Number(raw.maxCallsPerTurn ?? 2)),
        minIterationGap: Math.max(0, Number(raw.minIterationGap ?? 2)),
        timeoutMs: Math.max(1, Number(raw.timeoutMs ?? 1500)),
    };
}

function decideReactiveRefresh({ state, signal = {}, config, iteration = 0, catalogVersion }) {
    const policy = reactiveConfig(config);
    if (!policy.enabled) return { action: 'reuse', reason: 'disabled', policy };
    if (!state) return { action: 'reuse', reason: 'initial-selection', policy };
    if (signal.governance === 'pending' || signal.governance === 'denied' || signal.cancelled) {
        return { action: 'reuse', reason: 'governance', policy };
    }
    if (state.calls >= policy.maxCallsPerTurn) return { action: 'reuse', reason: 'budget', policy };
    if (catalogVersion && state.catalogVersion !== catalogVersion) {
        return { action: 'refresh', reason: 'catalog-changed', policy };
    }
    if (iteration - state.lastCallIteration < policy.minIterationGap) return { action: 'reuse', reason: 'cooldown', policy };
    if (signal.newInstruction) return { action: 'refresh', reason: 'new-instruction', policy };
    if (signal.recoverableFailure) return { action: 'refresh', reason: 'recoverable-failure', policy };
    if (signal.consecutiveFailures >= 3) return { action: 'refresh', reason: 'operational-stagnation', policy };
    return { action: 'reuse', reason: 'no-trigger', policy };
}

module.exports = { reactiveConfig, decideReactiveRefresh };
