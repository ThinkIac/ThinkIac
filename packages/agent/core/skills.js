import { observeSkills, skillsMode } from '../../classification/skills.js'

























import { dirname } from 'path'
import { eventCall as $ } from '../host/agent_host.js'
import { renderTemplate } from 'inflect'
import { discoverAgentFiles, sha256 } from '../../specialists/lib/discovery.js'



function discoverSkills() {
  const files = discoverAgentFiles({ excludePackages: ['agent'] })

  
  const byName = new Map()
  for (const s of files) {
    const existing = byName.get(s.name)
    if (!existing || (s.pinned && s.body.length > existing.body.length) || (!existing.pinned && s.pinned)) {
      byName.set(s.name, s)
    }
  }
  return [...byName.values()]
}



function buildRouterPrompt(message, candidates) {
  const list = candidates.map(s => `- ${s.name}: ${s.description || '(sem descrição)'}`).join('\n')
  return [
    'Você roteia especialistas (skills) para um agente de IA. Cada skill é um bloco de instruções especializadas que pode ser injetado no system prompt.',
    'Escolha SOMENTE as skills cujo domínio é claramente relevante para a mensagem do usuário. Se nenhuma for relevante, responda com lista vazia. Não invente nomes.',
    '',
    'Skills disponíveis:',
    list,
    '',
    'Mensagem do usuário:',
    '"""',
    message,
    '"""',
    '',
    'Responda APENAS com JSON: {"skills": ["Nome1", "Nome2"]}',
  ].join('\n')
}

function extractText(res) {
  if (!res) return ''
  if (typeof res === 'string') return res
  return res.text
    ?? res.content
    ?? res.choices?.[0]?.message?.content
    ?? res.data?.text
    ?? ''
}

function parseSkillNames(text, validNames) {
  try {
    const parsed = JSON.parse(String(text ?? '').trim())
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.skills)) {
      return { ok: false, reason: 'invalid_response_shape' }
    }
    if (parsed.skills.some(name => typeof name !== 'string')) {
      return { ok: false, reason: 'invalid_skill_name' }
    }
    const unknown = parsed.skills.find(name => !validNames.has(name))
    if (unknown) return { ok: false, reason: 'unknown_skill' }
    return { ok: true, selected: [...new Set(parsed.skills)] }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

const CACHE = new Map()
const CACHE_TTL = 300_000 

function normalizeMessage(message) {
  return String(message ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
}

function catalogVersion(candidates) {
  return sha256(JSON.stringify(candidates.map(skill => ({
    name: skill.name,
    description: skill.description || '',
    hash: skill.hash || '',
  }))))
}

/**
 * Classifica uma mensagem em skills sem acoplar a decisão a uma sessão. O
 * resultado diferencia uma resposta vazia válida (`none`) de falha do router
 * (`failed`), para que a telemetria nunca confunda os dois casos.
 */
export async function classifySkills(message, candidates, {
  dispatch = $,
  cache = CACHE,
  now = () => Date.now(),
  mode = skillsMode(), recommend = observeSkills,
} = {}) {
  if (!message || !candidates.length) {
    return { status: 'none', selected: [], attempts: 0, model: null, latencyMs: 0, reason: 'no_candidates', cached: false }
  }

  mode = ['shadow', 'assist'].includes(mode) ? mode : 'off'
  const key = `${mode}::${catalogVersion(candidates)}::${normalizeMessage(message)}`
  const cached = cache.get(key)
  if (cached && now() - cached.ts < CACHE_TTL) {
    return { ...cached.decision, cached: true }
  }

  const startedAt = now()
  let lastFailure = 'unknown'
  let model = null
  let observation = null
  if (mode !== 'off') {
    try { observation = await recommend({ message, candidates, selected: [] }, { mode }) } catch { /* Roteador original é o fallback. */ }
  }
  const priority = mode === 'assist' && observation?.available === true
    && candidates.some(s => s.name === observation.recommendation) ? observation.recommendation : null
  const ordered = priority ? [...candidates.filter(s => s.name === priority), ...candidates.filter(s => s.name !== priority)] : candidates
  const withObservation = selected => observation ? { ...observation, selected: [...selected], agrees: observation.recommendation ? selected.includes(observation.recommendation) : null } : null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await dispatch('llm:call', {
        system: 'Responda apenas com JSON válido, sem markdown.',
        prompt: buildRouterPrompt(message, ordered),
        requirements: {
          requires: { modalities: ['text:input'], structuredOutput: true },
          prefers: { reasoning: 'low' },
        },
      })
      model = res?.model ?? model
      if (res?.success === false) {
        lastFailure = 'llm_unsuccessful'
        continue
      }
      const parsed = parseSkillNames(extractText(res), new Set(candidates.map(s => s.name)))
      if (!parsed.ok) {
        lastFailure = parsed.reason
        continue
      }
      const decision = {
        status: parsed.selected.length ? 'selected' : 'none',
        selected: parsed.selected,
        attempts: attempt,
        model,
        latencyMs: now() - startedAt,
        reason: parsed.selected.length ? 'valid_selection' : 'valid_empty_selection',
        cached: false,
        jev: withObservation(parsed.selected),
      }
      cache.set(key, { ts: now(), decision })
      return decision
    } catch {
      lastFailure = 'llm_error'
    }
  }

  return {
    status: 'failed', selected: [], attempts: 2, model,
    latencyMs: now() - startedAt, reason: lastFailure, cached: false, jev: withObservation([]),
  }
}

export function explicitDevelopmentSkill(message, candidates) {
  const text = normalizeMessage(message)
  const action = /\b(implemente|implementar|corrija|corrigir|refatore|refatorar|debug|implement|fix|refactor)\b/.test(text)
  const subject = /\b(código|codigo|bug|teste|testes|test|tests|arquivo|arquivos|pacote|package|runtime|prompt|prompts|engineer|api|rota|svelte|javascript|typescript)\b|\.(js|ts|svelte)\b/.test(text)
  return action && subject ? candidates.filter(s => s.name === 'Engineer').map(s => s.name) : []
}



/**
 * Retorna o bloco de skills (fixas + roteadas por relevância) já pronto para o
 * system prompt, ou '' se não houver nenhuma. Dispara `agent:skills:classified`.
 */
export async function composeSkillsBlock(sessionId = 'default', message = '') {
  return (await composeSkills(sessionId, message)).block
}

/**
 * Resolve o contexto dinâmico de uma skill e renderiza seu Markdown. Exportada
 * para permitir teste do contrato sem acoplar os testes ao bus global.
 */
export async function renderSkillBody(skill, sessionId, message, dispatch = $) {
  let context = {}
  if (skill.event) {
    context = await dispatch(skill.event, {
      sessionId,
      message,
      agent: skill.name,
    })
    if (context === null || typeof context !== 'object' || Array.isArray(context)) {
      throw new TypeError(`AGENT.md event "${skill.event}" must return an object`)
    }
  }

  return renderTemplate(skill.body, context, {
    baseDir: dirname(skill.absolutePath),
    allowedRoot: dirname(skill.absolutePath),
  })
}

export async function renderActiveSkills(active, sessionId, message, dispatch = $, logger = console) {
  const rendered = []
  for (const skill of active) {
    try {
      rendered.push({ skill, body: await renderSkillBody(skill, sessionId, message, dispatch) })
    } catch (error) {
      logger.warn(`[agent:skills] Failed to render ${skill.path}: ${error.message}`)
    }
  }
  return rendered
}

/**
 * Compõe as skills e devolve também a proveniência segura para auditoria do
 * contexto. O conteúdo das instruções fica apenas no prompt, nunca no trace.
 */
export async function composeSkills(sessionId = 'default', message = '', {
  discover = discoverSkills, dispatch = $, cache = CACHE, logger = console,
  mode = skillsMode(), recommend = observeSkills, protectedNames = [],
} = {}) {
  
  
  const skills = discover()
  if (!skills.length) return { block: '', sources: [], requiredTools: [] }

  const pinned = skills.filter(s => s.pinned)
  const candidates = skills.filter(s => !s.pinned)

  const routing = await classifySkills(message, candidates, { dispatch, cache, mode, recommend })
  const explicitNames = explicitDevelopmentSkill(message, candidates)
  const protectedEligible = protectedNames.filter(name => candidates.some(skill => skill.name === name))
  const selectedNames = [...new Set([...routing.selected, ...explicitNames, ...protectedEligible])]
  const active = [...pinned, ...candidates.filter(s => selectedNames.includes(s.name))]

  if (!routing.cached) {
    const observation = routing.jev
    if (observation) Promise.resolve().then(() => dispatch('cognitive:jev:skills', { sessionId, ...observation })).catch(() => {})
  }

  Promise.resolve().then(() => dispatch('agent:skills:classified', {
    sessionId,
    message,
    pinned: pinned.map(s => s.name),
    candidates: candidates.map(s => s.name),
    selected: selectedNames,
    status: selectedNames.length ? 'selected' : routing.status,
    routingStatus: routing.status,
    explicit: explicitNames,
    attempts: routing.attempts,
    model: routing.model,
    latencyMs: routing.latencyMs,
    reason: routing.reason,
    cached: routing.cached,
  })).catch(() => {})

  if (!active.length) return { block: '', sources: [], requiredTools: [] }

  const rendered = await renderActiveSkills(active, sessionId, message, dispatch, logger)

  const block = rendered.map(({ skill, body }) => `### ${skill.name}\n${body}`).join('\n\n---\n\n')
  const result = {
    block,
    
    
    
    requiredTools: [...new Set(rendered.flatMap(({ skill }) => skill.tools || []))],
    sources: rendered.map(({ skill: s, body }) => ({
      type: 'agent_md',
      name: s.name,
      path: s.path,
      activation: s.pinned ? 'pinned' : explicitNames.includes(s.name) || protectedEligible.includes(s.name) ? 'explicit_development' : 'routed',
      hash: s.hash,
      estimatedTokens: Math.ceil(body.length / 4),
      tools: s.tools || [],
    })),
  }
  return result
}
