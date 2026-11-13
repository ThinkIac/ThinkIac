import test from 'node:test'
import assert from 'node:assert/strict'
import { classifySkills, renderActiveSkills, renderSkillBody } from '../core/skills.js'

const routingCandidates = [
  { name: 'Tasks', description: 'Gerenciamento de tarefas.', hash: 'tasks-v1' },
  { name: 'Agenda', description: 'Agenda e compromissos.', hash: 'agenda-v1' },
]

function routerThat(...responses) {
  let calls = 0
  return {
    dispatch: async () => responses[calls++],
    calls: () => calls,
  }
}

test('skill routing selects only names returned by a valid classifier response', async () => {
  const router = routerThat({ success: true, text: '{"skills":["Tasks"]}', model: 'router-light' })
  const result = await classifySkills('liste as tarefas abertas', routingCandidates, {
    dispatch: router.dispatch,
    cache: new Map(),
  })

  assert.deepEqual(result.selected, ['Tasks'])
  assert.equal(result.status, 'selected')
  assert.equal(result.attempts, 1)
  assert.equal(result.model, 'router-light')
})

test('skill routing recognizes a valid empty selection as none without retrying', async () => {
  const router = routerThat({ success: true, text: '{"skills":[]}', model: 'router-light' })
  const result = await classifySkills('qual e a capital da Franca?', routingCandidates, {
    dispatch: router.dispatch,
    cache: new Map(),
  })

  assert.equal(result.status, 'none')
  assert.deepEqual(result.selected, [])
  assert.equal(result.attempts, 1)
  assert.equal(router.calls(), 1)
})

test('skill routing retries an invalid JSON response and uses the recovered decision', async () => {
  const router = routerThat(
    { success: true, text: 'Tasks', model: 'router-light' },
    { success: true, text: '{"skills":["Tasks"]}', model: 'router-light' },
  )
  const result = await classifySkills('liste as tarefas abertas', routingCandidates, {
    dispatch: router.dispatch,
    cache: new Map(),
  })

  assert.equal(result.status, 'selected')
  assert.deepEqual(result.selected, ['Tasks'])
  assert.equal(result.attempts, 2)
  assert.equal(router.calls(), 2)
})

test('skill routing retries an unknown skill and exposes a failed result when recovery fails', async () => {
  const router = routerThat(
    { success: true, text: '{"skills":["Inventada"]}', model: 'router-light' },
    { success: false, text: '', model: 'router-light' },
  )
  const result = await classifySkills('liste as tarefas abertas', routingCandidates, {
    dispatch: router.dispatch,
    cache: new Map(),
  })

  assert.equal(result.status, 'failed')
  assert.deepEqual(result.selected, [])
  assert.equal(result.attempts, 2)
  assert.match(result.reason, /llm_unsuccessful/)
})

test('skill routing caches a valid decision by normalized message and catalog version, never a failure', async () => {
  const cache = new Map()
  const selected = routerThat({ success: true, text: '{"skills":["Tasks"]}', model: 'router-light' })
  const first = await classifySkills('  Liste AS tarefas abertas  ', routingCandidates, { dispatch: selected.dispatch, cache })
  const cached = await classifySkills('liste as tarefas abertas', routingCandidates, { dispatch: selected.dispatch, cache })

  assert.equal(first.cached, false)
  assert.equal(cached.cached, true)
  assert.equal(selected.calls(), 1)

  const failed = routerThat({ success: true, text: 'invalid', model: 'router-light' }, { success: true, text: 'still invalid', model: 'router-light' })
  await classifySkills('outra mensagem', routingCandidates, { dispatch: failed.dispatch, cache })
  await classifySkills('outra mensagem', routingCandidates, { dispatch: failed.dispatch, cache })
  assert.equal(failed.calls(), 4)

  const changedCatalog = [{ ...routingCandidates[0], hash: 'tasks-v2' }, routingCandidates[1]]
  const changed = routerThat({ success: true, text: '{"skills":["Tasks"]}', model: 'router-light' })
  await classifySkills('liste as tarefas abertas', changedCatalog, { dispatch: changed.dispatch, cache })
  assert.equal(changed.calls(), 1)
})

test('AGENT.md event payload is rendered through Inflect', async () => {
  let dispatched
  const skill = {
    name: 'Example',
    event: 'example:context',
    body: 'Hello {{ name }}!{#each items as item}\n- {{ item }}{/each}',
    absolutePath: '/tmp/AGENT.md',
  }
  const body = await renderSkillBody(skill, 'session-1', 'hello', async (event, payload) => {
    dispatched = { event, payload }
    return { name: 'Joao', items: ['Foo', 'Bar'] }
  })

  assert.deepEqual(dispatched, {
    event: 'example:context',
    payload: { sessionId: 'session-1', message: 'hello', agent: 'Example' },
  })
  assert.equal(body, 'Hello Joao!\n- Foo\n- Bar')
})

test('AGENT.md event must return a plain object', async () => {
  await assert.rejects(
    () => renderSkillBody({ name: 'Bad', event: 'bad:event', body: 'x', absolutePath: '/tmp/AGENT.md' }, 's', 'm', async () => []),
    /must return an object/,
  )
})

test('a broken dynamic AGENT.md does not prevent other agents from rendering', async () => {
  const warnings = []
  const active = [
    { name: 'Broken', event: 'broken:event', body: '{{ value }}', absolutePath: '/tmp/AGENT.md', path: 'broken/AGENT.md' },
    { name: 'Healthy', event: 'healthy:event', body: '{{ value }}', absolutePath: '/tmp/AGENT.md', path: 'healthy/AGENT.md' },
  ]
  const rendered = await renderActiveSkills(
    active,
    's',
    'm',
    async event => event === 'broken:event' ? null : { value: 'ok' },
    { warn: warning => warnings.push(warning) },
  )

  assert.deepEqual(rendered.map(item => [item.skill.name, item.body]), [['Healthy', 'ok']])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /broken\/AGENT\.md/)
})

test('explicit development selection survives classifier failure with accurate provenance', async () => {
  const { composeSkills } = await import('../core/skills.js')
  const events = []
  const result = await composeSkills('session-dev', 'corrija o bug no pacote', {
    discover: () => [{ name: 'Engineer', body: 'Development rules', absolutePath: '/tmp/AGENT.md', path: 'engineer/AGENT.md' }],
    cache: new Map(),
    dispatch: async (event, payload) => {
      if (event === 'llm:call') throw new Error('unavailable')
      events.push(payload)
    },
  })
  assert.match(result.block, /Development rules/)
  assert.equal(result.sources[0].activation, 'explicit_development')
  const classification = events.find(event => event?.routingStatus)
  assert.equal(classification.status, 'selected')
  assert.equal(classification.routingStatus, 'failed')
  assert.deepEqual(classification.explicit, ['Engineer'])
})

test('ordinary messages do not activate Engineer on classifier failure', async () => {
  const { composeSkills } = await import('../core/skills.js')
  const result = await composeSkills('session-other', 'qual a capital da França?', {
    discover: () => [{ name: 'Engineer', body: 'Development rules', absolutePath: '/tmp/AGENT.md' }],
    cache: new Map(),
    dispatch: async () => { throw new Error('unavailable') },
  })
  assert.equal(result.block, '')
  assert.deepEqual(result.sources, [])
})

test('skill ativa transporta somente as tools declaradas como requisito do turno', async () => {
  const { composeSkills } = await import('../core/skills.js')
  const result = await composeSkills('session-artifact', 'crie um arquivo HTML para eu baixar', {
    discover: () => [{
      name: 'Artifacts', description: 'Cria arquivos.', tools: ['create_artifact'],
      body: 'Use create_artifact.', absolutePath: '/tmp/AGENT.md', path: 'artifacts/AGENT.md',
    }],
    cache: new Map(),
    dispatch: async event => event === 'llm:call'
      ? { success: true, text: '{"skills":["Artifacts"]}' }
      : undefined,
  })
  assert.deepEqual(result.requiredTools, ['create_artifact'])
  assert.deepEqual(result.sources[0].tools, ['create_artifact'])
})
