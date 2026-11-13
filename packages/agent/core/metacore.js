













import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { callLLM } from '../llm/llm.js'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(PKG_DIR, '..', 'data')
const BAG_FILE = join(DATA_DIR, 'metacore-bag.json')



function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadBag() {
  ensureDataDir()
  try {
    if (!existsSync(BAG_FILE)) return getDefaultBag()
    return JSON.parse(readFileSync(BAG_FILE, 'utf8'))
  } catch {
    return getDefaultBag()
  }
}

function saveBag(bag) {
  ensureDataDir()
  bag.updatedAt = new Date().toISOString()
  writeFileSync(BAG_FILE, JSON.stringify(bag, null, 2), 'utf8')
}

function getDefaultBag() {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    patterns: [],
    crossSessionHints: [],
    commands: {},
    sessionStats: {},
  }
}



function fireEvent(name, payload) {
  try {
    import('logos').then(({ dispatchEvent }) => {
      dispatchEvent(name, payload).catch(() => {})
    }).catch(() => {})
  } catch {}
}



class Metacore {
  constructor() {
    this.sessionState = new Map()
    this._observeCount = 0
    this.config = {
      observationInterval: 3,
      loopThreshold: 3,
      noProgressThreshold: 5,
      similarityThreshold: 0.7,
      maxCommandsPerSession: 3,
      autoLearnInterval: 5,
      autoPruneInterval: 20,
      useLlmMatching: true,
      llmMatchThreshold: 0.6,
    }
  }

  

  /**
   * Chamado pelo Executor ao final de cada iteração.
   * AGORA TAMBÉM: auto-aprende padrões de sucesso, dispara auto-prune.
   */
  async observe(data) {
    const { sessionId, iteration, toolCalls = [], errors = [], madeProgress = true } = data

    if (!this.sessionState.has(sessionId)) {
      this.sessionState.set(sessionId, {
        lastToolCalls: [],
        consecutiveFailures: 0,
        noProgressCount: 0,
        totalErrors: 0,
        totalSuccesses: 0,
        lastObservation: null,
        lastCommand: null,
        successfulTools: new Set(),
        failedTools: new Set(),
        toolSequence: [],
      })
    }

    const state = this.sessionState.get(sessionId)

    state.lastToolCalls = toolCalls.map(tc => ({
      name: tc.name || tc.tool,
      input: tc.input || tc.args,
    }))

    if (errors.length > 0) {
      state.consecutiveFailures++
      state.totalErrors++
      for (const tc of toolCalls) state.failedTools.add(tc.name || tc.tool)
    } else {
      state.consecutiveFailures = 0
      for (const tc of toolCalls) state.successfulTools.add(tc.name || tc.tool)
      state.totalSuccesses++
    }

    if (!madeProgress) state.noProgressCount++
    else state.noProgressCount = 0

    for (const tc of toolCalls) {
      state.toolSequence.push({
        name: tc.name || tc.tool,
        success: errors.length === 0,
        iteration,
        timestamp: Date.now(),
      })
      if (state.toolSequence.length > 50) state.toolSequence.shift()
    }

    state.lastObservation = {
      iteration,
      toolCalls: state.lastToolCalls,
      errors,
      timestamp: new Date().toISOString(),
    }

    this._recordSessionStats(sessionId, data)
    this._observeCount++

    
    if (this._observeCount % this.config.autoLearnInterval === 0 && madeProgress && state.totalSuccesses > 2) {
      await this._autoLearn(data, state)
    }

    
    if (this._observeCount % this.config.autoPruneInterval === 0) {
      this.pruneOldHints()
      this._consolidateHints()
    }
  }

  /**
   * Auto-aprendizado: gera hint automaticamente baseado em padrões de tool calls bem-sucedidos.
   */
  async _autoLearn(data, state) {
    const { toolCalls = [] } = data
    const tools = toolCalls.map(tc => tc.name || tc.tool).filter(Boolean)
    if (tools.length === 0) return

    const uniqueTools = [...new Set(tools)]
    const pipeline = uniqueTools.slice(0, 5).join(' → ')

    await this.learnTemplate({
      sessionId: data.sessionId,
      objective: '',
      toolsUsed: uniqueTools,
      template: `Pipeline observada com sucesso: ${pipeline}. Use estas tools em sequência para resultados similares.`,
    })

    if (state.failedTools.size > 0 && state.successfulTools.size > 0) {
      const failedList = [...state.failedTools].slice(0, 3).join(', ')
      const successList = [...state.successfulTools].slice(0, 3).join(', ')
      await this.learnTemplate({
        sessionId: data.sessionId,
        objective: '',
        toolsUsed: [...state.successfulTools],
        template: `Ferramentas que falharam: ${failedList}. Ferramentas que funcionaram: ${successList}. Prefira as que funcionaram para tarefas similares.`,
      })
    }
  }

  /**
   * Retorna o comando pendente ou null.
   */
  getCommand(sessionId) {
    const bag = loadBag()
    const sessionCommands = bag.commands?.[sessionId]
    if (!sessionCommands || sessionCommands.length === 0) return null

    const command = sessionCommands.shift()
    if (sessionCommands.length === 0) delete bag.commands[sessionId]
    else bag.commands[sessionId] = sessionCommands
    saveBag(bag)
    return command
  }

  /**
   * Verifica padrões e emite comandos se necessário.
   * Chamado no início de cada iteração, ANTES de getCommand().
   */
  checkPatterns(sessionId) {
    const state = this.sessionState.get(sessionId)
    if (!state) return null

    const bag = loadBag()
    if (!bag.commands[sessionId]) bag.commands[sessionId] = []
    const commands = bag.commands[sessionId]
    if (commands.length >= this.config.maxCommandsPerSession) return null

    let command = null

    
    if (!command && state.noProgressCount >= this.config.noProgressThreshold) {
      command = {
        action: 'pause',
        instruction: `${state.noProgressCount} iterações sem progresso detectado. Resuma o que foi tentado e pergunte ao usuário qual direção seguir.`,
        reason: `no_progress:${state.noProgressCount}`,
        issuedAt: new Date().toISOString(),
      }
      commands.push(command)
      this._learnPattern({ pattern: 'stagnation', trigger: `${state.noProgressCount} iterations no progress`, action: 'pause_and_ask', learnedAt: new Date().toISOString() })
      fireEvent('metacore:pattern-detected', { sessionId, pattern: 'stagnation', noProgressCount: state.noProgressCount, command: command.reason })
    }

    
    if (!command && state.consecutiveFailures >= 3) {
      command = {
        action: 'reorient',
        instruction: `${state.consecutiveFailures} falhas consecutivas detectadas. Pare de tentar a mesma abordagem. Leia a documentação, verifique parâmetros, ou use outra ferramenta.`,
        reason: `consecutive_failures:${state.consecutiveFailures}`,
        issuedAt: new Date().toISOString(),
      }
      commands.push(command)
      this._learnPattern({ pattern: 'failure_cascade', trigger: `${state.consecutiveFailures} consecutive failures`, action: 'reorient', learnedAt: new Date().toISOString() })
      fireEvent('metacore:pattern-detected', { sessionId, pattern: 'failure_cascade', consecutiveFailures: state.consecutiveFailures, command: command.reason })
    }

    
    
    const recentTools = state.toolSequence.slice(-10)
    if (recentTools.length > 0) {
      const toolCounts = {}
      for (const tc of recentTools) {
        const key = tc.name
        toolCounts[key] = (toolCounts[key] || 0) + 1
      }
      for (const [toolName, count] of Object.entries(toolCounts)) {
        if (count >= this.config.loopThreshold) {
          command = {
            action: 'reorient',
            instruction: `Loop detectado: "${toolName}" chamado ${count}x com o mesmo input. Mude de abordagem — consulte documentação, tente argumentos diferentes, ou use outra tool.`,
            reason: `loop_detected:${toolName}`,
            issuedAt: new Date().toISOString(),
          }
          commands.push(command)
          this._learnPattern({ pattern: 'loop_repetition', trigger: `tool:${toolName}`, action: 'reorient', learnedAt: new Date().toISOString() })
          fireEvent('metacore:pattern-detected', { sessionId, pattern: 'loop_repetition', trigger: `tool:${toolName}`, command: command.reason })
          break
        }
      }
    }

    if (command) saveBag(bag)
    return command
  }

  /**
   * Busca hints de sessões anteriores similares.
   * AGORA COM FALLBACK LLM: se matching de palavras falhar mas houver overlap
   * de tools, usa callLLM para similaridade semântica.
   */
  async getHints(sessionId, objective = '', toolsUsed = []) {
    if (!objective && toolsUsed.length === 0) return null

    const bag = loadBag()
    if (!bag.crossSessionHints || bag.crossSessionHints.length === 0) return null

    const currentTools = toolsUsed.filter(Boolean)
    let bestMatch = null
    let bestScore = 0
    const wordMatchCandidates = []

    
    for (const hint of bag.crossSessionHints) {
      let score = 0

      if (hint.signature) {
        const hintTools = hint.signature.split('::').slice(0, 3).filter(Boolean)
        const matchCount = hintTools.filter(t => currentTools.includes(t)).length
        score += matchCount * 0.3
      }

      if (hint.objectiveFragment && objective) {
        const objectiveWords = new Set(objective.toLowerCase().split(/\s+/).filter(w => w.length > 3))
        const hintWords = new Set(hint.objectiveFragment.toLowerCase().split(/\s+/).filter(w => w.length > 3))
        const common = [...objectiveWords].filter(w => hintWords.has(w)).length
        const total = new Set([...objectiveWords, ...hintWords]).size
        if (total > 0) score += (common / total) * 0.4
      }

      if (hint.hitCount > 0) score += Math.min(hint.hitCount * 0.05, 0.15)

      if (score >= this.config.similarityThreshold && score > bestScore) {
        bestScore = score
        bestMatch = hint
      }

      if (score > 0 && score < this.config.similarityThreshold) {
        wordMatchCandidates.push({ hint, score })
      }
    }

    
    if (!bestMatch && wordMatchCandidates.length > 0 && this.config.useLlmMatching && objective) {
      bestMatch = await this._llmMatch(objective, wordMatchCandidates, currentTools)
    }

    if (bestMatch) {
      bestMatch.hitCount = (bestMatch.hitCount || 0) + 1
      saveBag(bag)
      return bestMatch.template
    }

    return null
  }

  /**
   * Usa LLM para determinar similaridade semântica.
   */
  async _llmMatch(objective, candidates, currentTools) {
    if (!objective || candidates.length === 0) return null

    const viableCandidates = candidates.filter(c => {
      if (!c.hint.signature) return false
      const hintTools = c.hint.signature.split('::').slice(0, 3).filter(Boolean)
      return hintTools.filter(t => currentTools.includes(t)).length >= 1
    })

    if (viableCandidates.length === 0) return null

    const candidateTexts = viableCandidates
      .map((c, i) => `[${i}] "${c.hint.objectiveFragment || '(sem objetivo)'}" — tools: ${(c.hint.signature || '').split('::').slice(0, 3).join(', ')}`)
      .join('\n')

    try {
      const response = await callLLM({
        system: 'Você é um classificador de similaridade entre tarefas. Responda APENAS com um JSON array contendo índices e scores de 0 a 1.',
        prompt: `Tarefa atual: "${objective}"\nTools disponíveis: ${currentTools.join(', ')}\n\nCandidatos:\n${candidateTexts}\n\nQual(is) candidato(s) é/são semanticamente similar(es) à tarefa atual? Retorne APENAS JSON: [{ "index": 0, "score": 0.85 }]`,
        model: 'gemma-3-12b-it',
      })

      const text = (response.text || response.content || '').trim()
      let jsonStr = text
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (jsonMatch) jsonStr = jsonMatch[1].trim()

      const results = JSON.parse(jsonStr)
      if (!Array.isArray(results)) return null

      let bestMatch = null
      let bestScore = 0
      for (const r of results) {
        if (r.score > bestScore && r.score >= this.config.llmMatchThreshold) {
          bestScore = r.score
          bestMatch = viableCandidates[r.index]?.hint || null
        }
      }

      return bestMatch
    } catch {
      return null
    }
  }

  /**
   * Registra um template implícito para reuso entre sessões.
   * AGORA COM CONSOLIDAÇÃO: se hint similar já existe, mescla em vez de duplicar.
   */
  async learnTemplate(data) {
    const { sessionId, objective = '', toolsUsed = [], template } = data
    if (!template) return

    const bag = loadBag()
    if (!bag.crossSessionHints) bag.crossSessionHints = []

    const signature = [
      ...toolsUsed.slice(0, 3).sort(),
      objective.slice(0, 50).toLowerCase().replace(/[^a-z0-9]/g, ''),
    ].join('::')

    const now = new Date().toISOString()

    
    const existingSimilar = bag.crossSessionHints.find(h => {
      if (h.signature === signature) return true
      if (toolsUsed.length >= 2 && h.tools) {
        const myTop2 = toolsUsed.slice(0, 2).sort()
        const hTop2 = (h.tools || []).slice(0, 2).sort()
        if (myTop2.length === 2 && hTop2.length === 2 && myTop2[0] === hTop2[0] && myTop2[1] === hTop2[1]) return true
      }
      return false
    })

    if (existingSimilar) {
      if (existingSimilar.template !== template) {
        existingSimilar.template = `${existingSimilar.template} | ${template}`
      }
      existingSimilar.updatedAt = now
      existingSimilar.hitCount = (existingSimilar.hitCount || 0) + 1
      const mergedTools = new Set([...(existingSimilar.tools || []), ...toolsUsed])
      existingSimilar.tools = [...mergedTools]
    } else {
      bag.crossSessionHints.push({
        signature,
        objectiveFragment: objective.slice(0, 100),
        template,
        tools: toolsUsed.slice(0, 10),
        createdAt: now,
        updatedAt: now,
        hitCount: 1,
      })
    }

    saveBag(bag)
    fireEvent('metacore:learned', { sessionId, signature, template: template.slice(0, 100), consolidated: !!existingSimilar })
  }

  /**
   * Consolida hints com overlap ≥50% de tools.
   */
  _consolidateHints() {
    const bag = loadBag()
    if (!bag.crossSessionHints || bag.crossSessionHints.length < 2) return

    const hints = bag.crossSessionHints
    const merged = new Set()
    const consolidated = []

    for (let i = 0; i < hints.length; i++) {
      if (merged.has(i)) continue
      merged.add(i)

      let base = { ...hints[i] }
      base.tools = [...(base.tools || [])]
      base.hitCount = base.hitCount || 1

      for (let j = i + 1; j < hints.length; j++) {
        if (merged.has(j)) continue

        const baseTools = new Set(base.tools || [])
        const hintTools = new Set(hints[j].tools || [])
        const common = [...baseTools].filter(t => hintTools.has(t))
        const minSize = Math.min(baseTools.size, hintTools.size)
        if (minSize === 0) continue

        if (common.length / minSize >= 0.5) {
          merged.add(j)
          base.hitCount += (hints[j].hitCount || 1)
          base.tools = [...new Set([...base.tools, ...(hints[j].tools || [])])]
          if (hints[j].template && !base.template.includes(hints[j].template)) {
            base.template = `${base.template} | ${hints[j].template}`
          }
          base.updatedAt = new Date().toISOString()
        }
      }

      consolidated.push(base)
    }

    bag.crossSessionHints = consolidated
    saveBag(bag)
  }

  

  _learnPattern(pattern) {
    const bag = loadBag()
    if (!bag.patterns) bag.patterns = []

    const existing = bag.patterns.find(p => p.pattern === pattern.pattern && p.trigger === pattern.trigger)
    if (existing) {
      existing.hitCount = (existing.hitCount || 0) + 1
      existing.lastHitAt = new Date().toISOString()
    } else {
      bag.patterns.push({ ...pattern, hitCount: 1, lastHitAt: pattern.learnedAt })
    }

    saveBag(bag)
  }

  _recordSessionStats(sessionId, data) {
    const bag = loadBag()
    if (!bag.sessionStats) bag.sessionStats = {}

    if (!bag.sessionStats[sessionId]) {
      bag.sessionStats[sessionId] = {
        firstSeen: new Date().toISOString(),
        totalIterations: 0,
        totalErrors: 0,
        totalDuration: 0,
        toolsUsed: {},
        lastSeen: null,
      }
    }

    const stats = bag.sessionStats[sessionId]
    stats.totalIterations++
    if (data.errors?.length) stats.totalErrors += data.errors.length
    if (data.duration) stats.totalDuration += data.duration
    if (data.toolCalls) {
      for (const tc of data.toolCalls) {
        const name = tc.name || tc.tool
        if (!stats.toolsUsed[name]) stats.toolsUsed[name] = 0
        stats.toolsUsed[name]++
      }
    }
    stats.lastSeen = new Date().toISOString()

    saveBag(bag)
  }

  /**
   * Remove hints não utilizados por mais de N dias.
   */
  pruneOldHints(maxAgeDays = 30) {
    const bag = loadBag()
    if (!bag.crossSessionHints) return

    const now = Date.now()
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000
    const before = bag.crossSessionHints.length

    bag.crossSessionHints = bag.crossSessionHints.filter(h => {
      if (h.hitCount && h.hitCount > 0) return true
      const createdAt = h.createdAt || h.updatedAt
      if (createdAt) return (now - new Date(createdAt).getTime()) < maxAge
      return true
    })

    const after = bag.crossSessionHints.length
    if (before !== after) console.log(`[Metacore] Prune: ${before - after} hint(s) removido(s) (${after} restantes)`)
    saveBag(bag)
  }

  /**
   * Retorna sumário detalhado do estado atual.
   */
  status() {
    const bag = loadBag()
    return {
      version: bag.version || 1,
      activeSessions: this.sessionState.size,
      patterns: {
        total: bag.patterns?.length || 0,
        byType: this._countBy(bag.patterns, 'pattern'),
      },
      crossSessionHints: {
        total: bag.crossSessionHints?.length || 0,
        totalHits: bag.crossSessionHints?.reduce((acc, h) => acc + (h.hitCount || 0), 0) || 0,
        neverUsed: bag.crossSessionHints?.filter(h => !h.hitCount || h.hitCount === 0).length || 0,
      },
      pendingCommands: Object.keys(bag.commands || {}).length,
      trackedSessions: Object.keys(bag.sessionStats || {}).length,
      observeCount: this._observeCount,
      config: this.config,
    }
  }

  _countBy(arr, key) {
    if (!arr) return {}
    const counts = {}
    for (const item of arr) {
      const val = item[key] || 'unknown'
      counts[val] = (counts[val] || 0) + 1
    }
    return counts
  }
}

let instance = null
export function getMetacore() {
  if (!instance) instance = new Metacore()
  return instance
}

export { Metacore }
