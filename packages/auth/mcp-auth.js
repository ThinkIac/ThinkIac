import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPrincipal } from './runtime/identity.js';
const digest = token => createHash('sha256').update(token).digest('hex');
const validScope = scope => ['mcp:connect','mcp:tools:read','mcp:admin'].includes(scope) || /^mcp:tool:[\w-]+\.[\w.-]+$/.test(scope);

// Hashes and audit records live outside publicly served package directories.
// Synchronous read/modify/atomic-rename keeps revocation current across hot reloads.
export function createMcpAuth({ directory = resolve('.private/auth-mcp'), resolveUser, canAccess } = {}) {
 const file=join(directory,'credentials.json');
 const read=()=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
 const write=records=>{
  mkdirSync(directory,{recursive:true,mode:0o700});
  const temp=join(directory,`.credentials-${randomUUID()}.tmp`);
  writeFileSync(temp,JSON.stringify(records),{mode:0o600,flag:'wx'}); renameSync(temp,file);
 };
 return {
  issue({userId,tenantId=null,scopes,ttlMs=86400000,maxRequestsPerMinute=120}) {
   if(!userId || !Array.isArray(scopes) || !scopes.includes('mcp:connect') || !scopes.every(validScope)) throw new Error('Invalid MCP identity or scopes');
   if(!Number.isFinite(ttlMs)||ttlMs<=0||ttlMs>30*86400000) throw new Error('MCP expiration must be within 30 days');
   if(!Number.isInteger(maxRequestsPerMinute)||maxRequestsPerMinute<1||maxRequestsPerMinute>600)throw new Error('Invalid rate limit');
   const credentialId=randomUUID(); const token=`mcp.${credentialId}.${randomBytes(32).toString('base64url')}`;
   const record={credentialId,tokenHash:digest(token),userId,tenantId,scopes:[...new Set(scopes)],expiresAt:Date.now()+ttlMs,maxRequestsPerMinute,revokedAt:null};
   write([...read(),record]);return {token,credentialId,expiresAt:record.expiresAt};
  },
  revoke(id) {const records=read();const record=records.find(r=>r.credentialId===id);if(!record)return false;record.revokedAt=Date.now();write(records);return true;},
  list(){return read().map(({tokenHash,...record})=>record);},
  async authenticate(token) {
   if(typeof token!=='string'||!/^mcp\.[\w-]+\.[\w-]{43}$/.test(token))return null;
   const record=read().find(r=>r.credentialId===token.split('.')[1]);
   if(!record||record.revokedAt||!(record.expiresAt>Date.now()))return null;
   const expected=Buffer.from(record.tokenHash,'hex'),actual=Buffer.from(digest(token),'hex');
   if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
   const user=await resolveUser(record.userId);
   if(!user||user.disabled||user.status==='disabled'||(user.role!=='admin'&&!user.emailVerified&&!user.googleSub))return null;
   if((user.tenantId??null)!==(record.tenantId??null))return null;
   return {...record,tokenHash:undefined,principal:createPrincipal({subject:user.id,role:user.role}),user};
  },
  async authorize(identity,tool) {
   const qualified=tool.qualifiedName;
   if(typeof qualified!=='string')return false;
   if(!identity.scopes.includes('mcp:admin')&&!identity.scopes.includes(`mcp:tool:${qualified}`))return false;
   return await canAccess(identity.user,qualified.split('.')[0]);
  },
  audit(event) {
   mkdirSync(directory,{recursive:true,mode:0o700});
   // Transport supplies an allowlisted metadata-only record.
   appendFileSync(join(directory,`audit-${new Date().toISOString().slice(0,10)}.jsonl`),JSON.stringify(event)+'\n',{mode:0o600});
  },
 };
}
