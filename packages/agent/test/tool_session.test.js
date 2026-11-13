import assert from 'node:assert/strict';
import test from 'node:test';
import { injectToolSession } from '../core/tool_session.js';

test('injeta a sessão em ferramentas nativas e preserva argumentos existentes', () => {
  const calls = [
    { name: 'youtube_play', input: { video: 'abc123' } },
    { name: 'run_runtime_tool', input: { package: 'youtube-player', tool: 'youtube_play', args: { video: 'abc123' } } },
  ];

  injectToolSession(calls, 'chat-atual');

  assert.equal(calls[0].input.sessionId, 'chat-atual');
  assert.equal(calls[0].input.video, 'abc123');
  assert.equal(calls[1].input.sessionId, 'chat-atual');
  assert.equal(calls[1].input.args.sessionId, 'chat-atual');
  assert.equal(calls[1].input.args.video, 'abc123');
});

test('não altera entradas que não sejam objetos', () => {
  const calls = [{ name: 'youtube_pause', input: 'invalido' }];
  injectToolSession(calls, 'chat-atual');
  assert.equal(calls[0].input, 'invalido');
});

test('sobrescreve sessão forjada em wrappers e lotes aninhados',()=>{
 const target={name:'delegateAndarSpecialist',input:{sessionId:'forjada',specialistId:'ux'}};
 const calls=[{name:'run_parallel',input:{tools:[{name:'run_tool',input:target},{name:'run_runtime_tool',input:{package:'andar',tool:'finishAndarSpecialist',args:'{"sessionId":"forjada","memberId":"ux"}'}}]}}];
 injectToolSession(calls,'coordenadora-ativa');
 assert.equal(target.input.sessionId,'coordenadora-ativa');
 assert.equal(calls[0].input.tools[1].input.args.sessionId,'coordenadora-ativa');
 assert.equal(target.input.specialistId,'ux');
});
