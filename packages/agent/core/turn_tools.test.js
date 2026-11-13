import test from 'node:test';
import assert from 'node:assert/strict';
import {openTurnTools,getTurnTools} from './turn_tools.js';

test('capacidade isola catálogo, serializa chamadas e expira ao encerrar',async()=>{
 let active=0,max=0;const executed=[];
 const bridge=openTurnTools('room',[{name:'delegateAndarSpecialist'}],async(name,args)=>{
  active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));executed.push(args);active--;return 'ok';
 });
 const turn=getTurnTools(bridge.token);
 assert.equal(getTurnTools('wrong'),undefined);
 assert.equal(turn.sessionId,'room');
 await assert.rejects(turn.call('deleteTask',{}),/não autorizada/);
 assert.deepEqual(await Promise.all([turn.call('delegateAndarSpecialist',{n:1}),turn.call('delegateAndarSpecialist',{n:2})]),['ok','ok']);
 assert.equal(max,1);assert.equal(executed.length,2);
 bridge.close();assert.equal(getTurnTools(bridge.token),undefined);
 await assert.rejects(turn.call('delegateAndarSpecialist',{}),/encerrado/);
});

test('pausa bloqueia chamadas mesmo com capacidade ainda presente',async()=>{
 const abort=new AbortController();const bridge=openTurnTools('room',[{name:'probe'}],()=>assert.fail('executou'),abort.signal);
 abort.abort();await assert.rejects(getTurnTools(bridge.token).call('probe',{}),/encerrado/);bridge.close();
});

test('catálogo vazio continua sendo uma capacidade válida e não herda tools globais',async()=>{
 const bridge=openTurnTools(null,[],()=>assert.fail('executou'));
 const turn=getTurnTools(bridge.token);
 assert.deepEqual(turn.tools,[]);
 await assert.rejects(turn.call('say_to_user',{}),/não autorizada/);
 bridge.close();
});
