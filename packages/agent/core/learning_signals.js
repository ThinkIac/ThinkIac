export function classifyUserFeedback(message) {
  const text = String(message || '').trim().toLowerCase()
  if (!text) return null
  if (/(não funcionou|nao funcionou|está errado|esta errado|rejeitad[oa]|corrija|quebrou|piorou)/i.test(text)) return 'rejected'
  if (/(aprovad[oa]|funcionou perfeitamente|resolveu|está correto|esta correto|ficou ótimo|ficou otimo)/i.test(text)) return 'accepted'
  return null
}

export function normalizeDistillation(distillation, context = {}) {
  if (!distillation?.has_gold || typeof distillation.golden_nugget !== 'string' || !distillation.golden_nugget.trim()) return null
  return {
    category: distillation.category || 'fact',
    content: distillation.golden_nugget.trim(),
    iteration: context.iteration ?? null,
    tools: Array.isArray(context.tools) ? context.tools : [],
    timestamp: new Date().toISOString(),
  }
}
