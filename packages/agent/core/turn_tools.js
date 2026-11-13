import {randomUUID} from 'node:crypto';


const turns = new Map();
export function openTurnTools(sessionId, tools, execute, signal) {
 const selected=Array.isArray(tools)?tools:[];
 const token=randomUUID();let queue=Promise.resolve(),closed=false;
 const names=new Set(selected.map(t=>t.name));
 const entry={token,sessionId,tools:selected.map(t=>({name:t.name,description:t.description||'',inputSchema:t.input_schema||t.inputSchema||t.parameters||{type:'object',properties:{}}})),
 call(name,args){
  const task=queue.then(async()=>{
   if(closed||signal?.aborted)throw new Error('Turno encerrado.');
   if(!names.has(name))throw new Error('Ferramenta não autorizada neste turno: '+name);
   return execute(name,args);
  });queue=task.catch(()=>{});return task;
 }};
 turns.set(token,entry);
 return {token,close(){closed=true;turns.delete(token);}};
}
export function getTurnTools(token){return typeof token==='string'?turns.get(token):undefined;}
