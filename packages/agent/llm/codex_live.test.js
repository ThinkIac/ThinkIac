

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import path, { join } from 'node:path'
import { buildSlots } from './llm_keys.js'
import { runCliSlot } from './llm.js'
import { runCodexAppServer } from './codex_app_server.js'
import { requestCodexApproval } from './codex_approval.js'
import { resolvePendingPermission } from '../core/pending_permissions.js'
const live = { skip: process.env.AGENT_CODEX_LIVE_TEST !== '1', timeout: 120000 }

test('Codex real: auto cria e edita pelo provider', live, async () => {
const cwd = await mkdtemp(join(process.cwd(), 'agent-permission-probe-'))
try {
  const [slot] = buildSlots({ llm: { pools: [{ name: 'codex', provider: 'codex-cli', enabled: true, cli: { sandbox: 'auto', mcp: false } }] } })
  const args = slot.cli.buildArgs(null, slot.cli.opts, { transport: 'app-server', workspaceDir: cwd })
  console.log(JSON.stringify({ cwd, args }))
  const result = await runCliSlot(slot, null, { cwd,
    messages: [{ role: 'user', content: 'Create probe.txt with exactly first\\n, then edit it to exactly second\\n. Use native tools and read it back. Do not touch any other files.' }],
    cliOpts: { timeout_ms: 90000 }, onProgress: event => console.log(JSON.stringify(event)),
  })
  assert.equal(await readFile(path.join(cwd, 'probe.txt'), 'utf8'), 'second\n')
  console.log('REAL_NATIVE_EDIT_OK', result.choices[0].message.content)
} finally { await rm(cwd, { recursive: true, force: true }) }

})

test('Codex real: limites dos sandboxes e diretório adicional', live, async () => {
const root = await mkdtemp(join(process.cwd(), 'agent-sandbox-check-'))
try {
 const { mkdir } = await import('node:fs/promises')
 const workspace=join(root,'workspace'), extra=join(root,'extra'), outside=join(root,'outside')
 await Promise.all([workspace,extra,outside].map(dir=>mkdir(dir)))
 for (const sandbox of ['read-only','workspace-write','danger-full-access']) {
   const script=`const fs=require('fs'); for(const [name,dir] of Object.entries(${JSON.stringify({workspace,extra,outside})})) { try { fs.writeFileSync(dir+'/probe','first'); fs.writeFileSync(dir+'/probe','second'); console.log(name+':write'); } catch(e) { console.log(name+':blocked'); } }`
   const [slot] = buildSlots({llm:{pools:[{name:'codex',provider:'codex-cli',enabled:true,cli:{sandbox,approval_policy:'never',add_dirs:[extra],mcp:false}}]}})
   const args=slot.cli.buildArgs(null,slot.cli.opts,{transport:'app-server',workspaceDir:workspace})
   args.push('-c','sandbox_workspace_write.exclude_tmpdir_env_var=true','-c','sandbox_workspace_write.exclude_slash_tmp=true')
   const child=spawn('codex',args,{cwd:workspace,stdio:['pipe','pipe','pipe']})
   const pending=new Map(); let id=0; let stderr=''
   const lines=createInterface({input:child.stdout})
   child.stderr.on('data',chunk=>{stderr+=chunk})
   child.on('close',code=>{for(const task of pending.values()) task.reject(Error(`Codex ${code}: ${stderr}`))})
   lines.on('line',line=>{const m=JSON.parse(line); const task=pending.get(m.id); if(task){pending.delete(m.id); m.error?task.reject(Error(m.error.message)):task.resolve(m.result)}})
   const rpc=(method,params)=>new Promise((resolve,reject)=>{const seq=++id;pending.set(seq,{resolve,reject});child.stdin.write(JSON.stringify({id:seq,method,params})+'\n')})
   let result
   try {
     await rpc('initialize',{clientInfo:{name:'agent-test',version:'1.0.0'}})
     const thread=await rpc('thread/start',{cwd:workspace})
     assert.equal(thread.approvalPolicy,'never')
     console.log('EFFECTIVE',sandbox,JSON.stringify(thread.sandbox))
     result=await rpc('command/exec',{cwd:workspace,command:[process.execPath,'-e',script],timeoutMs:15000})
     console.log(sandbox,JSON.stringify(result))
     assert.equal(result.exitCode,0)
   } finally {child.stdin.end();child.kill();lines.close()}
   assert.match(result.stdout,sandbox==='read-only'?/workspace:blocked/:/workspace:write/)
   assert.match(result.stdout,sandbox==='read-only'?/extra:blocked/:/extra:write/)
   assert.match(result.stdout,sandbox==='danger-full-access'?/outside:write/:/outside:blocked/)
 }
 console.log('REAL_SANDBOX_BOUNDARIES_OK')
} finally { await rm(root,{recursive:true,force:true}) }

})

test('Codex real: aprovação nativa pelo registro Runtime', live, async () => {
const root = await mkdtemp(join(process.cwd(), 'agent-approval-probe-'))
const cwd = join(root, 'workspace'), outside = join(root, 'outside')
try {
  await mkdir(cwd); await mkdir(outside)
  const [slot] = buildSlots({llm:{pools:[{name:'codex',provider:'codex-cli',enabled:true,cli:{sandbox:'workspace-write',approval_policy:'on-request',mcp:false}}]}})
  const args=slot.cli.buildArgs(null,slot.cli.opts,{transport:'app-server',workspaceDir:cwd})
  let approvals=0
  await runCodexAppServer({bin:'codex',args,cwd,sessionId:'live-approval-test',timeoutMs:90000,
    input:`Use a native shell command to write exactly approved to ${outside}/probe.txt. This is outside your workspace: request sandbox escalation through your approval tool before writing. Do not write anywhere else.`,
    requestApproval:(request,options)=>requestCodexApproval(request,{...options,emit:(session,type,payload)=>{
      assert.equal(session,'live-approval-test');assert.equal(type,'permission_request');approvals++;
      console.log('RUNTIME_APPROVAL',payload.tool_name,JSON.stringify(payload.tool_input));
      resolvePendingPermission(payload.request_id,'allow','Authorized temporary integration probe.');
    }}),
    onProgress:event=>console.log(JSON.stringify(event)),
  })
  assert.ok(approvals>0,'Codex must request approval before escape')
  assert.equal(await readFile(join(outside,'probe.txt'),'utf8'),'approved')
  console.log('REAL_RUNTIME_APPROVAL_OK')
} finally {await rm(root,{recursive:true,force:true})}

})
