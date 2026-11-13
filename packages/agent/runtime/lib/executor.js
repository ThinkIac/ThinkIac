/** Executor ReAct portátil. Hosts injetam modelo, catálogo MCP e telemetria. */
export function validateAgainstSchema(value, schema) {
  function visit(current, spec, path = '$') {
    if (spec.const !== undefined && current !== spec.const) return `${path} should equal ${JSON.stringify(spec.const)}`
    if (spec.enum && !spec.enum.includes(current)) return `${path} should be one of ${spec.enum.join(', ')}`
    if (spec.type) {
      const actual = Array.isArray(current) ? 'array' : current === null ? 'null' : typeof current
      if (actual !== spec.type) return `${path} should be ${spec.type}, got ${actual}`
    }
    if (spec.type === 'object') {
      for (const key of spec.required ?? []) if (!(key in current)) return `missing required field "${path}.${key}"`
      for (const [key, child] of Object.entries(spec.properties ?? {})) {
        if (key in current) { const error = visit(current[key], child, `${path}.${key}`); if (error) return error }
      }
    }
    if (spec.type === 'array') {
      if (spec.minItems != null && current.length < spec.minItems) return `${path} should contain at least ${spec.minItems} items`
      if (spec.items) for (let index = 0; index < current.length; index++) { const error = visit(current[index], spec.items, `${path}[${index}]`); if (error) return error }
    }
    return null
  }
  return visit(value, schema)
}

function parseJsonLoose(text) {
  const trimmed = String(text ?? '').trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return JSON.parse(fenced ? fenced[1] : trimmed)
}

function serializeToolResult(value) {
  const seen = new WeakSet()
  try {
    return JSON.stringify(value, (key, current) => {
      if (key === '_scriba') return '[Runtime]'
      if (typeof current === 'bigint') return String(current)
      if (typeof current === 'object' && current !== null) {
        if (seen.has(current)) return '[Circular]'
        seen.add(current)
      }
      return current
    }) ?? 'null'
  } catch {
    return '{"error":"resultado não serializável"}'
  }
}

function normalizeToolCall(raw) {
  if (raw?.function) {
    let args = raw.function.arguments
    if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = {} } }
    return { id: raw.id, name: raw.function.name, args: args ?? {} }
  }
  return { id: raw?.id, name: raw?.name, args: raw?.input ?? raw?.arguments ?? {} }
}

/**
 * Cria um executor sem acoplamento a runtime, provider ou transporte.
 * callModel({ system, messages, tools, model }, context) e resolveTools(context)
 * são as únicas portas obrigatórias do host.
 */
export function createAgentExecutor({
  callModel,
  resolveTools = async () => [],
  emitTrace = async () => {},
  beforeTool = async () => {},
  afterTool = async () => {},
  shouldStop = async () => false,
  persistArtifact = null,
  redactTrace = (event) => event,
  now = () => Date.now(),
  estimateCost = null,
} = {}) {
  if (typeof callModel !== 'function') throw new TypeError('AgentExecutor exige callModel()')
  const traceEvent = async (event, context) => { await emitTrace(event, context) }

  async function run(opts = {}) {
    const workflow = opts.workflow ?? {}
    const maxSteps = workflow.budget?.maxSteps ?? opts.maxSteps ?? 8
    const maxDurationMs = workflow.budget?.maxDurationMs ?? opts.maxDurationMs ?? Infinity
    const maxToolCalls = workflow.budget?.maxToolCalls ?? opts.maxToolCalls ?? Infinity
    const maxOutputRetries = opts.maxOutputRetries ?? 2
    const context = opts.context
    const startedAt = now()
    const runId = workflow.runId ?? opts.runId ?? globalThis.crypto?.randomUUID?.() ?? `run-${startedAt}`
    const taskId = workflow.taskId ?? opts.taskId ?? null
    let phase = workflow.phase ?? 'framed'
    let sequence = 0
    let toolCalls = 0
    let tools = opts.tools ?? await resolveTools(context)
    const allowedNames = workflow.allowedTools ?? opts.toolNames
    if (allowedNames) { const allowed = new Set(allowedNames); tools = tools.filter((tool) => allowed.has(tool.name)) }
    const toolSchemas = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema }))
    const messages = opts.messages ? [...opts.messages] : []
    if (opts.goal) messages.push({ role: 'user', content: opts.goal })
    const trace = []; let outputRetries = 0
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    let reportedCostUsd = null
    const addUsage = (response) => {
      const value = response?.usage
      if (!value || typeof value !== 'object') return
      const prompt = Number(value.prompt_tokens ?? value.input_tokens ?? value.inputTokens ?? 0)
      const completion = Number(value.completion_tokens ?? value.output_tokens ?? value.outputTokens ?? 0)
      usage.prompt_tokens += Number.isFinite(prompt) ? prompt : 0
      usage.completion_tokens += Number.isFinite(completion) ? completion : 0
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
      const cost = Number(response.costUsd ?? response.total_cost_usd ?? value.cost ?? value.total_cost_usd)
      if (Number.isFinite(cost) && cost >= 0) reportedCostUsd = (reportedCostUsd ?? 0) + cost
    }
    const usageResult = (result, model) => {
      const hasUsage = usage.total_tokens > 0
      const costUsd = reportedCostUsd ?? (hasUsage && typeof estimateCost === 'function' ? estimateCost(model, usage) : null)
      return { ...result, ...(hasUsage ? { usage } : {}), ...(Number.isFinite(costUsd) ? { costUsd } : {}) }
    }
    const report = async (event) => {
      const safeEvent = await redactTrace(event, context)
      const enriched = { runId, taskId, phase, sequence: sequence++, ...safeEvent }
      trace.push(enriched)
      await traceEvent(enriched, context)
      return enriched
    }
    const finish = (result, terminalReason) => ({ ...result, runId, taskId, phase, terminalReason, trace })
    const budgetExceeded = () => now() - startedAt >= maxDurationMs || toolCalls >= maxToolCalls

    for (let step = 0; step < maxSteps; step++) {
      if (budgetExceeded()) {
        await report({ step, type: 'budget_exhausted', budget: now() - startedAt >= maxDurationMs ? 'duration' : 'tool_calls' })
        return finish(usageResult({ success: false, error: 'workflow budget exhausted', steps: step }, opts.model), 'budget_exhausted')
      }
      const stop = await shouldStop({ runId, taskId, phase, step, toolCalls, elapsedMs: now() - startedAt }, context)
      if (stop) {
        await report({ step, type: 'stopped', reason: typeof stop === 'string' ? stop : 'host_requested' })
        return finish(usageResult({ success: false, error: 'execution stopped by host', steps: step }, opts.model), 'cancelled')
      }
      let response
      try { response = await callModel({ system: opts.system, messages, tools: toolSchemas, model: opts.model }, context) }
      catch (error) { const event = { step, type: 'error', error: error.message }; await report(event); return finish(usageResult({ success: false, error: event.error, steps: step }, opts.model), 'failed') }
      if (!response || response.success === false) {
        const event = { step, type: 'error', error: response?.error || 'llm call failed' }; await report(event)
        return finish(usageResult({ success: false, error: event.error, steps: step }, opts.model), 'failed')
      }
      addUsage(response)
      const rawCalls = response.tool_calls ?? response.toolCalls ?? []
      if (!rawCalls.length) {
        if (opts.outputSchema) {
          let output; let error = null
          try { output = parseJsonLoose(response.text) } catch (cause) { error = `invalid JSON: ${cause.message}` }
          if (!error) error = validateAgainstSchema(output, opts.outputSchema)
          if (error) {
            outputRetries++; await report({ step, type: 'output_invalid', error })
            if (outputRetries > maxOutputRetries) return finish(usageResult({ success: false, error: `output schema validation failed: ${error}`, steps: step + 1 }, response.model ?? opts.model), 'failed')
            messages.push({ role: 'assistant', content: response.text || '' })
            messages.push({ role: 'user', content: `Your last response did not match the required JSON shape (${error}). Reply again with ONLY a valid JSON object matching the schema, no prose.` })
            continue
          }
          await report({ step, type: 'final', text: response.text })
          return finish(usageResult({ success: true, text: response.text, output, model: response.model, steps: step + 1 }, response.model ?? opts.model), 'completed')
        }
        await report({ step, type: 'final', text: response.text })
        return finish(usageResult({ success: true, text: response.text, model: response.model, steps: step + 1 }, response.model ?? opts.model), 'completed')
      }
      const calls = rawCalls.map(normalizeToolCall)
      messages.push({ role: 'assistant', content: response.text || '', tool_calls: rawCalls })
      await report({ step, type: 'tool_calls', calls: calls.map(({ name, args }) => ({ name, args })) })
      for (const call of calls) {
        if (toolCalls >= maxToolCalls) {
          await report({ step, type: 'budget_exhausted', budget: 'tool_calls' })
          return finish(usageResult({ success: false, error: 'workflow budget exhausted', steps: step + 1 }, response.model ?? opts.model), 'budget_exhausted')
        }
        const tool = tools.find((candidate) => candidate.name === call.name)
        let result
        if (!tool) result = { error: `Unknown tool: ${call.name}` }
        else {
          try {
            await beforeTool({ runId, taskId, phase, step, call }, context)
            toolCalls++
            result = await tool.handler(call.args, context)
            const hookResult = await afterTool({ runId, taskId, phase, step, call, result }, context)
            if (hookResult?.phase) phase = hookResult.phase
          } catch (error) { result = { error: error.message } }
        }
        let traceResult = result
        const serialized = serializeToolResult(result)
        const artifactThreshold = workflow.artifactThresholdBytes ?? Infinity
        if (persistArtifact && Buffer.byteLength(serialized) > artifactThreshold) {
          const artifact = await persistArtifact({ kind: 'tool_result', content: serialized, runId, taskId, tool: call.name }, context)
          traceResult = { summary: serialized.slice(0, 1024), artifactRef: artifact.id ?? artifact.artifactRef, truncated: true }
        }
        await report({ step, type: 'tool_result', name: call.name, result: traceResult })
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: serializeToolResult(result) })
      }
    }
    await report({ type: 'max_steps_reached' })
    return finish(usageResult({ success: false, error: 'max steps reached', steps: maxSteps }, opts.model), 'budget_exhausted')
  }
  async function runChain(steps, initial = {}) {
    const context = { initial, results: {} }
    for (const step of steps) {
      const goal = typeof step.input === 'function' ? step.input(context) : String(step.input).replace(/{{\s*([^}]+)\s*}}/g, (_, path) => path.split('.').reduce((value, key) => value?.[key], context) ?? '')
      const result = await run({ ...step, goal })
      context.results[step.name] = result
      if (!result.success) break
    }
    return context
  }
  return Object.freeze({ run, runChain })
}
