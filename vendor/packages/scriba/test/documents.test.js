import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore } from '../src/documents.js';

const key = ['installation', 'owner', 'demo.layout', '123'];
const operation = (operationId, baseVersion, patches) => ({ operationId, issuedAt: Date.now(), baseVersion, patches, author: 'user:1' });
function fixture() { const db = new Database(':memory:'); return { db, store: new DocumentStore(db) }; }

test('atomic creation, disjoint edits, conflicts and idempotency', () => {
  const { db, store } = fixture();
  try {
    assert.equal(store.get(key), null);
    const initial = operation('create', 0, [{ op:'set', path:[], value:{a:1,b:2,list:[]} }]);
    assert.equal(store.commit(key, initial).version, 1);
    assert.deepEqual(store.commit(key, initial), store.get(key));
    store.commit(key, operation('a', 1, [{op:'set',path:['a'],value:3}]));
    assert.equal(store.commit(key, operation('b', 1, [{op:'set',path:['b'],value:4}])).value.a, 3);
    assert.throws(() => store.commit(key, operation('same', 1, [{op:'set',path:['a'],value:9}])), /CONFLICT/);
    assert.throws(() => store.commit(key, {...initial, patches:[{op:'set',path:[],value:{}}]}), /OPERATION_ID_REUSED/);
    assert.equal(store.get(key).version, 3);
  } finally { db.close(); }
});

test('rolls back snapshot, dedup and outbox together when validation or commit fails', () => {
  const { db, store } = fixture();
  try {
    const op = operation('create', 0, [{op:'set',path:[],value:{ok:true}}]);
    assert.throws(() => store.commit(key, op, { validate: () => { throw new Error('schema'); } }), /schema/);
    assert.equal(store.get(key), null);
    db.exec(`CREATE TRIGGER fail_outbox BEFORE INSERT ON scriba_document_outbox BEGIN SELECT RAISE(ABORT, 'disk failure'); END`);
    assert.throws(() => store.commit(key, op), /disk failure/);
    assert.equal(store.get(key), null);
    db.exec('DROP TRIGGER fail_outbox');
    assert.equal(store.commit(key, op).version, 1);
  } finally { db.close(); }
});

test('rejects unsafe JSON, prototype paths, array index edits and stale operations', () => {
  const { db, store } = fixture();
  try {
    for (const value of [{bad:undefined}, {bad:NaN}, {bad:new Date()}, JSON.parse('{"__proto__":{}}')]) {
      assert.throws(() => store.commit(key, operation('invalid',0,[{op:'set',path:[],value}])), /INVALID_JSON/);
    }
    store.commit(key, operation('create',0,[{op:'set',path:[],value:{list:[1],nested:{a:1}}}]));
    assert.throws(() => store.commit(key, operation('unsafe',1,[{op:'set',path:['__proto__','x'],value:1}])), /INVALID_PATH/);
    assert.throws(() => store.commit(key, operation('index',1,[{op:'set',path:['list','0'],value:2}])), /ATOMIC_ARRAY/);
    const expired = {...operation('old',1,[{op:'set',path:['x'],value:1}]), issuedAt:1};
    assert.throws(() => store.commit(key, expired), /OPERATION_EXPIRED/);
    store.commit(key, operation('remove',1,[{op:'delete',path:['nested']}]));
    assert.throws(() => store.commit(key, operation('descendant',1,[{op:'set',path:['nested','a'],value:2}])), /CONFLICT/);
  } finally { db.close(); }
});

test('reopens existing data, retries outbox, compacts history without losing dedup', async () => {
  const { db, store } = fixture();
  try {
    const op = operation('create',0,[{op:'set',path:[],value:{a:1}}]);
    store.commit(key, op);
    const reopened = new DocumentStore(db);
    assert.equal(reopened.get(key).value.a,1);
    await assert.rejects(reopened.drain(async () => { throw new Error('subscriber down'); }), /subscriber down/);
    const events = [];
    await reopened.drain(async event => events.push(event));
    assert.equal(events.length,1);
    assert.equal('value' in events[0],false);
    reopened.commit(key,operation('edit',1,[{op:'set',path:['a'],value:2}]));
    reopened.compact({history:1});
    assert.equal(reopened.commit(key,op).version,1);
    assert.equal(reopened.get(key).version,2);
  } finally { db.close(); }
});

test('survives closing and reopening SQLite after an unacknowledged commit', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'scriba-durable-'));
  const filename = path.join(directory,'documents.sqlite');
  let db;
  try {
    db = new Database(filename);
    const op = operation('lost-ack',0,[{op:'set',path:[],value:{saved:true}}]);
    const first = new DocumentStore(db).commit(key,op);
    db.close();
    db = new Database(filename);
    const store = new DocumentStore(db);
    assert.deepEqual(store.get(key),first);
    assert.deepEqual(store.commit(key,op),first);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scriba_document_outbox').get().n,1);
  } finally {
    if (db?.open) db.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('adds documents without replacing Scriba tables or the injected database connection', async () => {
  const {default:Scriba} = await import('../src/index.js');
  const scriba = new Scriba();
  const db = new Database(':memory:');
  try {
    scriba.addTenant({id:'document-test',path:':memory:',databaseFactory:()=>db});
    const table = {existing:true};
    scriba._tenants['document-test'].tables.legacy = table;
    assert.equal(scriba.entity('legacy','document-test'),table);
    const store = scriba.documents('document-test');
    assert.equal(store, scriba.documents('document-test'));
    assert.equal(store.db,db);
    store.commit(key,operation('create',0,[{op:'set',path:[],value:{a:1}}]));
    assert.equal(scriba.entity('legacy','document-test'),table);
    assert.throws(()=>scriba.documents('missing'),/não encontrado/);
  } finally { db.close(); }
});
