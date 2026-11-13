// memory/hooks.js
// Injeta um bloco compacto de memória de longo prazo no system prompt, a
// cada iteração do ReAct loop do agentic (mesmo evento que packages/bags usa
// — ver apps/runtime/packages/agentic/core/loop.js). O aurora não passa por
// este hook (tem loop próprio, sem bus) — lá a memória entra via
// aurora/memory/session.js, que delega para lib/graph.js diretamente.

import { getContextBlock } from './lib/graph.js'

export function onPromptCompose(payload) {
  /**
   * @register_hook agent:prompt:compose
   */
  try {
    const block = getContextBlock({ limit: 5 })
    if (!block) return payload
    return { ...payload, system: (payload.system ?? '') + block }
  } catch {
    return payload
  }
}
