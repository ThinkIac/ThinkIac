import {afterEach, expect, test, vi} from 'vitest';
import {createMountController} from './helpers/shell-controller.js';

function setup(overrides={}) {
  vi.useFakeTimers();
  const hooks={};
  const state={
    nativeApp:false,desktopHost:false,layoutReady:false,theme:'dark',sessionId:'a',activeAgentId:'agent',activeIsApp:false,
    tabs:[{sessionId:'a'},{sessionId:'b'}],history:[],refreshTrigger:0,open:null,session:null,app:null,pkg:null,file:null,url:null,title:null,listen:null,
    shellDesktopControl:null,composerStage:null,busOffs:[vi.fn()],gestureOffs:[vi.fn()],reconnectTimer:null,globalLoadingTimer:null,
    showLoading:true,floatingShell:false,localStorage:{},navigator:{onLine:true},
    window:{FlutterBridge:{postMessage:vi.fn()},addEventListener:vi.fn(),removeEventListener:vi.fn(),dispatchEvent:vi.fn(),location:{assign:vi.fn()}},
    document:{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()},
    agentRuntime:{activateAgent:vi.fn(),on:vi.fn(fn=>{hooks.message=fn;return vi.fn();}),onReopen:vi.fn(fn=>{hooks.reopen=fn;return vi.fn();}),onCommand:vi.fn(fn=>{hooks.command=fn;return vi.fn();}),connectAll:vi.fn(),subscribeAll:vi.fn(),setUiState:vi.fn(),sendSnapshot:vi.fn()},
    isHostedByDesktop:vi.fn(()=>true),readSessionAgent:vi.fn((_,id)=>id==='b'?'other':'agent'),getTheme:vi.fn(()=>'light'),
    bootstrapBackgroundViews:vi.fn(async()=>{}),fullRestoreSessionState:vi.fn(()=>false),consumeDesktopHandoff:vi.fn(()=>null),
    activateSession:vi.fn(async()=>{}),tick:vi.fn(async()=>{}),requestAnimationFrame:vi.fn(fn=>setTimeout(fn,16)),
    ...Object.fromEntries(['loadSessionPreferences','checkMobile','publishBackgroundContext','applyChatEvent','maybeLoadRecentSessions','busEmitLocal','reconcileSession','createUiSnapshot','setupWidgetBus','bootstrapMenuItems','bootstrapHeaderActions','loadChatFeatureAvailability','loadSystem','loadWorkspace','replaceMobileBrowserHistoryEntry','abrirChatPorDeepLink','abrirAppPorDeepLink','abrirResultadoPorDeepLink','abrirCaminhoInterno','openDesktopComposition','handleSelectSession','handleStop','setupGestureProtocol','measureComposerDock','handleMobileBrowserBack','handleOnline','handleOffline','fullSaveSessionState','postEdgeStatus','disposeBackgroundViews'].map(key=>[key,vi.fn()])),
    ...overrides,
  };
  return {state,hooks,mount:createMountController(state)};
}
afterEach(()=>vi.useRealTimers());
test('mount initializes environment and only declares ready on the next frame',async()=>{
  const {state:s,mount}=setup(); const dispose=mount(); expect(s.nativeApp).toBe(true); expect(s.layoutReady).toBe(true); expect(s.theme).toBe('light'); expect(s.agentRuntime.connectAll).toHaveBeenCalledOnce();
  expect(s.postEdgeStatus).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(16); expect(s.showLoading).toBe(false); expect(s.postEdgeStatus).toHaveBeenCalledWith({type:'ready',surface:'default'}); dispose();
});
test('live messages are accepted only from the session agent',()=>{
  const {state:s,hooks,mount}=setup(); const dispose=mount(); const message={type:'chat:event',session_id:'a',event:'token',data:{text:'hi'},seq:1,epoch:'e'};
  hooks.message({agentId:'other',message}); expect(s.applyChatEvent).not.toHaveBeenCalled(); hooks.message({agentId:'agent',message}); expect(s.applyChatEvent).toHaveBeenCalledWith('a','token',{text:'hi'},1,'e'); dispose();
});
test('backend bus events are reemitted locally',()=>{
  const {state:s,hooks,mount}=setup(); const dispose=mount(); hooks.message({message:{type:'bus:event',event:'logos:test',detail:{ok:true}}});
  expect(s.busEmitLocal).toHaveBeenCalledWith('logos:test',{ok:true}); dispose();
});
test('socket reopen only reconciles sessions owned by that agent',()=>{
  const {state:s,hooks,mount}=setup(); const dispose=mount(); hooks.reopen('other'); expect(s.reconcileSession).toHaveBeenCalledWith('b'); expect(s.reconcileSession).toHaveBeenCalledTimes(1); dispose();
});
test('agent commands reject external paths and wrong-agent commands',()=>{
  const {state:s,hooks,mount}=setup(); const dispose=mount();
  for(const path of ['https://outside','//outside']) hooks.command({agentId:'agent',command:{type:'navigate',path}});
  hooks.command({agentId:'other',command:{type:'navigate',path:'/allowed'}}); expect(s.window.location.assign).not.toHaveBeenCalled();
  hooks.command({agentId:'agent',command:{type:'navigate',path:'/allowed'}}); expect(s.window.location.assign).toHaveBeenCalledWith('/allowed'); dispose();
});
test('restored session is loaded before applying notification deep link',()=>{
  const {state:s,mount}=setup({fullRestoreSessionState:vi.fn(()=>true),open:'chat',session:'notification'}); const dispose=mount();
  expect(s.activateSession).toHaveBeenCalledWith('a'); expect(s.abrirChatPorDeepLink).toHaveBeenCalledWith('notification');
  expect(s.activateSession.mock.invocationCallOrder[0]).toBeLessThan(s.abrirChatPorDeepLink.mock.invocationCallOrder[0]); dispose();
});
test('desktop message routing preserves composition, selection and stop',()=>{
  const {state:s,mount}=setup(); const dispose=mount(); const callback=s.window.addEventListener.mock.calls.find(([event])=>event==='message')[1];
  callback({data:{source:'wrong',type:'shell:stop',detail:{sessionId:'a'}}}); expect(s.handleStop).not.toHaveBeenCalled();
  callback({data:{source:'thinkiac-desktop',type:'shell:stop',detail:{sessionId:'a'}}}); expect(s.handleStop).toHaveBeenCalledWith('a');
  callback({data:{source:'thinkiac-desktop',type:'shell:open-session',detail:{sessionId:'b'}}}); expect(s.handleSelectSession).toHaveBeenCalledWith({detail:{sessionId:'b'}}); dispose();
});
test('unmount removes window listeners, contributed handlers and persistence timer',()=>{
  const {state:s,mount}=setup(); const offBus=s.busOffs[0],offGesture=s.gestureOffs[0]; const dispose=mount(); dispose();
  for(const [event,fn] of s.window.addEventListener.mock.calls) expect(s.window.removeEventListener).toHaveBeenCalledWith(event,fn);
  expect(offBus).toHaveBeenCalledOnce(); expect(offGesture).toHaveBeenCalledOnce(); expect(s.disposeBackgroundViews).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(30000); expect(s.fullSaveSessionState).not.toHaveBeenCalled();
});
