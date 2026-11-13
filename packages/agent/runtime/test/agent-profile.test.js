import test from 'node:test'
import assert from 'node:assert/strict'
import { AGENT_PROFILE_PROTOCOL, getAgentProfile, listAgentProfiles, registerAgentProfileProvider } from '../index.js'

test('providers são opcionais e perfis são normalizados no protocolo comum', async () => {
  const off = registerAgentProfileProvider('test-provider', {
    async listAgentProfiles() { return [{ id: 'one', name: 'One', tools: ['a', 'a'] }] },
    async getAgentProfile(id) { return { id, name: 'One', tools: null } },
  })
  const listed = await listAgentProfiles()
  const profile = listed.find(item => item.id === 'one')
  assert.equal(profile.protocol, AGENT_PROFILE_PROTOCOL)
  assert.deepEqual(profile.tools, ['a'])
  assert.deepEqual((await getAgentProfile('test-provider', 'one')).tools, null)
  off()
  assert.equal(await getAgentProfile('test-provider', 'one'), null)
})
