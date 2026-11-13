import test from 'node:test'
import assert from 'node:assert/strict'
import { composePrompt, previewPrompt, resolveModelSpec, getSpecialistById, listGenericSpecialists, hasRestrictedTools } from '../lib/catalog.js'
import { discoverAgentFiles } from '../lib/discovery.js'

test('composePrompt: prompt próprio vem antes dos AGENT.md compostos, na ordem dada', () => {
  const result = composePrompt({
    ownPrompt: 'Você é um especialista em X.',
    composedAgents: [
      { pkg: 'a', name: 'A', body: 'corpo A' },
      { pkg: 'b', name: 'B', body: 'corpo B' },
    ],
  })
  const idxOwn = result.indexOf('Você é um especialista em X.')
  const idxA = result.indexOf('corpo A')
  const idxB = result.indexOf('corpo B')
  assert.ok(idxOwn >= 0 && idxA > idxOwn && idxB > idxA, 'ordem esperada: prompt próprio, depois A, depois B')
  assert.match(result, /### A/)
  assert.match(result, /### B/)
})

test('composePrompt sem prompt próprio nem agentes devolve string vazia', () => {
  assert.equal(composePrompt({ ownPrompt: null, composedAgents: [] }), '')
  assert.equal(composePrompt(null), '')
})

test('previewPrompt ignora pacotes que não resolvem (sem AGENT.md)', () => {
  const result = previewPrompt({ prompt: 'base', agents: ['__pacote-inexistente__'] })
  assert.equal(result, 'base')
})

test('resolveModelSpec: sem model definido, não roteia nada', () => {
  assert.equal(resolveModelSpec({ model: null, fallbackModel: 'x', provider: 'anthropic' }), null)
})

test('resolveModelSpec: com model, monta providers como array de 1', () => {
  const spec = resolveModelSpec({ model: 'claude-sonnet-4', fallbackModel: 'claude-haiku', provider: 'anthropic' })
  assert.deepEqual(spec, { model: 'claude-sonnet-4', fallbackModel: 'claude-haiku', providers: ['anthropic'] })
})

test('resolveModelSpec: sem provider, providers fica null (sem restrição de slot)', () => {
  const spec = resolveModelSpec({ model: 'claude-sonnet-4', fallbackModel: null, provider: null })
  assert.deepEqual(spec, { model: 'claude-sonnet-4', fallbackModel: null, providers: null })
})

test('especialista genérico preserva modo irrestrito quando o AGENT.md não declara tools', () => {
  const files = discoverAgentFiles({ includeRoot: false })
  const unrestricted = files.find((file) => file.tools === null)
  assert.ok(unrestricted, 'precisa de ao menos um AGENT.md sem allowlist pra este teste fazer sentido')
  const resolved = getSpecialistById(`pkg:${unrestricted.pkg}`)
  assert.equal(resolved.kind, 'generic')
  assert.equal(resolved.toolsAllowlist, null)
  assert.equal(resolved.model, null)
})

test('especialista Desta Casa declara uma allowlist própria no AGENT.md', () => {
  const resolved = getSpecialistById('pkg:desta-casa')
  assert.deepEqual(resolved.toolsAllowlist, [
    'destaCasaBuscarImoveis',
    'destaCasaDetalharImovel',
    'destaCasaSolicitarVisita',
    'whatsapp_block_user',
    'whatsapp_add_referred_campaign_contact',
  ])
})

test('getSpecialistById devolve null pra id desconhecido', () => {
  assert.equal(getSpecialistById('pkg:__nao-existe__'), null)
  assert.equal(getSpecialistById(''), null)
  assert.equal(getSpecialistById(null), null)
})

test('listGenericSpecialists espelha discoverAgentFiles (sem raiz do projeto)', () => {
  const generics = listGenericSpecialists()
  const files = discoverAgentFiles({ includeRoot: false })
  assert.equal(generics.length, files.length)
  for (const g of generics) {
    assert.equal(g.kind, 'generic')
    assert.match(g.id, /^pkg:/)
  }
})

test('hasRestrictedTools exige allowlist literal para canais autônomos', () => {
  assert.equal(hasRestrictedTools({ toolsAllowlist: ['consultarPedido'] }), true)
  assert.equal(hasRestrictedTools({ toolsAllowlist: [] }), true)
  assert.equal(hasRestrictedTools({ toolsAllowlist: null }), false)
  assert.equal(hasRestrictedTools({}), false)
  assert.equal(hasRestrictedTools({ toolsAllowlist: ['*'] }), false)
  assert.equal(hasRestrictedTools({ tools: ['unrestricted'] }), false)
  assert.equal(hasRestrictedTools({ toolsAllowlist: ['unrestrictedLookup'] }), true)
})
