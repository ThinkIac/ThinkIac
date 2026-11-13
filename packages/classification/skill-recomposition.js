export function skillRecompositionPolicy(config = {}) {
  const raw = config?.skills?.reactive || config?.classification?.skills?.reactive || {}
  return {
    enabled: raw.enabled !== false,
    maxCallsPerTurn: Math.max(0, Number(raw.maxCallsPerTurn ?? 2)),
    minIterationGap: Math.max(0, Number(raw.minIterationGap ?? 2)),
  }
}

export function decideSkillRecomposition({ state, signal = {}, config, iteration = 0 } = {}) {
  const policy = skillRecompositionPolicy(config)
  if (!policy.enabled) return { action: 'reuse', reason: 'disabled', policy }
  if (signal.cancelled || signal.governance === 'pending' || signal.governance === 'denied') {
    return { action: 'reuse', reason: 'governance', policy }
  }
  if ((state?.calls || 0) >= policy.maxCallsPerTurn) return { action: 'reuse', reason: 'budget', policy }
  if (iteration - (state?.lastCallIteration ?? -Infinity) < policy.minIterationGap) {
    return { action: 'reuse', reason: 'cooldown', policy }
  }
  if (signal.newInstruction) return { action: 'refresh', reason: 'new-instruction', policy }
  if (signal.domainShift) return { action: 'refresh', reason: 'domain-shift', policy }
  if (signal.recoverableFailure) return { action: 'refresh', reason: 'recoverable-failure', policy }
  if (signal.stagnation || signal.consecutiveFailures >= 3) {
    return { action: 'refresh', reason: 'operational-stagnation', policy }
  }
  return { action: 'reuse', reason: 'no-trigger', policy }
}
