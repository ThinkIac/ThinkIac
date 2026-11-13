import { normalizeToolOutcome, toolOutcomeError } from './tool_outcome.js'

export const TURN_STATES = Object.freeze([
  'accepted', 'context-compiled', 'model-selected', 'model-responded', 'parsed',
  'governed', 'waiting-approval', 'tool-executing', 'checkpointed',
  'reconciling', 'finalized', 'failed',
])

const ALLOWED = new Map([
  ['accepted', new Set(['context-compiled', 'failed'])],
  ['context-compiled', new Set(['model-selected', 'governed', 'failed'])],
  ['model-selected', new Set(['model-responded', 'failed'])],
  ['model-responded', new Set(['parsed', 'checkpointed', 'failed'])],
  ['parsed', new Set(['governed', 'model-selected', 'finalized', 'failed'])],
  ['governed', new Set(['tool-executing', 'waiting-approval', 'checkpointed', 'failed'])],
  ['tool-executing', new Set(['checkpointed', 'reconciling', 'failed'])],
  ['checkpointed', new Set(['governed', 'model-selected', 'finalized', 'failed'])],
  ['waiting-approval', new Set(['governed', 'finalized', 'failed'])],
  ['reconciling', new Set(['checkpointed', 'failed'])],
  ['failed', new Set()],
  ['finalized', new Set()],
])

export class RunJournal {
  constructor(store = null, runId = null) {
    this.store = store
    this.runId = runId
  }

  checkpoint(phase, details = {}) {
    if (!this.store?.checkpoint || !this.runId) return null
    return this.store.checkpoint(this.runId, { phase, ...details })
  }
}

export class ResponseInterpreter {
  constructor({ parse }) { this.parse = parse }
  interpret(response) { return this.parse(response) }
}

export class GovernanceGate {
  constructor({ evaluate }) { this.evaluate = evaluate }
  async check(toolCall, context = {}) { return this.evaluate(toolCall, context) }
}

export class ToolExecutor {
  constructor({ invoke, now = Date.now }) {
    this.invoke = invoke
    this.now = now
  }

  async execute(toolCall, context = {}) {
    const startedAt = this.now()
    try {
      const value = await this.invoke(toolCall, context)
      return normalizeToolOutcome(value, {
        operationId: context.operationId,
        durationMs: this.now() - startedAt,
      })
    } catch (error) {
      return toolOutcomeError(error, {
        operationId: context.operationId,
        durationMs: this.now() - startedAt,
      })
    }
  }
}

export class OutcomeEvaluator {
  evaluate(outcomes = [], { finalText = null } = {}) {
    const succeeded = outcomes.filter(item => item?.ok)
    const failed = outcomes.filter(item => !item?.ok)
    const changedState = outcomes.some(item => item?.changedState === true)
    const verified = outcomes.some(item => item?.metrics?.verified === true)
    return {
      completed: Boolean(finalText) || (outcomes.length > 0 && failed.length === 0),
      madeProgress: Boolean(finalText) || succeeded.some(item => item.changedState !== false),
      changedState,
      verified,
      succeeded: succeeded.length,
      failed: failed.length,
    }
  }
}

export class TurnCoordinator {
  constructor({ emit = null, journal = null, context = {} } = {}) {
    this.state = 'accepted'
    this.emit = emit
    this.journal = journal
    this.context = context
  }

  transition(to, details = {}) {
    if (!ALLOWED.get(this.state)?.has(to)) {
      throw new Error(`Transição inválida do turno: ${this.state} -> ${to}`)
    }
    const from = this.state
    this.state = to
    const event = { ...this.context, from, to, ...details }
    this.journal?.checkpoint(to, details)
    this.emit?.('agent:turn-transition', event)
    return event
  }

  async replay({ compileContext, callModel, interpreter, gate, executor, evaluator }) {
    const compiled = await compileContext()
    this.transition('context-compiled')
    this.transition('model-selected')
    const response = await callModel(compiled)
    this.transition('model-responded')
    const parsed = await interpreter.interpret(response)
    this.transition('parsed')

    const outcomes = []
    for (const toolCall of parsed.tool_calls || []) {
      const decision = await gate.check(toolCall, this.context)
      this.transition('governed', { toolCallId: toolCall.id })
      if (!decision?.allowed) {
        this.transition('waiting-approval', { toolCallId: toolCall.id })
        break
      }
      this.transition('tool-executing', { toolCallId: toolCall.id })
      outcomes.push(await executor.execute(toolCall, this.context))
      this.transition('checkpointed', { phase: 'tool-completed', toolCallId: toolCall.id })
    }

    const evaluation = evaluator.evaluate(outcomes, { finalText: parsed.text })
    if (this.state === 'waiting-approval') this.transition('finalized', { reason: 'waiting-approval' })
    else if (this.state !== 'finalized') this.transition('finalized', evaluation)
    return { response, parsed, outcomes, evaluation }
  }
}
