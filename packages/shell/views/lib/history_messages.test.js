import { describe, expect, test } from 'vitest';
import { createHistoryMessages } from './history_messages.js';
import { extractStructuredInput } from './structured_input.js';

const createHistory = (resourceUrl = p => `active:${p}`) => {
  const history = createHistoryMessages({ resourceUrl, processAssistantMessage });
  function processAssistantMessage(msg) {
    if (msg.role === 'assistant' && msg.content) {
      const structured = extractStructuredInput(msg.content);
      msg._structuredData = structured.steps;
      msg.content = structured.content;
      const refs = history.extractAttachmentRefs(msg.content);
      if (refs.attachments.length) {
        msg.content = refs.content;
        msg.attachments = history.mergeAttachments(msg.attachments, refs.attachments);
      }
    }
    return msg;
  }
  return history;
};
const history = createHistory();
const ref = (path = '/tmp/a b.png', type = 'image', mime = 'image/png', name = 'picture') => `[Attached reference: type=${type}; path=${path}; mime=${mime}; name=${name}]`;

describe('history message compatibility', () => {
  test('normalizes supported text representations only', () => {
    expect([null, false, 3, {}, 'text', {text:'old'}, [{type:'image',text:'hidden'}, {type:'text',text:' a '}, {type:'text',text:4}]].map(history.contentToString)).toEqual(['','','','','text','old','a \n4']);
  });
  test('preserves ordinary text whitespace', () => {
    expect(history.extractAttachmentRefs('  text\n\n\n')).toEqual({content:'  text\n\n\n',attachments:[]});
  });
  test('reconstructs attachment metadata and encodes paths through the adapter', () => {
    const result = history.extractAttachmentRefs(`hello\n\n\n${ref()}`);
    expect(result.content).toBe('hello');
    expect(result.attachments).toEqual([{name:'picture',path:'/tmp/a b.png',mimetype:'image/png',isImage:true,isText:false,base64:null,textContent:null,url:'active:/attachment?path=%2Ftmp%2Fa%20b.png',fromHistory:true}]);
  });
  test('supports legacy images and fallback names and MIME', () => {
    const result = history.extractAttachmentRefs(`${ref('/tmp/doc', 'file', '', '')}[Image Path: /old.png]`);
    expect(result.attachments.map(a => [a.name,a.mimetype,a.isImage])).toEqual([['doc','application/octet-stream',false],['old.png','application/octet-stream',true]]);
  });
  test('retains malformed markers and does not leak regex state between calls', () => {
    expect(history.extractAttachmentRefs('[Attached reference: broken]').content).toBe('[Attached reference: broken]');
    expect(history.extractAttachmentRefs(ref()).attachments).toHaveLength(1);
    expect(history.extractAttachmentRefs(ref()).attachments).toHaveLength(1);
  });
  test('raw upload wins over references without mutating inputs', () => {
    const raw = [{path:'/a',base64:'upload'}];
    const refs = [{path:'/a'}, {path:'/b'}, {path:'/b'}, {path:''}, {path:''}];
    expect(history.mergeAttachments(raw,refs)).toEqual([raw[0],refs[1],refs[3],refs[4]]);
    expect(raw).toHaveLength(1);
    expect(history.mergeAttachments(null,[])).toEqual([]);
  });
  test('rejects non-array history and skips unsupported roles and empty messages', () => {
    expect(history.sanitizeHistoryMessages(null)).toEqual([]);
    expect(history.sanitizeHistoryMessages([{role:'system',content:'secret'}, {role:'tool',content:'result'}, {role:'assistant',content:' '}, {role:'user',content:''}])).toEqual([]);
  });
  test('preserves legacy roles, content aliases and user timing/input trace', () => {
    const metadata = {timestamp:'now'};
    const result = history.sanitizeHistoryMessages([{is_user:true,message:'legacy',metadata,inputTrace:{id:1}}, {text:'answer',createdAt:'later'}]);
    expect(result[0]).toMatchObject({role:'user',content:'legacy',metadata,inputTrace:{id:1},steps:[],streaming:false});
    expect(result[1]).toMatchObject({role:'assistant',content:'answer',createdAt:'later'});
  });
  test('keeps attachment-only users and reconstructs user refs', () => {
    const upload = {path:'/tmp/a b.png',base64:'keep'};
    const result = history.sanitizeHistoryMessages([{role:'user',content:ref(),attachments:[upload]}, {role:'user',attachments:[upload]}]);
    expect(result.map(m=>m.attachments)).toEqual([[upload],[upload]]);
    expect(result[0].content).toBe('');
  });
  test('groups assistants across filtered tool entries with final content and model', () => {
    const result = history.sanitizeHistoryMessages([
      {role:'assistant',content:'working',model:'first',provider:'p',tool_calls:[{function:{name:'lookup',arguments:'{}'},result:0}]},
      {role:'tool',content:'internal'},
      {role:'assistant',content:'done',model:'last',timestamp:'end'},
      {role:'user',content:'next'}, {role:'assistant',content:'separate'}
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({content:'done',model:'last',provider:null,timestamp:'end',allReasoning:'working',steps:[{label:'lookup',args:'{}',result:0,reasoning:'working'}]});
  });
  test('supports tool call aliases and explicit reasoning', () => {
    const [result] = history.sanitizeHistoryMessages([{role:'assistant',content:'work',reasoning_content:'one',tool_calls:[{name:'a',args:{x:1},output:false},{input:'b'}]}, {role:'assistant',content:'final',reasoning:'two'}]);
    expect(result.allReasoning).toBe('one two');
    expect(result.steps).toEqual([{label:'a',args:{x:1},result:false,reasoning:'work'}, {label:'tool',args:'b',result:null,reasoning:'work'}]);
  });
  test('preserves current handling of steps-only and tool-only assistants', () => {
    expect(history.sanitizeHistoryMessages([{role:'assistant',steps:[{label:'old'}]}])[0].steps).toEqual([]);
    expect(history.sanitizeHistoryMessages([{role:'assistant',tool_calls:[{name:'run'}]}])[0]).toMatchObject({content:'',steps:[{label:'run',reasoning:null,args:null,result:null}]});
  });
  test('processes attachments in the final assistant response', () => {
    const [result] = history.sanitizeHistoryMessages([{role:'assistant',content:`answer ${ref()}`}]);
    expect(result.content).toBe('answer');
    expect(result.attachments).toHaveLength(1);
  });
  test('uses the current resolver at call time', () => {
    let prefix = 'one';
    const dynamic = createHistory(p => prefix+p);
    expect(dynamic.extractAttachmentRefs(ref()).attachments[0].url).toMatch(/^one/);
    prefix = 'two';
    expect(dynamic.extractAttachmentRefs(ref()).attachments[0].url).toMatch(/^two/);
  });
});
