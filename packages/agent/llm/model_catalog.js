const DEFAULT_WEIGHTS = Object.freeze({ quality: 0.6, cost: 0.2, latency: 0.2 })

const CAPABILITY_ALIASES = Object.freeze({
  tools: 'tools.supported',
  vision: 'modalities.vision.input',
  image: 'modalities.image.output',
  audioInput: 'modalities.audio.input',
  audioOutput: 'modalities.audio.output',
  structuredOutput: 'structuredOutput',
  streaming: 'streaming',
  reasoning: 'reasoning.supported',
})

function getPath(value, path) {
  return String(path).split('.').reduce((cursor, key) => cursor?.[key], value)
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function normalizeWeights(weights = {}) {
  const merged = { ...DEFAULT_WEIGHTS, ...weights }
  const total = Object.values(merged).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0) || 1
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, Math.max(0, Number(value) || 0) / total]))
}

function purposeRelevance(purpose, intent) {
  if (!purpose || !intent) return 0
  const tokens = String(intent).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(token => token.length >= 4)
  if (!tokens.length) return 0
  const text = `${purpose.name} ${purpose.description}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const matches = tokens.filter(token => text.includes(token)).length
  return matches / tokens.length
}

function mergeObjects(base = {}, override = {}) {
  const result = { ...base }
  for (const [key, value] of Object.entries(override ?? {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeObjects(base?.[key] ?? {}, value)
      : value
  }
  return result
}

function normalizePurpose(value) {
  if (typeof value === 'string' && value.trim()) return { name: value.trim(), description: '' }
  if (!value || typeof value !== 'object' || !String(value.name ?? '').trim()) return null
  return { name: String(value.name).trim(), description: String(value.description ?? '').trim() }
}

function modelsForPool(pool = {}, slot = null) {
  if (Array.isArray(pool.models) && pool.models.length) {
    return pool.models.map(entry => typeof entry === 'string' ? { id: entry } : entry).filter(entry => entry?.id)
  }
  const model = slot?.model ?? pool.model ?? null
  return [{ id: model }]
}

function normalizeAccess(pool = {}, slot = null, modelConfig = {}) {
  const provider = slot?.provider ?? pool.provider ?? 'openrouter'
  const mode = slot?.mode ?? pool.mode ?? (provider.endsWith('-cli') ? 'cli' : 'api')
  const accessId = slot?.poolName ?? pool.id ?? pool.name ?? provider
  const model = modelConfig.id ?? slot?.model ?? pool.model ?? null
  const modelKey = model ?? `default:${provider}`

  
  
  
  
  
  
  
  
  
  
  
  
  const poolCapabilityModel = pool.capabilities_model ?? pool.model ?? slot?.model ?? null
  const inheritsPoolCapabilities = !Array.isArray(pool.models) || mode === 'cli' || model === poolCapabilityModel
  const declared = mergeObjects(
    inheritsPoolCapabilities ? (pool.capabilities ?? {}) : {},
    modelConfig.capabilities ?? {},
  )
  const purpose = normalizePurpose(modelConfig.purpose)
  return {
    id: `${modelKey}@${accessId}`,
    model,
    name: String(modelConfig.name ?? model ?? accessId),
    purpose,
    accessId,
    provider,
    mode,
    enabled: pool.enabled !== false,
    
    
    
    authenticated: slot ? (slot.mode === 'cli' || slot.keyless === true || Boolean(slot.key)) : pool.authenticated !== false,
    available: pool.available !== false,
    capabilities: {
      modalities: {
        text: { input: true, output: true, ...declared.modalities?.text },
        vision: { input: false, ...declared.modalities?.vision },
        image: { output: false, ...declared.modalities?.image },
        audio: { input: false, output: false, ...declared.modalities?.audio },
      },
      tools: { supported: false, parallel: false, strictSchema: false, ...declared.tools },
      reasoning: { supported: false, levels: [], ...declared.reasoning },
      structuredOutput: false,
      streaming: true,
      contextWindow: null,
      maxOutputTokens: null,
      ...declared,
    },
    economics: {
      inputCost: null,
      outputCost: null,
      costScore: null,
      ...pool.economics,
      ...modelConfig.economics,
    },
    operational: {
      latencyMs: null,
      quotaRemaining: null,
      ...pool.operational,
      ...modelConfig.operational,
    },
    evidence: [...(Array.isArray(pool.evidence) ? pool.evidence : []), ...(Array.isArray(modelConfig.evidence) ? modelConfig.evidence : [])],
    metadata: {
      poolName: pool.id ?? pool.name ?? accessId,
      
      
      poolLabel: pool.label ?? pool.id ?? pool.name ?? accessId,
      slotId: slot?.id ?? null,
      defaultModel: model === (pool.model ?? slot?.model ?? null),
      
      
      limits: modelConfig.limits ?? pool.limits ?? null,
    },
  }
}

export function buildModelCatalog(config = {}, { slots = [] } = {}) {
  const pools = config?.llm?.pools ?? []
  const poolByName = new Map(pools.flatMap(pool => [[pool.id, pool], [pool.name, pool]].filter(([key]) => key)))
  const accesses = []

  if (slots.length) {
    for (const slot of slots) {
      const pool = poolByName.get(slot.poolName) ?? { name: slot.poolName, enabled: true }
      for (const modelConfig of modelsForPool(pool, slot)) {
        const access = normalizeAccess(pool, slot, modelConfig)
        if (access && !accesses.some(item => item.id === access.id)) accesses.push(access)
      }
    }
  } else {
    for (const pool of pools) {
      for (const modelConfig of modelsForPool(pool)) {
        const access = normalizeAccess(pool, null, modelConfig)
        if (access && !accesses.some(item => item.id === access.id)) accesses.push(access)
      }
    }
  }

  return { version: 1, generatedAt: new Date().toISOString(), accesses }
}

function capabilityRequirementEntries(requires = {}) {
  const entries = []
  for (const [key, expected] of Object.entries(requires.capabilities ?? {})) {
    entries.push([CAPABILITY_ALIASES[key] ?? key, expected])
  }
  if (requires.tools != null) entries.push(['tools.supported', requires.tools])
  if (requires.structuredOutput != null) entries.push(['structuredOutput', requires.structuredOutput])
  for (const modality of requires.modalities ?? []) {
    const [name, direction = 'input'] = String(modality).split(':')
    entries.push([`modalities.${name}.${direction}`, true])
  }
  return entries
}

function rejectReasons(access, requires = {}) {
  const reasons = []
  if (!access.enabled) reasons.push('access_disabled')
  if (!access.available) reasons.push('access_unavailable')
  if (!access.authenticated) reasons.push('access_unauthenticated')
  if (requires.providers?.length && !requires.providers.includes(access.provider)) reasons.push('provider_not_allowed')
  if (requires.accessModes?.length && !requires.accessModes.includes(access.mode)) reasons.push('access_mode_not_allowed')
  if (requires.minContextWindow && (access.capabilities.contextWindow ?? 0) < requires.minContextWindow) {
    reasons.push('context_window_too_small')
  }
  if (requires.minOutputTokens && (access.capabilities.maxOutputTokens ?? 0) < requires.minOutputTokens) {
    reasons.push('output_limit_too_small')
  }
  for (const [path, expected] of capabilityRequirementEntries(requires)) {
    const actual = getPath(access.capabilities, path)
    if (expected === true && actual !== true) reasons.push(`missing:${path}`)
    else if (expected === false && actual !== false) reasons.push(`forbidden:${path}`)
    else if (Array.isArray(expected) && !expected.every(value => actual?.includes?.(value))) reasons.push(`missing:${path}`)
  }
  return reasons
}

function evidenceScore(access, relevantCapabilities = []) {
  const evidence = access.evidence.filter(item =>
    item && Number.isFinite(Number(item.score)) &&
    (!relevantCapabilities.length || relevantCapabilities.includes(item.capability)))
  if (!evidence.length) return 0.5
  let weighted = 0
  let weight = 0
  for (const item of evidence) {
    const confidence = clamp(item.confidence ?? 0.5)
    weighted += clamp(Number(item.score) > 1 ? Number(item.score) / 10 : item.score) * confidence
    weight += confidence
  }
  return weight ? weighted / weight : 0.5
}

function scoreAccess(access, contract) {
  const weights = normalizeWeights(contract.policy)
  const relevant = capabilityRequirementEntries(contract.requires).map(([path]) => path)
  const quality = evidenceScore(access, relevant)
  const cost = access.economics.costScore == null ? 0.5 : clamp(access.economics.costScore)
  const latencyMs = access.operational.latencyMs
  const latency = latencyMs == null ? 0.5 : 1 / (1 + Math.max(0, latencyMs) / 1000)
  const preferenceBonus =
    (contract.prefers?.providers?.includes(access.provider) ? 0.03 : 0) +
    (contract.prefers?.accessModes?.includes(access.mode) ? 0.02 : 0) +
    (contract.prefers?.purpose && access.purpose?.name === contract.prefers.purpose ? 0.1 : 0) +
    (purposeRelevance(access.purpose, contract.prefers?.intent) * 0.1) +
    (access.metadata?.defaultModel ? 0.01 : 0)
  return {
    total: clamp(quality * weights.quality + cost * weights.cost + latency * weights.latency + preferenceBonus),
    quality,
    cost,
    latency,
    weights,
  }
}

export function resolveModel(catalog, contract = {}) {
  const normalized = {
    requires: contract.requires ?? {},
    prefers: contract.prefers ?? {},
    policy: contract.policy ?? DEFAULT_WEIGHTS,
    override: contract.override ?? null,
  }
  const rejected = []
  const eligible = []

  for (const access of catalog?.accesses ?? []) {
    const reasons = rejectReasons(access, normalized.requires)
    if (reasons.length) rejected.push({ id: access.id, model: access.model, accessId: access.accessId, reasons })
    else eligible.push({ ...access, score: scoreAccess(access, normalized) })
  }

  if (normalized.override) {
    const selected = (catalog?.accesses ?? []).find(access =>
      access.id === normalized.override ||
      (access.model === normalized.override && !String(normalized.override).includes('@')))
    if (!selected) return { ok: false, code: 'override_not_found', selected: null, candidates: [], rejected }
    const reasons = rejectReasons(selected, normalized.requires)
    if (reasons.length) {
      return { ok: false, code: 'override_incompatible', selected: null, candidates: eligible, rejected: [{ id: selected.id, reasons }, ...rejected] }
    }
    return {
      ok: true,
      source: 'override',
      selected: { ...selected, score: scoreAccess(selected, normalized) },
      candidates: eligible.sort((a, b) => b.score.total - a.score.total),
      rejected,
      explanation: `Override explícito ${selected.id}; todos os requisitos obrigatórios foram atendidos.`,
    }
  }

  eligible.sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id))
  const selected = eligible[0] ?? null
  return {
    ok: Boolean(selected),
    code: selected ? null : 'no_compatible_model',
    source: 'resolver',
    selected,
    candidates: eligible,
    rejected,
    explanation: selected
      ? `${selected.id} venceu entre ${eligible.length} acesso(s) compatível(is); ${rejected.length} rejeitado(s) por requisitos.`
      : `Nenhum acesso atende aos requisitos; ${rejected.length} candidato(s) rejeitado(s).`,
  }
}

export function attachEvidence(catalog, evidence = []) {
  const byTarget = new Map()
  for (const item of evidence) {
    if (!item?.target) continue
    const list = byTarget.get(item.target) ?? []
    list.push(item)
    byTarget.set(item.target, list)
  }
  return {
    ...catalog,
    accesses: (catalog?.accesses ?? []).map(access => ({
      ...access,
      evidence: [...access.evidence, ...(byTarget.get(access.id) ?? []), ...(byTarget.get(access.model) ?? [])],
    })),
  }
}
