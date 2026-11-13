




















const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 8192

/**
 * Resolve os headers de autenticação pra um slot Anthropic (API key paga).
 */
export function getAnthropicHeaders(slot) {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'x-api-key': slot.key,
  }
}



function convertUserContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)

  return content.map(block => {
    if (block?.type === 'text') return { type: 'text', text: block.text ?? '' }
    if (block?.type === 'image_url') {
      const url = block.image_url?.url ?? ''
      const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/)
      return dataMatch
        ? { type: 'image', source: { type: 'base64', media_type: dataMatch[1], data: dataMatch[2] } }
        : { type: 'image', source: { type: 'url', url } }
    }
    return { type: 'text', text: JSON.stringify(block) }
  })
}

/**
 * Converte o histórico interno do Agent (mensagens OpenAI-chat-shape,
 * incluindo um `{role:'tool', tool_call_id, content}` por chamada de tool,
 * empilhadas sequencialmente pelo agentLoop) pro formato de content blocks
 * da Anthropic — que exige TODOS os tool_result de um turno numa única
 * mensagem `user` subsequente ao `assistant` com os `tool_use`.
 */
function convertMessages(messages) {
  const out = []
  let pendingToolResults = null

  const flush = () => {
    if (pendingToolResults?.length) out.push({ role: 'user', content: pendingToolResults })
    pendingToolResults = null
  }

  for (const m of messages ?? []) {
    if (m.role === 'tool') {
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      const isError = raw.startsWith('ERROR: ')
      if (!pendingToolResults) pendingToolResults = []
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: isError ? raw.slice('ERROR: '.length) : raw,
        ...(isError ? { is_error: true } : {}),
      })
      continue
    }

    flush()

    if (m.role === 'assistant') {
      const blocks = []
      if (m.content) {
        blocks.push({ type: 'text', text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })
      }
      for (const tc of m.tool_calls ?? []) {
        let input = {}
        try { input = JSON.parse(tc.function?.arguments ?? '{}') } catch { /* mantém {} */ }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input })
      }
      out.push({ role: 'assistant', content: blocks.length ? blocks : '(sem conteúdo)' })
      continue
    }

    
    out.push({ role: 'user', content: convertUserContent(m.content) })
  }

  flush()
  return out
}

/** BUILTIN_SCHEMAS já usa {name, description, input_schema} — formato nativo da Anthropic. */
function convertTools(tools) {
  return (tools ?? []).map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema ?? { type: 'object', properties: {} },
  }))
}

export function buildAnthropicBody({ model, system, messages, tools, maxTokens, temperature }) {
  const body = {
    model,
    max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS, 
    messages: convertMessages(messages),
  }
  if (system) body.system = system
  const convertedTools = convertTools(tools)
  if (convertedTools.length) body.tools = convertedTools
  if (temperature != null) body.temperature = temperature
  return body
}



const FINISH_REASON_MAP = {
  end_turn: 'stop',
  tool_use: 'tool_calls',
  max_tokens: 'length',
  stop_sequence: 'stop',
  refusal: 'content_filter',
  pause_turn: 'stop',
}

/**
 * Converte a resposta da Messages API pro mesmo shape que runCliSlot() e o
 * corpo OpenAI-shape já produzem — parseResponse() em llm.js não precisa
 * saber a diferença.
 */
export function anthropicResponseToOpenAIShape(json) {
  const blocks = json.content ?? []
  const textParts = []
  const toolCalls = []
  let reasoningText = null

  for (const block of blocks) {
    if (block.type === 'text') textParts.push(block.text ?? '')
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      })
    } else if (block.type === 'thinking') {
      reasoningText = [reasoningText, block.thinking].filter(Boolean).join('\n') || null
    }
  }

  return {
    choices: [{
      message: {
        content: textParts.join('\n'),
        reasoning_content: reasoningText ?? undefined,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
      finish_reason: FINISH_REASON_MAP[json.stop_reason] ?? 'stop',
    }],
    model: json.model,
    usage: json.usage
      ? {
          prompt_tokens: json.usage.input_tokens ?? 0,
          completion_tokens: json.usage.output_tokens ?? 0,
          total_tokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
        }
      : undefined,
  }
}

export function isAnthropicProvider(providerName) {
  return providerName === 'anthropic'
}
