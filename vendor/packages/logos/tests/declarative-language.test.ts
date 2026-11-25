import { afterEach, expect, it } from 'vitest';
import { bootstrap } from '../src/index';
import { makeWorkspace } from './helpers';
import { expressionValidator, modelCatalog } from '../src/kernel/model-catalog';
import { stagePackage } from '../src/stabilizer/staging';
import fs from 'node:fs';
import path from 'node:path';
const cleanup: (() => any)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const provider = (keyword = 'module') => `${keyword} example = (resource) ->
  @tag {ParamDeclaration[]} [params]
  @tag {TypeExpression} returns
  @tag {number} [interval=60000]
  key = resource.declaration.name
  state = require('./state.cjs')
  old = state[key]
  {
    prepare: ->
      state.prepared = resource
      throw new Error 'bad interval' if resource.metadata.interval < 0
    commit: -> state[key] = resource
    rollback: -> state[key] = old
    dispose: ->
      delete state[key] if state[key] is resource
  }
`;
it.each(['module', 'type'])('boots %s provider with typed normalized resources and inherited field docs', async keyword => {
 const ws = makeWorkspace(); cleanup.push(ws.cleanup);
 const dir = ws.pkg('sample', {'package.json':'{"name":"sample"}', 'state.cjs':'module.exports = {};',
 'index.type':provider(keyword) + `\nexample getUser = (ID: User.ID): User ->\n  { ID, name: 'Ana' }\n\nexample override = (name: User.name): string ->\n  @param name - Nome nesta operação\n  name\n`,
 'model.schema':`model User {\n # Identificador do Usuário\n ID Int @id # Chave de consulta\n name String # Nome do Usuário\n}\n`});
 const runtime = await bootstrap({workspace:ws.root,externalModules:[]}); cleanup.push(()=>runtime.close());
 const state = require(path.join(dir,'state.cjs'));
 expect(runtime.container.registry.getState('sample')).toMatchObject({state:'active'});
 expect(state.getUser.params[0]).toMatchObject({type:'Int', description:'Identificador do Usuário\nChave de consulta'});
 expect(state.getUser.returns).toBe('User');
 expect(await state.getUser.handler(7)).toEqual({ID:7,name:'Ana'});
 expect(()=>state.getUser.handler('bad')).toThrow(/Int/);
 expect(state.override.params[0].description).toBe('Nome nesta operação');
 expect(await state.override.handler('Bia')).toBe('Bia');
 fs.writeFileSync(path.join(dir,'index.type'),provider(keyword) + '\nexample getUser = (ID: User.ID): User ->\n  @interval -1\n  {ID, name: "Bia"}\n');
 expect((await stagePackage(runtime.container,'sample')).ok).toBe(false);
 expect(await state.getUser.handler(7)).toEqual({ID:7,name:'Ana'});
 await runtime.close();
 expect(state.getUser).toBeUndefined();
});
it('resolves list/optional fields and rejects unknown references without persistence', () => {
 const ws=makeWorkspace(); cleanup.push(ws.cleanup);
 const dir=ws.pkg('schema',{'models.scriba':'model User {\n tags String[]\n nickname String?\n url String @default("example/#x") # endereço\n}\n'});
 const catalog=modelCatalog(dir);
 expect(catalog.models.User.fields).toHaveLength(3);
 expect(catalog.models.User.fields[2].default).toContain('example/#x');
 expect(expressionValidator('User.tags',catalog,'test')(['a'])).toEqual(['a']);
 expect(expressionValidator('User.nickname',catalog,'test')(null)).toBeNull();
 expect(()=>expressionValidator('User.missing',catalog,'test')).toThrow(/unknown field/);
});
it('enforces provider metadata before publication', async () => {
 const ws=makeWorkspace(); cleanup.push(ws.cleanup);
 ws.pkg('provider', {'package.json':'{"name":"provider"}', 'index.type': `module sample = (resource) ->
  @tag {number} interval
  {
    prepare: ->
    commit: ->
    rollback: ->
    dispose: ->
  }
`});
 ws.pkg('consumer', {'package.json':'{"name":"consumer"}', 'index.type':'sample x = (): number -> 42\n'});
 const runtime=await bootstrap({workspace:ws.root,externalModules:[]}); cleanup.push(()=>runtime.close());
 expect(runtime.container.registry.getState('consumer')).toMatchObject({state:'denied_contract',error:expect.stringContaining('@interval')});
});
it('executes the new syntax across isolated RPC with schema field validation', async () => {
 const ws=makeWorkspace(); cleanup.push(ws.cleanup);
 const dir=ws.pkg('a-provider', {'package.json':'{"name":"provider"}', 'index.type':provider(),'state.cjs':'module.exports = {};'});
 ws.pkg('consumer', {'package.json':'{"name":"consumer","isolated":true}',
 'index.type':'example value = (ID: User.ID): User ->\n  {ID, name: "Ana"}\n',
 'model.schema':'model User {\n ID Int @id\n name String\n}\n'});
 const runtime=await bootstrap({workspace:ws.root,externalModules:['isolated-runtime']}); cleanup.push(()=>runtime.close());
 expect(runtime.container.registry.getState('consumer')).toMatchObject({state:'active'});
 const state=require(path.join(dir,'state.cjs'));
 expect(await state.value.handler(7)).toEqual({ID:7,name:'Ana'});
 expect(()=>state.value.handler('bad')).toThrow(/Int/);
});
it('rejects duplicate provider aliases across files', async () => {
 const ws=makeWorkspace(); cleanup.push(ws.cleanup);
 ws.pkg('sample', {'package.json':'{}', 'one.type':provider('module'),'two.type':provider('type'),'state.cjs':'module.exports = {};'});
 await expect(bootstrap({workspace:ws.root,externalModules:[]})).rejects.toThrow(/duplicate module/);
});
it('publishes typed signatures and inherited descriptions through the existing tools scanner', async () => {
 const { registerTools, registerCommands } = await import('../src/kernel/scan');
 const ws=makeWorkspace(); cleanup.push(ws.cleanup);
 const dir=ws.pkg('sample', {'package.json':'{}', 'model.schema':'model User {\n ID Int @id # Identificador do Usuário\n name String\n}\n',
 'index.type':'tool getUser = (ID: User.ID): User? ->\n  @description "Busca um usuário"\n  null\n'});
 const tools=await registerTools(dir);
 expect(tools).toHaveLength(1);
 expect(await registerCommands(dir)).toHaveLength(0);
 expect(tools[0]).toMatchObject({name:'getUser',description:'Busca um usuário',parameters:{properties:{ID:{type:'integer',description:'Identificador do Usuário'}},required:['ID']}});
 expect(await tools[0].call(7)).toBeNull();
 expect(()=>tools[0].call('bad')).toThrow(/Int/);
});
it('keeps tool signatures and schema documentation in isolated descriptors', async () => {
 const ws=makeWorkspace(); cleanup.push(ws.cleanup);
 ws.pkg('consumer', {'package.json':'{"name":"consumer","isolated":true}',
 'index.type':'tool value = (ID: User.ID): User? ->\n  @description "Busca usuário"\n  null\n',
 'model.schema':'model User {\n ID Int @id # Identificador do Usuário\n name String\n}\n'});
 const runtime=await bootstrap({workspace:ws.root,externalModules:['isolated-runtime'],modules:[{name:'tools-test',phase:'wire',install(){},resources:{tool(){}}}]}); cleanup.push(()=>runtime.close());
 const runner=runtime.container.state('isolated').get('consumer');
 expect(runner.surfaces.tools[0]).toMatchObject({name:'value',parameters:{properties:{ID:{type:'integer',description:'Identificador do Usuário'}}}});
});
