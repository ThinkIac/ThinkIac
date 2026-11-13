import test from 'node:test';
import assert from 'node:assert/strict';
import { claimActivation, updateActivationLease, recoverActivations } from './activation.js';
test('lease excludes concurrent workers and retry preserves request identity', () => {
 const db={user:{u:{id:'u',username:'u',tenantStatus:'pending'}}};
 const first=claimActivation(db,'u',1000);
 assert.equal(claimActivation(db,'u',1001),null);
 const next=claimActivation(db,'u',301001);
 assert.equal(first.requestId,next.requestId);
 assert.equal(updateActivationLease(db,'u',first.leaseId,0),false);
 assert.equal(updateActivationLease(db,'u',next.leaseId,0),true);
 db.user.u.tenantStatus='ready';
 assert.equal(claimActivation(db,'u',999999),null);
});
test('recovery resumes expired activation and retries confirmed bonus only', async () => {
 const rows=[{id:'u',username:'u',tenantStatus:'pending',emailVerified:false},{id:'v',username:'v',tenantStatus:'ready',emailVerified:true},{id:'app',tenantStatus:null}];
 const db={user:{all:()=>rows,...Object.fromEntries(rows.map(r=>[r.id,r]))}};
 const provisioned=[],credited=[];
 await recoverActivations(db,{provision:async id=>provisioned.push(id),grant:async id=>credited.push(id)});
 assert.deepEqual(provisioned,['u']); assert.deepEqual(credited,['v']);
});
