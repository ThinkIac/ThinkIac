const DEFAULT_MAX_TOKENS = 32_000

export function promptFragment({
  id, source = 'unknown', content = '', priority = 0, maxTokens = null,
  trust = 'context', sensitivity = 'normal', expiresAt = null, dedupeKey = null,
  required = false, active = true, version = null, generatedAt = null,
} = {}) {
  if (!id) throw new Error('PromptFragment.id é obrigatório')
  return { id, source, content: String(content || ''), priority: Number(priority) || 0,
    maxTokens, trust, sensitivity, expiresAt, dedupeKey, required, active, version, generatedAt }
}

function renderFragment(fragment) {
  if (fragment.sensitivity === 'secret') return '[REDACTED:secret]'
  if (fragment.trust === 'external' || fragment.trust === 'untrusted') {
    return `--- BEGIN UNTRUSTED CONTEXT (${String(fragment.source).replace(/[\r\n]/g, ' ')}) ---\n${fragment.content.replace(/--- (BEGIN|END) UNTRUSTED CONTEXT/g, '[quoted boundary] $1 UNTRUSTED CONTEXT')}\n--- END UNTRUSTED CONTEXT ---`
  }
  return fragment.content
}

export class ContextCompiler {
  constructor({ maxTokens = DEFAULT_MAX_TOKENS, estimateTokens = text => Math.ceil(String(text || '').length / 4), now = Date.now } = {}) {
    this.maxTokens = maxTokens
    this.estimateTokens = estimateTokens
    this.now = now
  }

  compile(input = []) {
    const dropped = []
    const live = []
    const byDedupe = new Map()

    for (const raw of input.filter(Boolean)) {
      const fragment = promptFragment(raw)
      if (!fragment.active) { dropped.push({ ...fragment, reason: 'inactive' }); continue }
      if (fragment.expiresAt != null && Number(fragment.expiresAt) <= this.now()) {
        dropped.push({ ...fragment, reason: 'expired' })
        continue
      }
      const key = fragment.dedupeKey || `id:${fragment.id}`
      const previous = byDedupe.get(key)
      if (!previous || fragment.priority > previous.priority || (fragment.priority === previous.priority && Number(fragment.generatedAt) > Number(previous.generatedAt))) {
        if (previous) dropped.push({ ...previous, reason: 'deduplicated' })
        byDedupe.set(key, fragment)
      } else {
        dropped.push({ ...fragment, reason: 'deduplicated' })
      }
    }

    const ranked = [...byDedupe.values()].sort((a, b) => Number(b.required) - Number(a.required) || b.priority - a.priority)
    let usedTokens = 0
    for (const fragment of ranked) {
      let content = renderFragment(fragment)
      let tokens = this.estimateTokens(content)
      if (!fragment.required && fragment.maxTokens != null && tokens > fragment.maxTokens) {
        
        let low = 0, high = fragment.content.length
        while (low < high) {
          const middle = Math.ceil((low + high) / 2)
          const rendered = renderFragment({ ...fragment, content: fragment.content.slice(0, middle) })
          if (this.estimateTokens(rendered) <= fragment.maxTokens) low = middle
          else high = middle - 1
        }
        content = low ? renderFragment({ ...fragment, content: fragment.content.slice(0, low) }) : ''
        tokens = this.estimateTokens(content)
      }
      if (!content || (!fragment.required && usedTokens + tokens > this.maxTokens)) {
        dropped.push({ ...fragment, reason: 'budget', estimatedTokens: tokens })
        continue
      }
      live.push({ ...fragment, content, estimatedTokens: tokens })
      usedTokens += tokens
    }

    return {
      text: live.map(item => item.content).join('\n\n'),
      fragments: live,
      dropped,
      usedTokens,
      maxTokens: this.maxTokens,
      diagnostics: usedTokens > this.maxTokens ? [{ code: 'REQUIRED_CONTEXT_EXCEEDS_BUDGET', excessTokens: usedTokens - this.maxTokens }] : [],
      provenance: live.map(({ id, source, trust, sensitivity, estimatedTokens }) => ({
        id, source, trust, sensitivity, estimatedTokens,
      })),
    }
  }
}
