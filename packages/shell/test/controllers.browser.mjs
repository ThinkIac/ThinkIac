// Isolated browser integration: real Svelte UI and bus, simulated Agent transport.
// Run: node packages/shell/test/controllers.browser.mjs
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import puppeteer from 'puppeteer';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const runtime=`
const handlers=new Set(); let sessions=[]; let current='agent';
window.testRuntime={emit:message=>{for(const fn of handlers)fn({agentId:'agent',message})},sessions:()=>sessions};
export const activateAgent=id=>current=id,currentAgentId=()=>current,capabilities=()=>[],hasCapability=()=>false;
export const request=(path,opts)=>fetch('/agent'+path,opts),requestForAgent=(id,path,opts)=>request(path,opts),resourceUrl=path=>'/agent'+path;
export const connect=()=>{},connectAll=()=>{},send=()=>true,subscribe=ids=>sessions=ids,subscribeAll=subscribe;
export const on=fn=>{handlers.add(fn);return()=>handlers.delete(fn)},onReopen=()=>()=>{},onCommand=()=>()=>{};
export const setUiState=()=>{},sendSnapshot=()=>{},isReady=()=>true;
`;
const result=await build({stdin:{contents:`
import {mount,unmount} from 'svelte';
import Shell from './packages/shell/views/Index.svelte';
import {emitLocal} from './packages/shell/views/lib/bus.js';
window.testBus=emitLocal;
window.testShell=mount(Shell,{target:document.getElementById('app')});
window.destroyShell=()=>unmount(window.testShell);
`,resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent',
  plugins:[{name:'simulated-agent',setup(builder){builder.onLoad({filter:/packages\/shell\/views\/agents\/runtime\.js$/},()=>({contents:runtime,loader:'js'}));}},sveltePlugin({compilerOptions:{css:'injected'}})],
  loader:{'.svg':'text','.png':'dataurl'},
});
const bundle=result.outputFiles.find(file=>file.path.endsWith('.js'))?.text ?? result.outputFiles[0].text;
const server=createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if(req.url==='/'||req.url==='/preview'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0"><div id="app"></div>'+(req.url==='/'?'<script src="/bundle.js"></script>':'Preview')+'</body></html>');return;}
  let payload=[];
  if(req.url?.endsWith('/status'))payload={active:false};
  else if(req.url?.includes('/provider'))payload={provider:'test',model:'model'};
  else if(req.url?.includes('/system/view'))payload={state:{idPrefix:'',defaultModel:null}};
  else if(req.url?.includes('/availability'))payload={packages:{artifacts:false,bags:false}};
  else if(req.url?.includes('/chat/send'))payload={accepted:true};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const mobile of [false,true]){
    const context=await browser.createBrowserContext();
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport(mobile?{width:390,height:844,isMobile:true,hasTouch:true}:{width:1440,height:1000});
    await page.evaluateOnNewDocument(()=>{window.WebSocket=undefined;});
    await page.setRequestInterception(true);
    page.on('request',req=>req.url().startsWith('http://127.0.0.1:')?req.continue():req.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'networkidle0'});
    await page.waitForSelector('.shell.layout-ready');
    const first=await page.evaluate(()=>window.testRuntime.sessions()[0]); assert.ok(first);
    await page.evaluate(id=>{
      window.testRuntime.emit({type:'chat:event',session_id:id,event:'start',data:{},seq:1,epoch:'e'});
      window.testRuntime.emit({type:'chat:event',session_id:id,event:'token',data:{text:'Streaming visible'},seq:2,epoch:'e'});
    },first);
    await page.waitForFunction(()=>document.body.innerText.includes('Streaming visible'));
    await page.evaluate(id=>window.testRuntime.emit({type:'chat:event',session_id:id,event:'done',data:{response:'Completed visible'},seq:3,epoch:'e'}),first);
    await page.waitForFunction(()=>document.body.innerText.includes('Completed visible'));
    await page.evaluate(()=>window.testBus('open:iframe',{url:'/preview',title:'Preview'}));
    await page.waitForSelector('iframe[src="/preview"]');
    if(mobile){
      await page.click('button[aria-label="Back"]');
      await page.waitForFunction(()=>document.querySelector('.chat-panel')?.getBoundingClientRect().width>0);
      await page.click('button[aria-label="Forward"]');
      await page.waitForFunction(()=>document.querySelector('iframe[src="/preview"]')?.getBoundingClientRect().width>0);
    }
    await page.evaluate(()=>window.testShell.handleNewTab());
    await page.waitForFunction(id=>window.testRuntime.sessions().some(s=>s!==id),{},first);
    const second=await page.evaluate(id=>window.testRuntime.sessions().find(s=>s!==id),first); assert.ok(second);
    await page.evaluate(id=>window.testRuntime.emit({type:'chat:event',session_id:id,event:'done',data:{response:'New session visible'},seq:1,epoch:'new'}),second);
    await page.waitForFunction(()=>document.body.innerText.includes('New session visible'));
    await page.evaluate(()=>window.destroyShell());
    assert.deepEqual(errors,[]);
    console.log(`PASS ${mobile?'mobile':'desktop'}: mount, stream, completion, app bus, new session, unmount${mobile?', back/forward':''}`);
    await context.close();
  }
}finally{
  await browser?.close(); await new Promise(resolve=>server.close(resolve));
}
