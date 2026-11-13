import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCodexAppServer } from './codex_app_server.js'

test('resumes the supplied thread, persists binding before dispatch, and returns its identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-bag-'))
  const script = join(dir, 'rpc.mjs')
  await writeFile(script, `import {createInterface} from 'node:readline';
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize') send({id:m.id,result:{}});
 if(m.method==='thread/start') process.exit(7);
 if(m.method==='thread/resume') {
  send({id:m.id,result:{thread:{id:m.params.threadId}}});
  send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'old',status:'completed'}}});
 }
 if(m.method==='turn/start') {
  send({id:m.id,result:{turn:{id:'t'}}});
  send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'foreign',status:'completed'}}});
  send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'t',status:'completed'}}});
 }
});`)
  try {
    let saved
    const result = await runCodexAppServer({ bin: process.execPath, args: [script], cwd: dir, input: 'continue', resumeThreadId: 'existing', timeoutMs: 2000,
      onThread: value => { saved = value },
    })
    assert.deepEqual(saved, { threadId: 'existing', resumed: true })
    assert.equal(result.threadId, 'existing')
    assert.equal(result.turnId, 't')
    await assert.rejects(runCodexAppServer({ bin: process.execPath, args: [script], cwd: dir, input: 'continue', resumeThreadId: 'existing', timeoutMs: 2000,
      onThread: () => { throw new Error('commit failed') },
    }), /commit failed/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
