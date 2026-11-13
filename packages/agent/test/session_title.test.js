import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getTitleConfig,
  shouldGenerateTitle,
  buildTitleTranscript,
  sanitizeTitle,
  generateTitle,
} from '../core/session_title.js'

test('titulação respeita intervalo e conteúdo útil', () => {
  const cfg = getTitleConfig({ sessions: { title: { every: 6, minMessages: 2 } } })
  assert.equal(shouldGenerateTitle({}, 1, cfg), false)
  assert.equal(shouldGenerateTitle({}, 2, cfg), true)
  assert.equal(shouldGenerateTitle({ title: 'Atual', title_message_count: 4 }, 9, cfg), false)
  assert.equal(shouldGenerateTitle({ title: 'Atual', title_message_count: 4 }, 10, cfg), true)
  assert.equal(buildTitleTranscript([{ role: 'tool', content: 'ruído' }]), '')
})

test('titulação declara contrato leve e aceita override explícito', async () => {
  let seen
  const title = await generateTitle(
    [{ role: 'user', content: 'o login quebrou' }],
    async options => {
      seen = options
      return { text: '"Correção do login."' }
    },
    { ...getTitleConfig({}), model: 'modelo@acesso' },
  )
  assert.equal(title, 'Correção do login')
  assert.equal(seen.model, 'modelo@acesso')
  assert.deepEqual(seen.requirements.requires.modalities, ['text:input'])
  assert.equal(seen.requirements.prefers.reasoning, 'low')
})

test('sanitização limita e limpa resposta', () => {
  assert.equal(sanitizeTitle('Título: Dúvidas sobre Docker.'), 'Dúvidas sobre Docker')
  assert.ok(sanitizeTitle('Um título excessivamente longo para a sessão atual', 24).length <= 24)
})
