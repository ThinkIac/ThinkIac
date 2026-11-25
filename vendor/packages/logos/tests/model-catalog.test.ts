import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrap } from '../src/index';
import { modelCatalog, expressionValidator } from '../src/kernel/model-catalog';
import { modelBinding } from '../src/kernel/model-bindings';
import { runAsPackage } from '../src/kernel/authority-context';
import { compileType, loadType } from '../src/kernel/type-source';
import { stagePackage } from '../src/stabilizer/staging';
import { makeWorkspace } from './helpers';
import TableProxy from '../../scriba/src/TableProxy.js';
const cleanup: Array<() => any> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const schema = 'model Cliente {\n codigo Int @id\n nome String\n email String?\n}\n';
const provider = `###
@register type lookup
@tag {("GET"|"POST")} method
@tag {string} path
@tag {boolean} [public=false]
@tag {ParamDeclaration[]} params
@tag {TypeExpression} returns
###
lookup = (ctx) ->
  resources:
    lookup: (resource) -> ctx.state.set resource.declaration.name, resource
`;
async function fixture(body = 'Cliente[id]', isolated = false, db = true, extra = '') {
  const ws = makeWorkspace(); cleanup.push(ws.cleanup);
  ws.pkg('providers/lookup', {'package.json': '{"name":"lookup"}', 'index.type': provider});
  const dir = ws.pkg('abc/deep/clientes', {'package.json': JSON.stringify({ name: 'clientes', isolated }), 'models.schema': schema,
    'index.type': `###\n@register lookup buscar\n@method GET\n@path /clientes\n@param {Int} id\n@returns {Cliente?}\n###\nbuscar = (id) -> ${body}\n${extra}`});
  const dbModule = {name: 'db', phase: 'boot' as const, api: {getProxy: (tenant: string) => ({Cliente: {7: {codigo: 7, nome: tenant, email: null, _private: 'hidden'}}})}, install() {},
    capabilities: {database(request: any, context: any) { if (request.tenant !== context.package) throw new Error('tenant'); return {codigo: 7, nome: context.package, email: null}; }} };
  const runtime = await bootstrap({workspace: ws.root, externalModules: isolated ? ['isolated-runtime'] : [], modules: db ? [dbModule] : []});
  cleanup.push(() => runtime.close());
  const resource = runtime.container.state('entrypoint:workspace:providers/lookup').get('buscar');
  return {ws, dir, runtime, resource};
}
describe('shared Scriba schemas and LógosType metadata', () => {
  it('loads aliases and validates model arrays, nullable fields, enums and errors without a database', () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const dir = ws.pkg('sample', {'model.scriba': schema, 'same.schema': schema, 'child/package.json': '{}', 'child/foreign.schema': 'model Foreign {\n id Int\n}'});
    const catalog = modelCatalog(dir);
    expect(Object.keys(catalog.models)).toEqual(['Cliente']);
    const validate = expressionValidator('Cliente[]', catalog, 'return');
    expect(validate([{codigo: 1, nome: 'Ana', email: null, _table: {}}])).toEqual([{codigo: 1, nome: 'Ana', email: null}]);
    expect(() => validate([{codigo: 1.2, nome: 'Ana'}])).toThrow(/codigo.*Int/);
    expect(() => expressionValidator('Missing', catalog, 'return')).toThrow(/unknown type/);
    fs.writeFileSync(path.join(dir, 'extra.schema'), 'enum Papel {\n ADMIN\n USER\n}\nmodel Usuario {\n papeis Papel[]\n}');
    const enums = expressionValidator('Usuario', modelCatalog(dir), 'return');
    expect(enums({papeis: ['ADMIN']})).toEqual({papeis: ['ADMIN']});
    expect(() => enums({papeis: ['OTHER']})).toThrow(/Papel/);
  });
  it('validates metadata and transparently resolves a package-local model, returning a DTO', async () => {
    const {resource} = await fixture();
    expect(resource.metadata).toMatchObject({method: 'GET', path: '/clientes', public: false, returns: 'Cliente?'});
    expect(resource.metadata.params[0]).toMatchObject({name: 'id', type: 'Int'});
    expect(await resource.handler(7)).toEqual({codigo: 7, nome: 'abc/deep/clientes', email: null});
    expect(resource.handler(99)).toBeUndefined();
    expect(() => resource.handler('7')).toThrow(/Int/);
  });
  it('uses models for validation without loading persistence', async () => {
    const {resource} = await fixture('{codigo: id, nome: "Ana", email: null}', false, false);
    expect(resource.handler(7)).toEqual({codigo: 7, nome: 'Ana', email: null});
  });
  it('reports the missing persistence provider at access time', async () => {
    const {resource} = await fixture(undefined, false, false);
    expect(() => resource.handler(7)).toThrow(/PERSISTENCE_PROVIDER_MISSING/);
  });
  it('keeps parameters and local variables ahead of ambient model names', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const dir = ws.pkg('sample', {'package.json': '{}', 'model.schema': schema, 'actions.type': ''});
    const file = path.join(dir, 'actions.type');
    const source = '###\n@register test value\n###\nvalue = (Cliente) -> Cliente[7]\n';
    const mod = loadType(file, compileType(source, file).js);
    expect(mod.value({7: 'local'})).toBe('local');
    delete require.cache[file];
    const assigned = 'Cliente = {7: "assigned"}\n' + source.replace('(Cliente)', '()');
    expect(loadType(file, compileType(assigned, file).js).value()).toBe('assigned');
  });
  it('keeps model names local across two simultaneous runtimes', async () => {
    const first = await fixture();
    const second = await fixture('{codigo: id, nome: "Segundo", email: null}', false, false);
    expect(first.resource.handler(7).nome).toBe('abc/deep/clientes');
    expect(second.resource.handler(7).nome).toBe('Segundo');
    expect(first.resource.handler(7).nome).toBe('abc/deep/clientes');
  });
  it('checks authority again for captured entities and records', async () => {
    const {runtime, dir} = await fixture();
    const captured = modelBinding(dir, 'Cliente');
    const record = runAsPackage(runtime.container.authority, 'abc/deep/clientes', () => captured[7]);
    expect(() => captured[7]).toThrow(/AUTHORITY_REQUIRED/);
    expect(() => record.nome).toThrow(/AUTHORITY_REQUIRED/);
    const other = path.join(runtime.workspace, 'other'); fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({name:'other',runtime:{contractVersion:1,mode:'strict',provides:{services:{},tools:[],events:[]},requires:{services:{}},permissions:{tools:{invoke:[],exposeToAgents:[],administer:[]},events:{publish:[],subscribe:[],transform:[],veto:[],request:[]},data:{database:[],files:[],secrets:[]},network:[],process:{spawn:[]},ui:[]}}}));
    expect(() => runAsPackage(runtime.container.authority, 'other', () => record.nome)).toThrow();
  });
  it('rejects missing tags, invalid enum tags and unknown model references before delivery', async () => {
    for (const replacement of ['', '@method BUSCAR', '@method GET\n@returns {Unknown}']) {
      const {runtime, dir} = await fixture();
      const file = path.join(dir, 'index.type');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('@method GET', replacement));
      const result = await stagePackage(runtime.container, 'abc/deep/clientes');
      expect(result.ok).toBe(false);
      expect(runtime.container.state('entrypoint:workspace:providers/lookup').get('buscar').handler(7)).toMatchObject({codigo:7});
    }
  });
  it('supports model index lookup in an isolated process', async () => {
    const {resource} = await fixture(undefined, true);
    expect(await resource.handler(7)).toEqual({codigo: 7, nome: 'abc/deep/clientes', email: null});
  });
  it('connects transparent lookup to the actual external Scriba provider', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('customers', {'package.json': '{"name":"customers"}', 'models.schema': schema,
      'index.type': '###\n@register lookup customer\n@param {Int} id\n@returns {Cliente?}\n###\ncustomer = (id) -> Cliente[id]\n'});
    let handler: any;
    const runtime = await bootstrap({workspace: ws.root, externalModules: ['db'], modules: [{name:'lookup',phase:'wire',resources:{lookup(resource: any) {handler=resource.handler;}},install(){}}]});
    cleanup.push(() => runtime.close());
    const api: any = runtime.container.modules.get('db')!.api;
    const instance = api.getScriba();
    expect(instance).toBeTruthy();
    cleanup.push(() => { for (const tenant of Object.values(instance._tenants) as any[]) tenant.db.close(); });
    await runAsPackage(runtime.container.authority, 'customers', () => api.getProxy('customers').Cliente.push({codigo:7,nome:'Ana',email:null}));
    expect(await handler(7)).toEqual({codigo:7,nome:'Ana',email:null});
    expect(handler(8)).toBeUndefined();
  });
  it('queries the schema primary key with real SQLite, including update and delete', async () => {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:'); cleanup.push(() => db.close());
    db.exec('CREATE TABLE Cliente (codigo INTEGER PRIMARY KEY, nome TEXT); INSERT INTO Cliente VALUES (7, \'Ana\')');
    const fields = [{name:'codigo',type:'Int',isId:true},{name:'nome',type:'String'}];
    const table: any = new TableProxy(db, 'Cliente', fields, {tenant: () => ({entity: () => ({})})}, 'sample');
    expect(table[7].codigo).toBe(7);
    expect(table.findById(7).nome).toBe('Ana');
    expect(await table._updateDB(table[7], {nome:'Ana Maria'})).toBe(true);
    expect(db.prepare('SELECT nome FROM Cliente WHERE codigo=7').get().nome).toBe('Ana Maria');
    const created = await table.push({nome: 'Bruno'});
    expect(created.codigo).toBe(8);
    expect(table[8].nome).toBe('Bruno');
    expect(table.all().map((r: any) => r.codigo)).toEqual([7,8]);
    expect(await table.delete(8)).toBe(true);
    expect(table[8]).toBeUndefined();
  });
});
