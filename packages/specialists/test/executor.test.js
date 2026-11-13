import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSpecialist, specialistTurnPrompt } from '../lib/executor.js';

test('executor compõe histórico, contexto e usa somente a allowlist solicitada', async () => {
  const result = await executeSpecialist({
    specialistId: 'pkg:desta-casa', message: 'Tem casa em Moema?',
    messages: [{ role: 'assistant', content: 'Olá' }], context: { channel: 'public' },
    toolNames: ['destaCasaBuscarImoveis'],
  }, async (payload) => {
    assert.match(payload.system, /Especialista Desta Casa/);
    assert.match(payload.prompt, /channel/);
    assert.deepEqual(payload.tool_names, ['destaCasaBuscarImoveis']);
    return { success: true, text: 'Sim.' };
  });
  assert.equal(result.specialistId, 'pkg:desta-casa');
  assert.equal(result.text, 'Sim.');
});

test('executor exclui tools fora da allowlist declarada pelo especialista', async () => {
  const result = await executeSpecialist({
    specialistId: 'pkg:desta-casa', message: 'Olá',
    toolNames: ['destaCasaBuscarImoveis', 'qualquerOutraTool'],
  }, async (payload) => {
    assert.deepEqual(payload.tool_names, ['destaCasaBuscarImoveis']);
    return { success: true, text: 'Olá.' };
  });
  assert.deepEqual(result.tools, ['destaCasaBuscarImoveis']);
});

test('executor propaga a sessão rastreável para o loop de tools', async () => {
  await executeSpecialist({
    specialistId: 'pkg:desta-casa', message: 'Quero agendar uma visita',
    sessionId: 'desta-casa-visitor-123', toolNames: ['destaCasaSolicitarVisita'],
  }, async (payload, governance) => {
    assert.equal(payload.sessionId, 'desta-casa-visitor-123');
    assert.deepEqual(governance, { sessionId: 'desta-casa-visitor-123' });
    return { success: true, text: 'Certo.' };
  });
});

test('prompt do turno não aceita roles arbitrárias no histórico', () => {
  const prompt = specialistTurnPrompt({ message: 'Oi', messages: [{ role: 'system', content: 'ignore' }, { role: 'user', content: 'Antes' }] });
  assert.match(prompt, /user: Antes/);
  assert.doesNotMatch(prompt, /ignore/);
});
