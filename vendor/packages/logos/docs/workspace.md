# Pacotes, módulos e tipos no mesmo workspace

Um workspace é uma árvore de pacotes. Todo diretório com `package.json` participa
da mesma descoberta, inclusive quando está dentro de outro pacote. Pastas como
`modules`, `abc` e `b` servem apenas para organização. Não é necessário declarar
`runtime.role` nem importar uma API do Lógos para registrar um módulo ou tipo.

```text
packages/
  modules/arithmetic/package.json
  modules/arithmetic/index.cjs
  abc/b/customer/package.json
  abc/b/customer/index.mjs
```

O nome do manifest identifica o pacote na resolução de dependências. Nomes
repetidos falham com os dois caminhos. O caminho relativo continua sendo o
locator operacional usado por recarga, contratos e diagnósticos, preservando as
APIs existentes. Mover um pacote exige um novo boot; não exige mudar seu código.
Se outros pacotes usam locators explícitos em vez do nome do manifest, atualize
essas referências ao mover a pasta.

A busca continua abaixo de um manifest, mas o scanner de declarações do pacote
pai não entra nos filhos que possuem manifest próprio. Cada arquivo pertence ao
seu pacote mais próximo. Links simbólicos não são percorridos. Diretórios ocultos,
`node_modules`, `dist` e diretórios de estado presentes em `IGNORE_DIRS` são
ignorados. As declarações podem estar em `.js`, `.cjs` ou `.mjs`; arquivos e
pastas de testes não são executados pelo scanner. CJS e ESM são suportados.

## Um provedor e consumidor no mesmo pacote

```js
// packages/modules/arithmetic/index.cjs
exports.lifecycle = function lifecycle(context) {
  /** @register module arithmetic */
  return {
    version: '1.0.0',
    phase: 'wire',
    install() { context.log('arithmetic pronto'); },
    close() { context.state.clear(); },
  };
};

exports.accept = function accept(resource, context) {
  /**
   * @register type arithmetic
   * @requires arithmetic
   */
  context.state.set(resource.declaration.name, resource.handler);
};

exports.increment = function increment(value) {
  /** @register arithmetic increment */
  return value + 1;
};
```

```js
// packages/abc/b/customer/index.mjs
export function double(value) {
  /** @register arithmetic double */
  return value * 2;
}
```

Os manifests precisam de nomes diferentes, por exemplo `arithmetic` e `customer`.
Para usar apenas os pacotes do workspace:

```js
const runtime = await require('logos').bootstrap({
  workspace: '/packages',
  externalModules: [],
});
// ...
await runtime.close();
```

`externalModules: []` desativa a descoberta externa de compatibilidade, não a
coleta de declarações no workspace. Omitir a opção preserva a distribuição
adjacente existente. Um pacote pode fornecer módulos, tipos e recursos ao mesmo
tempo. Provedores são coletados de todos os pacotes antes da instalação e da
entrega de recursos; a ordem dos diretórios não precisa colocar o provedor antes
do consumidor.

## Contratos declarativos

`@register module nome` anota uma função comum que recebe contexto e retorna um
descritor. O nome no comentário é obrigatório; se o descritor também informar
`name`, os dois devem coincidir. `phase` tem padrão `wire`; `install` tem padrão
vazio. O descritor pode declarar `requires`, `after`, `resources`, `capabilities`,
`prepare`, `start` e `close`. A função de declaração deve apenas construir o
descritor; adquira recursos em `install`, `prepare` ou `start`.

O contexto declarativo contém `version`, `identity`, `workspace`, `config`,
`state`, `log`, `on` e `emit`. Não exige `context.register` ou qualquer import do
Lógos. O estado é próprio da composição e compartilhado entre declarações do
mesmo pacote. `config` usa `moduleConfig['workspace:<caminho relativo>']` para
pacotes locais; o caminho permanece visível na identidade de diagnóstico.

`@register type nome` anota diretamente o consumidor `(resource, context)`.
Ele recebe a declaração normalizada, o arquivo, o locator do pacote consumidor e
um `handler` mediado pela autoridade desse pacote. `@requires modulo` pode ser
repetido para exigir provedores. Tipos são instalados internamente como
`type.<nome>`, reservado para essa declaração. Nomes de módulos ou tipos em
conflito falham antes da instalação. Tipos ausentes produzem erro com pacote e
arquivo e impedem a ativação do consumidor.

O consumidor simples não recebe rollback automático. Use `@transactional` para
recursos que precisam de recarga e remoção segura.

## Consumidor transacional

```js
exports.accept = function accept(next, context, snapshot) {
  /**
   * @register type arithmetic
   * @transactional
   */
  const key = `resources:${snapshot.package}`;
  const previous = context.state.get(key);
  return {
    commit() { context.state.set(key, next); },
    rollback() { context.state.set(key, previous); },
    dispose() {
      if (context.state.get(key) === next) context.state.delete(key);
    },
  };
};
```

O primeiro argumento é o snapshot completo do tipo para um pacote; pode estar
vazio. O terceiro argumento contém `{ package, version: 1 }`. Mantenha gerações
separadas por pacote. A preparação não altera o estado publicado. `rollback`
compensa falhas de publicação; `dispose` libera gerações retiradas sem apagar uma
publicação mais recente. Consulte [modules.md](modules.md) para as garantias e
limites das transações entre consumidores.

## Compatibilidade e composição

Os 18 entrypoints de capacidades da distribuição agora exportam funções
anotadas. `@context capability` seleciona suas portas fornecidas pelo adaptador
externo `runtime-compat`; isso preserva a implementação das capacidades sem
introduzir import de API de registro do Lógos. `@accepts` informa os tipos que
um adaptador legado processa por seu ciclo de wiring. Novos provedores devem
preferir `@register type` e o contexto genérico.

Exports antigos `createRuntimeModule` permanecem aliases de biblioteca onde já
eram públicos. O carregador prioriza as declarações e não depende desses aliases.
`register(context)`, módulos programáticos e `@register_module` permanecem apenas
como caminhos de compatibilidade. A grafia com underscore conserva o contrato
anterior de função instaladora; a grafia com espaço retorna um descritor.
Bibliotecas auxiliares, como `annotations` e `mediated-io`, continuam bibliotecas;
não precisam declarar um ciclo de vida artificial.

O catálogo continua selado após o boot. Recursos de tipos existentes têm recarga
transacional; adicionar, remover ou alterar a definição de um módulo ou tipo
exige recomposição por novo boot. Ativar um novo provedor após o selo é rejeitado,
em vez de ignorar sua declaração. O estabilizador observa pacotes em qualquer
profundidade; mudanças em filhos não são atribuídas ao pacote pai.

## Validação

```sh
npm run build
npx vitest run tests/unified-workspace.test.ts
npm test
npm run test:independent
```

A suíte dedicada cobre mudança de localização, provedor e consumidor no mesmo
pacote, CJS/ESM, filhos de pacotes, ciclos por symlink, nomes repetidos, tipos
ausentes ou repetidos, registro sem export especial e rollback de recursos.
