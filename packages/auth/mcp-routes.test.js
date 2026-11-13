import { describe, it, expect, vi, beforeEach } from 'vitest';
const { db, store } = vi.hoisted(() => ({ db: { user: {}, session: {} }, store: {issue:vi.fn(()=>({token:'once',credentialId:'id'})),list:vi.fn(()=>[]),revoke:vi.fn(()=>true),audit:vi.fn()} }));
vi.mock('logos',()=>({getProxy:()=>db,dispatchEvent:vi.fn(),isPublicRoute:()=>false,isPublicView:()=>false}));
vi.mock('./mcp-auth.js',()=>({createMcpAuth:()=>store}));
import { routerMcpIssue, routerMcpCredentials, routerMcpRevoke } from './index.js';
function response(){const res={status:vi.fn(()=>res),json:vi.fn(()=>res),set:vi.fn(()=>res)};return res;}
beforeEach(()=>{vi.clearAllMocks();db.user={admin:{id:'admin',role:'admin'},user:{id:'user',role:'user',emailVerified:true}};db.session={admin:{id:'admin',userId:'admin',expiresAt:new Date(Date.now()+60000)},user:{id:'user',userId:'user',expiresAt:new Date(Date.now()+60000)}};});
describe('MCP credential management',()=>{
 it('rejects anonymous, regular and delegated users on every management endpoint',async()=>{
  db.session.delegated={...db.session.admin,delegatedSubject:'tenant'};
  for(const fn of [routerMcpIssue,routerMcpCredentials,routerMcpRevoke])for(const session of ['', 'user','delegated']){
   const res=response();await fn({headers:{cookie:`sessionId=${session}`},body:{},params:{}},res);
   expect(res.status).toHaveBeenCalledWith(session?403:401);
  }
  expect(store.issue).not.toHaveBeenCalled();expect(store.revoke).not.toHaveBeenCalled();
 });
 it('binds issued credentials to canonical user and tenant, ignoring forged tenant',async()=>{
  db.user.admin.tenantId='canonical';const res=response();
  await routerMcpIssue({headers:{cookie:'sessionId=admin'},body:{tenantId:'forged',scopes:['mcp:connect']}},res);
  expect(store.issue).toHaveBeenCalledWith(expect.objectContaining({userId:'admin',tenantId:'canonical',scopes:['mcp:connect']}));
  expect(res.status).toHaveBeenCalledWith(201);
  expect(store.audit).toHaveBeenCalledWith(expect.not.objectContaining({token:'once'}));
 });
});
