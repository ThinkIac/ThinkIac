
















const CLI_TOOL_CALL_RE = /```tool_call\s*([\s\S]*?)```/g

/**
 * Monta o preâmbulo que ensina o modelo a chamar ferramentas via blocos
 * ```tool_call```. Vários blocos em sequência = várias tools no mesmo turno
 * (o resultado de todas volta na próxima mensagem). Vazio se não há tools.
 */
export function buildCliToolsPreamble(tools) {
  if (!tools?.length) return ''
  const list = tools
    .map(t => `- ${t.name}: ${t.description ?? ''}\n  input_schema: ${JSON.stringify(t.input_schema ?? {})}`)
    .join('\n')

  return [
    '# Ferramentas disponíveis',
    'Para chamar uma ferramenta, emita um bloco no formato exato abaixo (um bloco por chamada; pode emitir vários em sequência e nada mais depois deles — o resultado volta na próxima mensagem):',
    '```tool_call',
    '{"name": "<nome_da_ferramenta>", "input": {...}}',
    '```',
    'Se não precisar de nenhuma ferramenta, responda normalmente em texto, sem blocos tool_call.',
    '',
    list,
  ].join('\n')
}

/**
 * Extrai blocos ```tool_call``` de um texto livre e devolve o texto limpo
 * (sem os blocos) + a lista de tool_calls no formato OpenAI-like usado pelo
 * resto do pipeline. Suporta múltiplos blocos (várias tools por turno). Blocos
 * com JSON inválido são ignorados (log + descarte), nunca derrubam a resposta.
 */
export function extractCliToolCalls(rawText) {
  const toolCalls = []
  let idx = 0

  const cleaned = String(rawText ?? '').replace(CLI_TOOL_CALL_RE, (_match, body) => {
    try {
      const parsed = JSON.parse(body.trim())
      if (parsed?.name) {
        toolCalls.push({
          id: `cli_call_${Date.now()}_${idx++}`,
          type: 'function',
          function: { name: parsed.name, arguments: JSON.stringify(parsed.input ?? {}) },
        })
      }
    } catch (e) {
      console.warn(`[text_tool_protocol] bloco tool_call com JSON inválido, ignorado: ${e.message}`)
    }
    return ''
  }).trim()

  return { cleaned, toolCalls }
}

/**
 * Achata system + histórico de mensagens (+ preâmbulo, se houver) num único
 * prompt de texto.
 *
 * Reserializa tool_calls emitidos pelo próprio modelo em turnos anteriores no
 * formato ```tool_call``` (convenção histórica, usada só como contexto legível
 * do que já aconteceu — não precisa bater com o formato de saída pedido pro
 * turno atual, que quem decide é o `extraPreamble` do chamador).
 */
export function flattenToPrompt(system, messages, extraPreamble = '') {
  const parts = []
  if (system) parts.push(system.trim())
  if (extraPreamble) parts.push(extraPreamble)

  for (const m of messages ?? []) {
    let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    if (m.role === 'assistant') {
      
      
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
        const callsText = m.tool_calls.map(tc => {
          let input = {}
          try { input = JSON.parse(tc.function?.arguments ?? '{}') } catch {}
          return '```tool_call\n' + JSON.stringify({ name: tc.function?.name, input }) + '\n```'
        }).join('\n')
        content = [content, callsText].filter(Boolean).join('\n')
      }
      parts.push(`Assistant: ${content}`)
    }
    else if (m.role === 'tool') parts.push(`Tool result (${m.tool_call_id ?? '?'}): ${content}`)
    else parts.push(content) 
  }

  return parts.join('\n\n')
}
