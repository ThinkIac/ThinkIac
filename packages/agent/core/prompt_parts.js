import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'


const PARTS = [
  ['core/identity.inflect', 'Identidade e autorização', ['compact', 'detailed', 'full']],
  ['core/communication.inflect', 'Comunicação e conclusão', ['compact', 'detailed', 'full']],
  ['protocols/structured-input.inflect', 'Perguntas estruturadas', ['detailed', 'full']],
  ['protocols/react.inflect', 'Execução e recuperação', ['detailed', 'full']],
  ['protocols/multi-step.inflect', 'Plano e retomada', ['full']],
  ['capabilities/runtime.inflect', 'Contratos do Runtime', ['full']],
  ['heuristics/best-practices.inflect', 'Descoberta e aprendizado', ['detailed', 'full']],
]

export function loadPromptParts({ root, level, name, fallback, read = readFileSync, logger = console }) {
  const effectiveLevel = ['compact', 'detailed'].includes(level) ? level : 'full'
  const source = (path, content, activation, purpose) => ({
    type: 'prompt_part', name: path, path, activation, purpose,
    validity: 'composition',
    hash: createHash('sha256').update(content).digest('hex'),
    estimatedTokens: Math.ceil(content.length / 4),
  })
  try {
    const parts = PARTS.filter(([, , levels]) => levels.includes(effectiveLevel)).map(([path, purpose]) => {
      let content = read(join(root, 'prompts', path), 'utf8')
      if (path === 'core/identity.inflect') content = content.replace(/\{\{name\}\}/g, name)
      return { content, source: source(`prompts/${path}`, content, effectiveLevel, purpose) }
    })
    return { content: parts.map(part => part.content).join('\n\n'), sources: parts.map(part => part.source) }
  } catch (error) {
    logger.warn(`[Agent] Falha ao carregar partials ${effectiveLevel}: ${error.message}`)
    const content = fallback().replace(/\{\{name\}\}/g, name)
    return { content, sources: [source('AGENT.md', content, 'fallback', 'Personalidade completa')] }
  }
}
