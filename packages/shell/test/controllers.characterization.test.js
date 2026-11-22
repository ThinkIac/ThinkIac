import { afterEach, describe, expect, test, vi } from 'vitest';
import { createShellController } from './helpers/shell-controller.js';
import { createHistoryMessages } from '../views/lib/history_messages.js';
import { createSessionActivationGuard } from '../views/lib/session_activation.js';
import { historyStateWithMobileDestination, mobileDestinationFromHistoryState } from '../views/lib/mobile_browser_history.js';
import { normalizeTabOrder } from '../views/lib/tab_groups.js';
import { closeAllAppTabs } from '../views/lib/app_tabs.js';
import { closeAllChatTabs, closeChatTab } from '../views/lib/chat_tabs.js';
import { createNewTopicWorkspace } from '../views/lib/new_topic.js';

const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
function setup(overrides = {}) {
  const state = {
    sessionId: 'a', activeTab: 'a', activeAgentId: 'agent', activeIsApp: false,
    tabs: [{sessionId:'a',name:'New Mission',pinned:false}], appTabs: [], tabOrder: ['a'],
    sessionCache: {}, history: [], loadingMap: {}, unreadMap: {}, cursorMap: {}, reconcileGeneration: {},
    isMobile: false, historyTruncated: false, loadingFullHistory: false, message: 'draft', refreshTrigger: 0,
    listRef: {scrollBottom: vi.fn()}, tick: vi.fn(async () => {}),
    api: vi.fn(async () => null), apiForAgent: vi.fn(async () => null),
    busEmitLocal: vi.fn(), readSessionAgent: vi.fn(() => 'agent'), localStorage: {},
    agentRuntime: {activateAgent:vi.fn(),send:vi.fn(),requestForAgent:vi.fn(),request:vi.fn()},
    sessionActivation: createSessionActivationGuard(), fetch: vi.fn(async () => ({ok:true,json:async()=>[]})),
    clearComposerDraft: vi.fn(), saveSessionState:vi.fn(), restoreSessionState:vi.fn(), shellScope:null,
    mobileNavigation:[], mobileForwardNavigation:[], mobilePanel:null, chatMenuOpen:false, appMenuOpen:false,
    appLoadingMap:{}, appRefreshingMap:{}, appLoadTimers:{}, APP_LOAD_FALLBACK_MS:1200,
    iframeRefs:{}, appReloadKeys:{}, closeAllAppTabs, closeAllChatTabs, closeChatTab, createNewTopicWorkspace,
    normalizeTabOrder, historyStateWithMobileDestination, mobileDestinationFromHistoryState,
    initialId:'initial', recentSessions:[], recentSessionsLoading:false, recentSessionsRequested:false,
    recentSessionsVisibleCount:5, RECENT_SESSIONS_BATCH_SIZE:5, sessionPreferences:{idPrefix:'',defaultModel:null},
    extractStructuredInput: content => ({content,steps:[]}),
    ...createHistoryMessages({resourceUrl:p=>p,processAssistantMessage:m=>m}),
    window: {location:{origin:'https://example.test',pathname:'/shell',href:'https://example.test/shell'},history:{state:{},pushState:vi.fn(),replaceState:vi.fn()}},
    ...overrides,
  };
  return {state, controller:createShellController(state)};
}
afterEach(() => vi.useRealTimers());

describe('chat event characterization', () => {
  test('deduplicates cursors within an epoch and accepts a new epoch', () => {
    const {state:s,controller:c}=setup();
    c.applyChatEvent('a','token',{text:'a'},3,'old');
    c.applyChatEvent('a','token',{text:'duplicate'},3,'old');
    c.applyChatEvent('a','token',{text:'older'},2,'old');
    c.applyChatEvent('a','token',{text:'b'},1,'new');
    expect(s.history[0].content).toBe('ab'); expect(s.cursorMap.a).toEqual({epoch:'new',seq:1});
  });
  test('start creates only one streaming assistant',()=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','start',{}); c.applyChatEvent('a','start',{});
    expect(s.loadingMap.a).toBe(true); expect(s.history).toHaveLength(1); expect(s.history[0].pendingPermissions).toEqual([]);
  });
  test('accepted user precedes streaming while queued input follows it',()=>{
    const {controller:c}=setup(); const stream={role:'assistant',streaming:true};
    expect(c.insertUserMessage([stream],{role:'user',content:'accepted'}).map(m=>m.role)).toEqual(['user','assistant']);
    expect(c.insertUserMessage([stream],{role:'user',queued:true}).map(m=>m.role)).toEqual(['assistant','user']);
    expect(c.settleQueuedMessage([stream,{role:'user',queued:true}],1)).toEqual([{role:'user',queued:false,justSettled:true},stream]);
  });
  test('user confirmation consumes local echo without duplication',()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{role:'user',content:'visible',_localEchoContent:'wire',queued:true}]}});
    c.applyChatEvent('a','user_message',{text:'wire'});
    expect(s.history).toEqual([{role:'user',content:'visible'}]);
  });
  test('queued input is deduplicated and settled on acceptance',()=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','start',{});
    c.applyChatEvent('a','queued',{text:'later'}); c.applyChatEvent('a','queued',{text:'later'});
    expect(s.history).toHaveLength(2); c.applyChatEvent('a','user_message',{text:'later'});
    expect(s.history[0]).toMatchObject({role:'user',content:'later',queued:false,justSettled:true});
  });
  test('input trace enriches the user without adding a message',()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{role:'user',content:'hello'}]}});
    c.applyChatEvent('a','input_trace',{text:'hello',inputTrace:{source:'test'}});
    expect(s.history).toHaveLength(1); expect(s.history[0].inputTrace).toEqual({source:'test'});
  });
  test('reasoning, model and usage enrich the streaming message',()=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','reasoning',{text:'think'}); c.applyChatEvent('a','reasoning',{text:' more'});
    c.applyChatEvent('a','model',{model:'m',provider:'p'}); c.applyChatEvent('a','usage',{usage:{cost:1}});
    expect(s.history[0]).toMatchObject({allReasoning:'think more',model:'m',provider:'p',usage:{cost:1},content:''});
  });
  test('permission request notifies and resolution updates the card',()=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','permission_request',{request_id:'r',tool_name:'write'});
    expect(s.busEmitLocal).toHaveBeenCalledWith('notifications:push',expect.objectContaining({kind:'governance',requestId:'r'}));
    c.applyChatEvent('a','permission_resolved',{request_id:'r',decision:'deny'});
    expect(s.history[0].pendingPermissions[0].status).toBe('deny');
  });
  test('tool result matches its call id rather than the last step',()=>{
    const {state:s,controller:c}=setup();
    c.applyChatEvent('a','step',{toolCallId:'one',label:'first',reasoning:'step only',input:{x:1}});
    c.applyChatEvent('a','step',{toolCallId:'two',label:'second'});
    c.applyChatEvent('a','step',{toolCallId:'one',result:'ok',completedAt:'now'});
    expect(s.history[0].steps[0]).toMatchObject({result:'ok',completedAt:'now',args:{x:1}});
    expect(s.history[0].steps[1].result).toBe(null); expect(s.history[0].allReasoning).toBe(null);
  });
  test('legacy tool results resolve the last pending step',()=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','step',{label:'tool'}); c.applyChatEvent('a','step',{result:false});
    expect(s.history[0].steps[0].result).toBe(false);
  });
  test('done finalizes foreground without notifying or marking unread',()=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','token',{text:'partial'}); c.applyChatEvent('a','done',{response:'final',timestamp:'now',usage:{total:2}});
    expect(s.history[0]).toMatchObject({content:'final',streaming:false,justCompleted:true,createdAt:'now',usage:{total:2}});
    expect(s.loadingMap.a).toBe(false); expect(s.unreadMap.a).toBeUndefined(); expect(s.busEmitLocal).not.toHaveBeenCalled();
  });
  test('background completion preserves foreground and notifies',()=>{
    const {state:s,controller:c}=setup({history:[{content:'foreground'}]}); c.applyChatEvent('b','done',{response:' background  answer '});
    expect(s.history).toEqual([{content:'foreground'}]); expect(s.unreadMap.b).toBe(true);
    expect(s.busEmitLocal).toHaveBeenCalledWith('notifications:push',expect.objectContaining({message:'background answer'}));
  });
  test.each(['error','timeout'])('%s terminates loading',event=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','start',{}); c.applyChatEvent('a',event,{error:'failed'});
    expect(s.loadingMap.a).toBe(false); expect(s.history[0].streaming).toBe(false);
    expect(s.history[0].content).toBe(event==='error'?'failed':''); if(event==='timeout') expect(s.history[0].timedOut).toBe(true);
  });
  test('commit and unknown events do not render messages',()=>{
    const {state:s,controller:c}=setup(); c.applyChatEvent('a','commit',{}); c.applyChatEvent('a','unknown',{}); expect(s.history).toEqual([]);
  });
});

describe('send and governance characterization',()=>{
  test('empty input does nothing',async()=>{const {state:s,controller:c}=setup(); await c.send({detail:{text:''}}); expect(s.api).not.toHaveBeenCalled();});
  test('accepted send keeps wire payload and clears only the current draft',async()=>{
    const {state:s,controller:c}=setup({api:vi.fn(async()=>({accepted:true}))});
    await c.send({detail:{text:'hello',settings:{model:'m'},metadata:{id:1},retry:true}});
    expect(s.api).toHaveBeenCalledWith('/chat/send','POST',expect.objectContaining({message:'hello',session_id:'a',settings:{model:'m'},metadata:{id:1},retry:true}));
    expect(s.history.map(m=>m.role)).toEqual(['user','assistant']); expect(s.message).toBe(''); expect(s.clearComposerDraft).toHaveBeenCalledWith('a');
  });
  test('send failure preserves draft and reports error',async()=>{
    const {state:s,controller:c}=setup(); await c.send({detail:{text:'hello'}});
    expect(s.message).toBe('draft'); expect(s.clearComposerDraft).not.toHaveBeenCalled(); expect(s.history[1]).toMatchObject({streaming:false,content:expect.stringContaining('network failure')});
  });
  test('busy sends queue after the streaming response',async()=>{
    const {state:s,controller:c}=setup({loadingMap:{a:true},sessionCache:{a:[{role:'assistant',streaming:true}]},api:vi.fn(async()=>({queued:true}))});
    await c.send({detail:{text:'next'}}); expect(s.history[1]).toMatchObject({role:'user',queued:true}); expect(s.history).toHaveLength(2);
  });
  test('attachment payloads preserve reference, text and OCR formats',async()=>{
    const {state:s,controller:c}=setup({api:vi.fn(async()=>({accepted:true}))});
    await c.send({detail:{text:'files',attachments:[{isImage:true,path:'/image',name:'pic'},{isText:true,textContent:'source',path:'/text'},{ocrText:'scan',name:'ocr'}]}});
    const body=s.api.mock.calls[0][2]; expect(body.message).toContain('[Attached reference: type=image; path=/image; mime=application/octet-stream; name=pic]');
    expect(body.message).toContain('// Path: /text\nsource'); expect(body.message).toContain('[Automatic OCR: ocr]\nscan');
  });
  test('switching session while sending does not clear the new draft',async()=>{
    const pending=deferred(); const {state:s,controller:c}=setup({api:vi.fn(()=>pending.promise)});
    const sent=c.send({detail:{text:'old'}}); await Promise.resolve(); s.sessionId='b'; s.message='new'; pending.resolve({accepted:true}); await sent;
    expect(s.message).toBe('new'); expect(s.clearComposerDraft).toHaveBeenCalledWith('a');
  });
  test('forwarded answers clear echo flags',async()=>{
    const {state:s,controller:c}=setup({api:vi.fn(async()=>({forwarded:true}))}); await c.send({detail:{text:'answer'}});
    expect(s.history[0]._localEchoContent).toBeUndefined(); expect(s.history[0].queued).toBeUndefined();
  });
  test('cancel only removes queued messages after server success',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{role:'user',queued:true},{role:'assistant'}]}});
    await c.handleStop(); expect(s.sessionCache.a).toHaveLength(2); s.api.mockResolvedValue({success:true}); await c.handleStop(); expect(s.history).toEqual([{role:'assistant'}]);
  });
  test('permission failure preserves pending status and exposes error',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{pendingPermissions:[{request_id:'r',status:'pending'}]}]}});
    await c.handleResolvePermission({detail:{request_id:'r',decision:'allow'}});
    expect(s.history[0].pendingPermissions[0]).toMatchObject({status:'pending',error:expect.any(String)}); expect(s.busEmitLocal).not.toHaveBeenCalled();
    s.api.mockResolvedValue({ok:true}); await c.handleResolvePermission({detail:{request_id:'r',decision:'deny'}});
    expect(s.history[0].pendingPermissions[0]).toMatchObject({status:'deny',error:null}); expect(s.busEmitLocal).toHaveBeenCalledWith('notifications:resolved',{sessionId:'a',requestId:'r'});
  });
  test('governance lookup failure keeps the structured card',async()=>{
    const card={_structuredData:[{governanceDecisionId:'r'}]}; const {state:s,controller:c}=setup({sessionCache:{a:[card]},fetch:vi.fn(async()=>{throw Error('offline')})});
    await c.discardResolvedGovernanceCard('a'); expect(s.sessionCache.a[0]).toBe(card);
  });
  test('confirmed resolved governance card is cleared',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{_structuredData:[{governanceDecisionId:'r'}]}]}});
    await c.discardResolvedGovernanceCard('a'); expect(s.history[0]._structuredData).toBe(null);
  });
});

describe('session loading and reconciliation characterization',()=>{
  test('history path encodes ids and uses a mobile limit',()=>{
    const {state:s,controller:c}=setup(); expect(c.historyPath('a/b')).toBe('/sessions/a%2Fb/history?limit=all'); s.isMobile=true;
    expect(c.historyPath('a')).toContain('limit=100'); expect(c.historyPath('a',true)).toContain('limit=all');
  });
  test('cached session activates agent and acknowledges notifications',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{role:'user',content:'cached'}]}}); await c.activateSession('a');
    expect(s.history[0]).toMatchObject({content:'cached',thinkingExpanded:false}); expect(s.agentRuntime.activateAgent).toHaveBeenCalledWith('agent');
    expect(s.busEmitLocal).toHaveBeenCalledWith('ntfy:session-read',{sessionId:'a'});
  });
  test('late activation response cannot replace a newer session',async()=>{
    const a=deferred(); const {state:s,controller:c}=setup({api:vi.fn(path=>path.includes('/a/')?a.promise:Promise.resolve([{role:'user',content:'B'}]))});
    const first=c.activateSession('a'); await c.activateSession('b'); a.resolve([{role:'user',content:'A'}]); await first;
    expect(s.sessionId).toBe('b'); expect(s.history[0].content).toBe('B');
  });
  test('live local echo wins over persisted history during activation',async()=>{
    const pending=deferred(); const {state:s,controller:c}=setup({api:vi.fn(()=>pending.promise)}); const load=c.activateSession('a');
    s.sessionCache.a=[{role:'user',content:'echo',_localEchoContent:'echo'}]; pending.resolve([{role:'user',content:'stale'}]); await load;
    expect(s.history[0].content).toBe('echo');
  });
  test('unreachable status preserves streaming state',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{streaming:true}]},loadingMap:{a:true}}); await c.reconcileSession('a');
    expect(s.sessionCache.a[0].streaming).toBe(true); expect(s.loadingMap.a).toBe(true);
  });
  test('inactive status reloads a stale stream from storage',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{streaming:true}]},loadingMap:{a:true}});
    s.agentRuntime.requestForAgent.mockImplementation(async(_,path)=>({json:async()=>path.endsWith('/status')?{active:false}:[{role:'assistant',content:'persisted'}]}));
    await c.reconcileSession('a'); expect(s.loadingMap.a).toBe(false); expect(s.history[0].content).toBe('persisted');
  });
  test('inactive status preserves an unconfirmed local echo',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{role:'user',_localEchoContent:'pending'}]},loadingMap:{a:true}});
    s.agentRuntime.requestForAgent.mockResolvedValue({json:async()=>({active:false})}); await c.reconcileSession('a');
    expect(s.sessionCache.a[0]._localEchoContent).toBe('pending'); expect(s.loadingMap.a).toBe(true);
  });
  test('replay uses the session agent and deduplicates live events',async()=>{
    const {state:s,controller:c}=setup({cursorMap:{a:{epoch:'e',seq:2}},sessionCache:{a:[{role:'assistant',content:'live',streaming:true}]}});
    s.agentRuntime.requestForAgent.mockImplementation(async(_,path)=>({json:async()=>path.endsWith('/status')?{active:true}:{active:true,epoch:'e',events:[{id:2,event:'token',data:{text:'duplicate'}},{id:3,event:'token',data:{text:' new'}}]}}));
    await c.reconcileSession('a'); expect(s.history[0].content).toBe('live new');
    expect(s.agentRuntime.requestForAgent.mock.calls.every(call=>call[0]==='agent')).toBe(true);
  });
  test('clear invalidates pending reconciliation and cursor',async()=>{
    const {state:s,controller:c}=setup({cursorMap:{a:{seq:3}},reconcileGeneration:{a:7},sessionCache:{a:[{content:'old'}]},history:[{content:'old'}]});
    await c.handleClearSession('a'); expect(s.cursorMap.a).toBeUndefined(); expect(s.reconcileGeneration.a).toBe(8); expect(s.history).toEqual([]);
  });
  test('full history cannot replace a newly selected session',async()=>{
    const pending=deferred(); const {state:s,controller:c}=setup({historyTruncated:true}); s.agentRuntime.requestForAgent.mockReturnValue(pending.promise);
    const load=c.loadFullHistory(); s.sessionId='b'; pending.resolve({json:async()=>[{role:'user',content:'old'}]}); await load;
    expect(s.history).toEqual([]); expect(s.loadingFullHistory).toBe(false);
  });
});

describe('navigation and persistence characterization',()=>{
  test('snapshot saves coordinates and tabs without conversation history',()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{content:'large'}]},shellScope:{workspaceId:'w',shellId:'s'}}); c.fullSaveSessionState();
    expect(s.saveSessionState).toHaveBeenCalledWith(expect.objectContaining({sessionId:'a',tabs:s.tabs}),s.shellScope);
    expect(s.saveSessionState.mock.calls[0][0].sessionCache).toBeUndefined();
  });
  test('restore ignores legacy cached messages and normalizes tab order',()=>{
    const {state:s,controller:c}=setup({restoreSessionState:vi.fn(()=>({tabs:[{sessionId:'b'}],sessionId:'b',activeTab:'b',sessionCache:{b:[{content:'old'}]},tabOrder:['bad','b']}))});
    expect(c.fullRestoreSessionState()).toBe(true); expect(s.sessionId).toBe('b'); expect(s.sessionCache).toEqual({}); expect(s.tabOrder).toEqual(['b']);
  });
  test('missing snapshot does not restore',()=>{const {controller:c}=setup(); expect(c.fullRestoreSessionState()).toBe(false);});
  test('internal path refuses external and protocol relative destinations',async()=>{
    const {state:s,controller:c}=setup(); await c.abrirCaminhoInterno('https://evil'); await c.abrirCaminhoInterno('//evil'); await c.abrirCaminhoInterno(null); expect(s.appTabs).toEqual([]);
  });
  test('iframe open reuses the existing tab',()=>{
    const {state:s,controller:c}=setup({appTabs:[{id:'iframe:/page',url:'/page',name:'Original'}]}); c.abrirIframe({url:'/page',title:'New'});
    expect(s.appTabs).toHaveLength(1); expect(s.appTabs[0].name).toBe('Original'); expect(s.activeTab).toBe('iframe:/page');
  });
  test('unknown deep link does not create an app',async()=>{
    const {state:s,controller:c}=setup({api:vi.fn(async()=>[])}); await c.abrirAppPorDeepLink('missing'); expect(s.appTabs).toEqual([]);
  });
  test('mobile navigation bounds history and clears forward stack',()=>{
    const {state:s,controller:c}=setup({isMobile:true,mobileNavigation:Array.from({length:45},()=>({kind:'chat',id:'a'})),mobileForwardNavigation:[{kind:'chat',id:'a'}]});
    c.recordMobileNavigation({kind:'chat',id:'b'}); expect(s.mobileNavigation).toHaveLength(40); expect(s.mobileForwardNavigation).toEqual([]); expect(s.window.history.pushState).toHaveBeenCalledOnce();
  });
  test('desktop navigation does not write browser history',()=>{
    const {state:s,controller:c}=setup(); c.recordMobileNavigation({kind:'chat',id:'b'}); expect(s.window.history.pushState).not.toHaveBeenCalled();
  });
  test('closing the last mobile tab clears state',async()=>{
    const {state:s,controller:c}=setup({isMobile:true,sessionCache:{a:[{content:'old'}]}}); await c.closeActiveMobileTab();
    expect(s.tabs).toEqual([]); expect(s.history).toEqual([]); expect(s.activeTab).toBe(''); expect(s.sessionCache.a).toBeUndefined();
  });
  test('app load fallback expires without iframe load',()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup(); c.startAppLoad('app'); expect(s.appLoadingMap.app).toBe(true); vi.advanceTimersByTime(1200);
    expect(s.appLoadingMap.app).toBe(false); expect(s.appLoadTimers.app).toBeUndefined();
  });
  test('recent session list filters the initial placeholder and paginates',async()=>{
    const {state:s,controller:c}=setup(); s.agentRuntime.requestForAgent.mockResolvedValue({json:async()=>[{id:'initial'},...Array.from({length:8},(_,i)=>({id:String(i)}))]});
    await c.loadRecentSessions(); expect(s.recentSessions).toHaveLength(8); expect(s.recentSessionsVisibleCount).toBe(5); c.loadMoreRecentSessions(); expect(s.recentSessionsVisibleCount).toBe(8);
  });
});

describe('workspace and integration characterization before extraction',()=>{
  test('closing a chat does not cancel its server turn',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{role:'user',content:'old'}]},loadingMap:{a:true}}); await c.handleCloseTab('a');
    expect(s.tabs.some(t=>t.sessionId==='a')).toBe(false); expect(s.sessionCache.a).toBeUndefined(); expect(s.loadingMap.a).toBe(false);
    expect(s.api.mock.calls.some(call=>call[0]==='/chat/cancel')).toBe(false);
  });
  test('rename and pin persist tabs and accept event payloads',()=>{
    const {state:s,controller:c}=setup(); c.handleRenameTab({detail:{sessionId:'a',name:'renamed'}}); c.handleTogglePin({detail:'a'});
    expect(s.tabs[0]).toMatchObject({name:'renamed',pinned:true}); expect(s.saveSessionState).toHaveBeenCalledTimes(2);
  });
  test('new topic preserves existing tabs and gets a clean history',async()=>{
    const {state:s,controller:c}=setup({history:[{content:'old'}]}); await c.handleNewTab();
    expect(s.tabs).toHaveLength(2); expect(s.sessionId).not.toBe('a'); expect(s.history).toEqual([]); expect(s.activeIsApp).toBe(false);
  });
  test('new session ids only accept a valid configured prefix',()=>{
    const {state:s,controller:c}=setup({sessionPreferences:{idPrefix:' TEAM ',defaultModel:null}}); expect(c.generateSessionId()).toMatch(/^team-/);
    s.sessionPreferences.idPrefix='../bad'; expect(c.generateSessionId()).not.toContain('../bad');
  });
  test('new session applies its model before entering the workspace',async()=>{
    const {state:s,controller:c}=setup({sessionPreferences:{idPrefix:'',defaultModel:'model'}}); await c.handleNewTab();
    expect(s.agentRuntime.request).toHaveBeenCalledWith('/session/model',expect.objectContaining({method:'POST',body:JSON.stringify({session_id:s.sessionId,model:'model'})}));
  });
  test('mobile browser back consumes navigation without pushing another entry',async()=>{
    const {state:s,controller:c}=setup({isMobile:true,activeTab:'app',activeIsApp:true,appTabs:[{id:'app'}],mobileNavigation:[{kind:'chat',id:'a'}],sessionCache:{a:[{role:'user',content:'cached'}]}});
    const browser=historyStateWithMobileDestination({}, {kind:'chat',id:'a'}); await c.handleMobileBrowserBack({state:browser});
    expect(s.activeTab).toBe('a'); expect(s.mobileNavigation).toEqual([]); expect(s.mobileForwardNavigation).toEqual([{kind:'app',id:'app'}]); expect(s.window.history.pushState).not.toHaveBeenCalled();
  });
  test('mobile back skips deleted destinations and forward restores the app',async()=>{
    const {state:s,controller:c}=setup({isMobile:true,activeTab:'app',activeIsApp:true,appTabs:[{id:'app'}],mobileNavigation:[{kind:'chat',id:'a'},{kind:'chat',id:'deleted'}],sessionCache:{a:[{role:'user',content:'cached'}]}});
    await c.goBackMobile(); expect(s.activeTab).toBe('a'); await c.goForwardMobile(); expect(s.activeTab).toBe('app'); expect(s.activeIsApp).toBe(true);
  });
  test('only edge swipes open drawers and inward swipes close them',()=>{
    const {state:s,controller:c}=setup({isMobile:true}); expect(c.handleSystemSwipe({type:'swipe',direction:'right'}).handled).toBe(false);
    expect(c.handleSystemSwipe({type:'swipe',direction:'right',fromEdge:'left'}).handled).toBe(true); expect(s.mobilePanel).toBe('left');
    expect(c.handleSystemSwipe({type:'swipe',direction:'left'}).handled).toBe(true); expect(s.mobilePanel).toBe(null);
  });
  test('app open deduplicates ids, persists and closes mobile drawer',()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({isMobile:true,mobilePanel:'right'});
    c.handleOpenApp({detail:{id:'app',url:'/app',name:'App'}}); c.handleOpenApp({detail:{id:'app',url:'/other',name:'Other'}});
    expect(s.appTabs).toHaveLength(1); expect(s.appTabs[0].url).toBe('/app'); expect(s.activeIsApp).toBe(true); expect(s.mobilePanel).toBe(null); expect(s.appLoadingMap.app).toBe(false);
  });
  test('closing active app returns to chat without deleting conversation',()=>{
    const {state:s,controller:c}=setup({activeTab:'app',activeIsApp:true,appTabs:[{id:'app'}],sessionCache:{a:[{content:'keep'}]}});
    c.handleCloseApp('app'); expect(s.activeTab).toBe('a'); expect(s.activeIsApp).toBe(false); expect(s.sessionCache.a[0].content).toBe('keep');
  });
  test('app with path inherits catalog metadata and URL identity',async()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({api:vi.fn(async()=>[{name:'Editor',url:'/view/editor/Index',icon:'icon'}])});
    await c.abrirAppComPath({pkg:'editor',url:'/view/editor/Embed?path=a.js'});
    expect(s.appTabs[0]).toMatchObject({id:'open:/view/editor/Embed?path=a.js',name:'Editor',icon:'icon'});
  });
  test('job result prefers file manager and encodes the selected file',async()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({api:vi.fn(async()=>[{name:'Files',url:'/view/file-manager/Index?mode=list'}])});
    await c.abrirResultadoPorDeepLink({pkg:'job',file:'my folder/a b.csv'});
    expect(s.appTabs[0].url).toBe('/view/file-manager/Index?mode=list&path=my%20folder&select=a%20b.csv');
  });
  test('job result falls back to its source package',async()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({api:vi.fn(async()=>[{id:'job',url:'/view/job/Index'}])});
    await c.abrirResultadoPorDeepLink({pkg:'job',file:'result.csv'}); expect(s.appTabs[0].id).toBe('job');
  });
  test('feature availability prevents offering absent bags and artifacts',async()=>{
    const {state:s,controller:c}=setup({chatFeatureAvailability:{bags:false,artifacts:false}}); await c.openBag(); c.openArtifactLibrary();
    expect(s.api).not.toHaveBeenCalled(); expect(s.appTabs).toEqual([]);
  });
  test('Desktop handoff consumes URL parameters once',()=>{
    const {state:s,controller:c}=setup({handoff:' hello ',desktopSession:'sid',agentId:'agent',window:{location:{href:'https://example.test/shell?handoff=hello&desktopSession=sid&agentId=agent&keep=1#anchor'},history:{state:{keep:true},replaceState:vi.fn()}}});
    expect(c.consumeDesktopHandoff()).toEqual({text:'hello',sessionId:'sid',agentId:'agent'}); expect(c.consumeDesktopHandoff()).toBe(null);
    expect(s.window.history.replaceState).toHaveBeenCalledWith({keep:true},'', '/shell?keep=1#anchor');
  });
  test('UI bus routes backend events without introducing a second transport',()=>{
    const listeners=new Map(); const {state:s,controller:c}=setup({busOffs:[],bootstrapPackageWidgets:vi.fn(),bootstrapMessageActions:vi.fn(),setServerForwarder:vi.fn(),busOn:vi.fn((name,fn)=>{listeners.set(name,fn);return vi.fn();}),FILE_MANAGER_PREVIEW_EVENT:'file:preview',sessionId:'a',statusModal:null});
    c.setupWidgetBus(); s.setServerForwarder.mock.calls[0][0]('logos:test',{ok:true});
    expect(s.agentRuntime.send).toHaveBeenCalledWith({type:'bus:emit',event:'logos:test',detail:{ok:true}});
    listeners.get('modal-ui')({label:'Bad',url:'https://external'}); expect(s.statusModal).toBe(null);
    listeners.get('modal-ui')({label:'Settings',url:'/settings'}); expect(s.statusModal).toEqual({label:'Settings',url:'/settings'});
    expect(s.busOffs).toHaveLength(listeners.size);
  });
  test('shell control loads catalogue on its first open command',async()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({shellControlApps:[],api:vi.fn(async()=>[{id:'editor',packageName:'editor',url:'/view/editor/Index',default:true}])});
    const result=await c.shellControlCommand('open_app',{appId:'editor'}); expect(result.activeWindowId).toBe('editor'); expect(s.appTabs).toHaveLength(1);
    await expect(c.shellControlCommand('delete_app',{})).rejects.toThrow('not supported');
  });
});

describe('presentation and connection characterization',()=>{
  test('global loading ignores completion from another operation and expires',()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({globalLoading:{active:false,id:null},globalLoadingTimer:null});
    c.setGlobalLoading({id:'current'}); c.setGlobalLoading({active:false,id:'old'}); expect(s.globalLoading.active).toBe(true);
    vi.advanceTimersByTime(120000); expect(s.globalLoading).toEqual({active:false,id:null});
  });
  test('matching completion clears global loading immediately',()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({globalLoading:{active:false,id:null},globalLoadingTimer:null});
    c.setGlobalLoading({id:'current'}); c.setGlobalLoading({active:false,id:'current'}); expect(s.globalLoadingTimer).toBe(null); expect(s.globalLoading.active).toBe(false);
  });
  test('offline reconnect registers only one probe timer and saves state',()=>{
    vi.useFakeTimers(); const {state:s,controller:c}=setup({isOnline:true,wasOffline:false,reconnecting:false,reconnectTimer:null});
    c.handleOffline(); const timer=s.reconnectTimer; c.handleOffline(); expect(s.isOnline).toBe(false); expect(s.reconnectTimer).toBe(timer);
    c.handleOnline(); expect(s.isOnline).toBe(true); expect(s.reconnecting).toBe(false); expect(s.reconnectTimer).toBe(null);
  });
  test('runtime preferences update prefix and model from enveloped state',async()=>{
    const {state:s,controller:c}=setup(); s.agentRuntime.request.mockResolvedValue({ok:true,json:async()=>({data:{state:{idPrefix:'team',defaultModel:'m'}}})});
    await c.loadSessionPreferences(); expect(s.sessionPreferences).toEqual({idPrefix:'team',defaultModel:'m'});
  });
  test('app information shows canonical metadata and a relative route',()=>{
    const {controller:c}=setup(); const rows=c.buildAppDetails({name:'Editor',packageName:'editor',url:'https://host/view/editor/Index',version:'1',mobileSupported:false,scriptCount:0});
    expect(rows).toContainEqual({label:'Route',value:'/view/editor/Index'}); expect(rows).toContainEqual({label:'Mobile',value:'Not supported'}); expect(rows).toContainEqual({label:'Scripts',value:'0'}); expect(c.buildAppDetails(null)).toEqual([]);
  });
  test('structured governance rejects unconfirmed approval without clearing its card',async()=>{
    const reject=vi.fn(),acknowledge=vi.fn(); const card={_structuredData:[{governanceDecisionId:'r'}]};
    const {state:s,controller:c}=setup({structuredProps:[{submitEvent:'confirm',governanceDecisionId:'r',confirmLabel:'Allow'}],lastMessage:card,fetch:vi.fn(async()=>({ok:false,status:503,json:async()=>({error:'Unavailable'})}))});
    await c.onStructuredSend({detail:{responses:['Allow'],reject,acknowledge}}); expect(reject).toHaveBeenCalledWith('Unavailable'); expect(acknowledge).not.toHaveBeenCalled(); expect(card._structuredData).not.toBe(null);
  });
  test('structured event submission carries the session and acknowledges',async()=>{
    const acknowledge=vi.fn(); const emit=vi.fn(); const steps=[{submitEvent:'answer',responseEvent:'resolved'}];
    const {controller:c}=setup({structuredProps:steps,busEmit:emit}); await c.onStructuredSend({detail:{responses:['yes'],text:'yes',acknowledge}});
    expect(emit).toHaveBeenCalledWith('answer',expect.objectContaining({sessionId:'a',steps,responses:['yes'],responseEvent:'resolved'})); expect(acknowledge).toHaveBeenCalledOnce();
  });
  test('feedback ordinal skips user messages and blank assistant messages',async()=>{
    const {state:s,controller:c}=setup({sessionCache:{a:[{role:'user',content:'u'},{role:'assistant',content:' '},{role:'assistant',content:'first'},{role:'assistant',content:'second'}]},api:vi.fn(async()=>({success:true,feedback:{rating:1}}))});
    await c.handleMessageFeedback({detail:{assistantOrdinal:1,feedback:{rating:1}}}); expect(s.history[2].feedback).toBeUndefined(); expect(s.history[3].feedback).toEqual({rating:1});
  });
});
