import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCliToolsPreamble,
  extractCliToolCalls,
  flattenToPrompt,
} from '../llm/text_tool_protocol.js'




function captureWarn(fn) {
  const original = console.warn
  const warnings = []
  console.warn = msg => warnings.push(String(msg))
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = original
  }
}

test('preâmbulo de tools some quando não há ferramenta', () => {
  assert.equal(buildCliToolsPreamble([]), '')
  assert.equal(buildCliToolsPreamble(undefined), '')
  assert.equal(buildCliToolsPreamble(null), '')
})

test('preâmbulo lista cada ferramenta com schema serializado', () => {
  const preamble = buildCliToolsPreamble([
    { name: 'buscar', description: 'procura algo', input_schema: { type: 'object' } },
  ])

  assert.match(preamble, /# Ferramentas disponíveis/)
  assert.match(preamble, /```tool_call/)
  assert.match(preamble, /- buscar: procura algo/)
  assert.match(preamble, /input_schema: \{"type":"object"\}/)
})

test('preâmbulo tolera ferramenta sem descrição nem schema', () => {
  const preamble = buildCliToolsPreamble([{ name: 'nu' }])

  
  
  assert.match(preamble, /- nu: \n {2}input_schema: \{\}/)
  assert.doesNotMatch(preamble, /undefined/)
})

test('texto sem bloco tool_call volta intacto e sem chamadas', () => {
  const { cleaned, toolCalls } = extractCliToolCalls('resposta comum do modelo')

  assert.equal(cleaned, 'resposta comum do modelo')
  assert.deepEqual(toolCalls, [])
})

test('extração aceita entrada vazia, nula e não-string', () => {
  for (const input of [undefined, null, '']) {
    const { cleaned, toolCalls } = extractCliToolCalls(input)
    assert.equal(cleaned, '')
    assert.deepEqual(toolCalls, [])
  }

  
  assert.equal(extractCliToolCalls(42).cleaned, '42')
})

test('extração converte um bloco em tool_call no formato do pipeline', () => {
  const { cleaned, toolCalls } = extractCliToolCalls(
    'vou buscar\n```tool_call\n{"name": "buscar", "input": {"q": "gato"}}\n```',
  )

  assert.equal(cleaned, 'vou buscar')
  assert.equal(toolCalls.length, 1)
  assert.equal(toolCalls[0].type, 'function')
  assert.equal(toolCalls[0].function.name, 'buscar')
  assert.deepEqual(JSON.parse(toolCalls[0].function.arguments), { q: 'gato' })
  assert.match(toolCalls[0].id, /^cli_call_\d+_0$/)
})

test('vários blocos no mesmo turno viram várias chamadas com ids distintos', () => {
  const { cleaned, toolCalls } = extractCliToolCalls(
    '```tool_call\n{"name": "a", "input": {}}\n```\n' +
      '```tool_call\n{"name": "b", "input": {"x": 1}}\n```',
  )

  assert.equal(cleaned, '')
  assert.deepEqual(toolCalls.map(c => c.function.name), ['a', 'b'])
  assert.notEqual(toolCalls[0].id, toolCalls[1].id)
})

test('input ausente vira objeto vazio serializado', () => {
  const { toolCalls } = extractCliToolCalls('```tool_call\n{"name": "semInput"}\n```')

  assert.equal(toolCalls[0].function.arguments, '{}')
})

test('bloco com JSON inválido é descartado com aviso, sem derrubar a resposta', () => {
  const { result, warnings } = captureWarn(() =>
    extractCliToolCalls('antes\n```tool_call\n{quebrado\n```\ndepois'),
  )

  assert.deepEqual(result.toolCalls, [])
  
  assert.equal(result.cleaned, 'antes\n\ndepois')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /JSON inválido/)
})

test('bloco sem name é ignorado sem virar chamada anônima', () => {
  const { result, warnings } = captureWarn(() =>
    extractCliToolCalls('```tool_call\n{"input": {"x": 1}}\n```'),
  )

  assert.deepEqual(result.toolCalls, [])
  assert.equal(warnings.length, 0, 'JSON é válido, então não há motivo pra avisar')
})

test('um bloco inválido não impede os válidos do mesmo turno', () => {
  const { result } = captureWarn(() =>
    extractCliToolCalls(
      '```tool_call\n{ruim}\n```\n```tool_call\n{"name": "boa", "input": {}}\n```',
    ),
  )

  assert.deepEqual(result.toolCalls.map(c => c.function.name), ['boa'])
})

test('flatten junta system, preâmbulo e turnos em blocos separados', () => {
  const prompt = flattenToPrompt(
    '  você é a Agent  ',
    [{ role: 'user', content: 'oi' }],
    'PREÂMBULO',
  )

  
  assert.equal(prompt, 'você é a Agent\n\nPREÂMBULO\n\noi')
})

test('flatten omite system e preâmbulo vazios', () => {
  assert.equal(flattenToPrompt('', [{ role: 'user', content: 'oi' }]), 'oi')
  assert.equal(flattenToPrompt(null, [{ role: 'user', content: 'oi' }], ''), 'oi')
})

test('flatten aceita histórico vazio ou ausente', () => {
  assert.equal(flattenToPrompt('sys', []), 'sys')
  assert.equal(flattenToPrompt('sys', null), 'sys')
  assert.equal(flattenToPrompt('sys', undefined), 'sys')
})

test('flatten prefixa assistant e tool, mas não user', () => {
  const prompt = flattenToPrompt('', [
    { role: 'user', content: 'pergunta' },
    { role: 'assistant', content: 'resposta' },
    { role: 'tool', tool_call_id: 'call_1', content: 'saída' },
  ])

  assert.equal(prompt, 'pergunta\n\nAssistant: resposta\n\nTool result (call_1): saída')
})

test('tool sem id resolvido não perde o resultado', () => {
  const prompt = flattenToPrompt('', [{ role: 'tool', content: 'saída' }])

  assert.equal(prompt, 'Tool result (?): saída')
})

test('conteúdo estruturado é serializado em vez de virar [object Object]', () => {
  const prompt = flattenToPrompt('', [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }])

  assert.equal(prompt, '[{"type":"text","text":"oi"}]')
  assert.doesNotMatch(prompt, /\[object Object\]/)
})

test('tool_calls de turnos anteriores voltam como blocos tool_call', () => {
  const prompt = flattenToPrompt('', [
    {
      role: 'assistant',
      content: 'já busco',
      tool_calls: [{ function: { name: 'buscar', arguments: '{"q":"gato"}' } }],
    },
  ])

  assert.equal(
    prompt,
    'Assistant: já busco\n```tool_call\n{"name":"buscar","input":{"q":"gato"}}\n```',
  )
})

test('assistant só com tool_calls não gera linha de conteúdo vazia', () => {
  const prompt = flattenToPrompt('', [
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'buscar', arguments: '{}' } }],
    },
  ])

  assert.equal(prompt, 'Assistant: ```tool_call\n{"name":"buscar","input":{}}\n```')
})

test('arguments corrompido no histórico vira input vazio em vez de estourar', () => {
  const prompt = flattenToPrompt('', [
    {
      role: 'assistant',
      content: 'x',
      tool_calls: [{ function: { name: 'buscar', arguments: '{quebrado' } }],
    },
  ])

  assert.match(prompt, /\{"name":"buscar","input":\{\}\}/)
})

test('assistant com tool_calls vazio não emite bloco algum', () => {
  const prompt = flattenToPrompt('', [{ role: 'assistant', content: 'texto', tool_calls: [] }])

  assert.equal(prompt, 'Assistant: texto')
})

test('ida e volta: o que o flatten reserializa o extractor volta a ler', () => {
  const original = [{ function: { name: 'buscar', arguments: '{"q":"gato"}' } }]
  const prompt = flattenToPrompt('', [{ role: 'assistant', content: '', tool_calls: original }])
  const { toolCalls } = extractCliToolCalls(prompt.replace(/^Assistant: /, ''))

  assert.equal(toolCalls.length, 1)
  assert.equal(toolCalls[0].function.name, 'buscar')
  assert.deepEqual(JSON.parse(toolCalls[0].function.arguments), { q: 'gato' })
})
