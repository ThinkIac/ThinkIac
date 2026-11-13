import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { it, expect, vi } from 'vitest';
import { Container } from '../src/kernel/container';
import { createDb, installDb } from './db-module';

const mobileRuntime = '../../../apps/mobile/runtime-template';

it.each(['index.cjs', 'sql.cjs'])('integrates %s Android storage with Logos boot, proxy, documents and authorization', async (entry) => {
  const require = createRequire(import.meta.url);
  const adapter = require(`${mobileRuntime}/scriba/${entry}`);
  await adapter.initialize?.();
  const loader = (Module as any)._load;
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'logos-android-'));
  const previous = process.env.LOGOS_DATA_DIR;
  const tenant = `android${Date.now()}`;
  const docTenant = `${tenant}docs`;
  (Module as any)._load = function(name: string, ...args: any[]) {
    return name === 'scriba' ? adapter : loader.call(this, name, ...args);
  };
  process.env.LOGOS_DATA_DIR = path.join(root,'data');
  try {
    const { runAsPrincipal } = await import('../src/kernel/authority-context');
    for (const name of [tenant,docTenant]) {
      fs.mkdirSync(path.join(root,name));
      fs.writeFileSync(path.join(root,name,'package.json'),JSON.stringify({name}));
    }
    const dir = path.join(root,tenant);
    fs.writeFileSync(path.join(dir,'schema.prisma'),'model Note {\n id String @id\n title String\n}');
    const Database = require(`${mobileRuntime}/scriba/driver.cjs`);
    const container = new Container({workspace:root, privateVault: {keyring:null, masterKeyProvider:async()=>Buffer.alloc(32,9), databaseFactory:(file:any,key:any)=>new Database(file,{encryptionKey:key})}});
    const db = installDb(container, createDb({ applicationRoot: () => root }));
    await container.bus.emit('package:wiring',{pkg:{folder:tenant,dir}});
    expect(db.getScriba()).toBeInstanceOf(adapter.Scriba);
    const table = (db.getProxy(tenant) as any).note;
    const row = await table.push({title:'local'});
    expect(table.findById(row.id).title).toBe('local');
    expect(fs.existsSync(path.join(root,'data','db',tenant,entry === 'sql.cjs' ? '.database' : '.database.json'))).toBe(true);
    const [a,b] = await Promise.all([db.getDocuments(container,docTenant),db.getDocuments(container,docTenant)]);
    expect(a).toBe(b);
    const key = ['installation','owner','desktop','one'];
    a.commit(key,{operationId:'create',issuedAt:Date.now(),author:'owner',baseVersion:0,patches:[{op:'set',path:[],value:{ready:true}}]});
    expect(b.get(key).value.ready).toBe(true);
    await expect(runAsPrincipal({enforce(){throw new Error('DENIED');}} as any,{kind:'package',id:'other'},()=>db.getDocuments(container,docTenant))).rejects.toThrow('DENIED');
    if (entry === 'sql.cjs') {
      const privateTenant = tenant + 'private';
      fs.mkdirSync(path.join(root,privateTenant));
      fs.writeFileSync(path.join(root,privateTenant,'schema.prisma'),'model Note {\n id String @id\n title String\n}');
      const wiring = container.bus.emit('package:wiring',{pkg:{folder:privateTenant,dir:path.join(root,privateTenant),database:'private'}});
      if (Database.supportsEncryption === false) {
        await wiring;
        expect(fs.existsSync(path.join(root,'data','db',privateTenant,'.database'))).toBe(false);
      } else {
        await wiring;
        const privateTable = (db.getProxy(privateTenant) as any).note;
        await privateTable.push({title:'private-secret-marker'});
        const file = path.join(root,'data','db',privateTenant,'.database');
        expect(fs.readFileSync(file).includes(Buffer.from('private-secret-marker'))).toBe(false);
        expect(()=>new Database(file)).toThrow('DATABASE_ENCRYPTION_MISMATCH');
      }
      delete (globalThis as any)[privateTenant];
    }
    await db.getScriba().close();
  } finally {
    (Module as any)._load = loader;
    if (previous === undefined) delete process.env.LOGOS_DATA_DIR; else process.env.LOGOS_DATA_DIR=previous;
    delete (globalThis as any)[tenant]; delete (globalThis as any)[docTenant];
    fs.rmSync(root,{recursive:true,force:true});
  }
});
