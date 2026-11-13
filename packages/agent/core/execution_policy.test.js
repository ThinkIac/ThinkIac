import test from 'node:test';
import assert from 'node:assert/strict';
import {selectExecutionTools} from './execution_policy.js';
const tools=[{name:'listTasks'},{name:'delegateAndarSpecialist'},{name:'hidden',reach:'manual'},{name:'discover',reach:'always'}];
const names=value=>value.map(t=>t.name);
test('coordenação preserva delegação mesmo quando classificador escolhe só Tasks',()=>{
 assert.deepEqual(names(selectExecutionTools(tools,{classifiedNames:['listTasks'],requiredTools:['delegateAndarSpecialist','hidden'],always:t=>t.reach==='always'})),['listTasks','delegateAndarSpecialist','discover']);
});
test('requisitos não ampliam permissão de especialista nem expõem ferramentas manuais',()=>{
 assert.deepEqual(names(selectExecutionTools(tools,{classifiedNames:['listTasks'],requiredTools:['delegateAndarSpecialist'],allowlist:['listTasks']})),['listTasks']);
 assert.deepEqual(selectExecutionTools(tools,{requiredTools:['delegateAndarSpecialist'],allowlist:[]}),[]);
 assert.deepEqual(names(selectExecutionTools(tools)),['listTasks','delegateAndarSpecialist','discover']);
});

test('seleção explícita ignora relevância sem ampliar lista; todas preserva catálogo',()=>{
 assert.deepEqual(names(selectExecutionTools(tools,{toolMode:'all',classifiedNames:['listTasks']})),['listTasks','delegateAndarSpecialist','discover']);
 assert.deepEqual(names(selectExecutionTools(tools,{toolMode:'selected',classifiedNames:['listTasks'],toolAllowlist:['delegateAndarSpecialist'],requiredTools:['listTasks']})),['delegateAndarSpecialist']);
 assert.deepEqual(selectExecutionTools(tools,{toolMode:'selected',toolAllowlist:[]}),[]);
});
test('bloqueia ferramentas fora da lista em chamadas diretas e indiretas',async()=>{
 const {assertExecutionTool}=await import('./execution_policy.js');
 assert.doesNotThrow(()=>assertExecutionTool({name:'listTasks'},['listTasks']));
 assert.doesNotThrow(()=>assertExecutionTool({name:'run_runtime_tool',input:{tool:'listTasks'}},['listTasks']));
 for(const call of [{name:'run_parallel',input:{tools:[{name:'deleteTask'}]}},{name:'deleteTask'},{name:'run_runtime_tool',input:{tool:'deleteTask'}},{name:'run_tool',input:{name:'deleteTask'}},{name:'run_runtime_tool',input:{}}]) assert.throws(()=>assertExecutionTool(call,['listTasks','run_runtime_tool','run_tool','run_parallel']),/não autorizada/);
 assert.throws(()=>assertExecutionTool({name:'listTasks'},[]),/não autorizada/);
});
test('allowlist expandida autoriza somente o alvo exato no wrapper',async()=>{
 const {assertExecutionTool}=await import('./execution_policy.js');
 assert.doesNotThrow(()=>assertExecutionTool({name:'run_runtime_tool',input:{tool:'browser_find'}},['browser_find','request_tool_access']));
 assert.throws(()=>assertExecutionTool({name:'run_runtime_tool',input:{tool:'browser_click'}},['browser_find','request_tool_access']),/não autorizada/);
});
