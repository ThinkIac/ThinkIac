# Acesso tipado por chave no Scriba

Implementação para [ThinkIac #51](https://github.com/ThinkIac/ThinkIac/issues/51).

## Sintaxe e tipos

Em código LogosType, `User[ID]` representa uma leitura assíncrona de um modelo
resolvido pelo catálogo de schemas do pacote. O código aguarda o resultado com
`await User[ID]`. A resolução do modelo precisa ser inequívoca. Um identificador
local com o mesmo nome conserva a semântica de acesso do CoffeeScript.

A chave vem da declaração primária do modelo. Para `@id`, o argumento é um
escalar do tipo do campo, como uma string para `slug String @id`. Para
`@@id([workspaceId, code])`, o argumento é um objeto com exatamente os campos
`workspaceId` e `code`, na ordem que o chamador preferir. Chaves nulas, campos
ausentes ou extras e valores de tipo incompatível produzem
`SCRIBA_INVALID_KEY`. A leitura não faz coerção implícita entre número e string.
Modelos sem chave primária ficam fora dessa sintaxe.

Após `await`, o tipo do resultado é `User | null`. O resultado é um registro
de dados com os campos permitidos pela política de leitura do host e sem
métodos de persistência. `null` indica que nenhuma linha visível corresponde
à chave, inclusive quando a linha está excluída logicamente. O compilador usa
os metadados do catálogo para validar a chave e descrever o resultado. Uma
referência de tipo como `User.ID` por si só não solicita leitura nem abre banco.

## Execução e autoridade

O compilador encaminha o identificador do modelo e a chave à capacidade de
leitura fornecida pelo host. Tenant e autoridade vêm do contexto autenticado
do host e ficam fora dos argumentos dessa capacidade. Ausência de contexto
explícito ou falta de permissão de leitura produz `SCRIBA_READ_DENIED`. O
principal de sistema usado como padrão por `currentAuthority()` sem um
controlador ativo não concede acesso.

Em arquivos `.type`, o host usa o catálogo do pacote para reconhecer o modelo.
O principal de pacote só pode usar essa leitura no próprio tenant e precisa de
uma concessão explícita de banco, como `runtime.permissions.data.database: ["self"]`.
A checagem registra o nome do modelo e usa a política de banco existente, que
concede acesso no nível do tenant. O host autoriza antes de inicializar ou
consultar o adaptador de dados. O adaptador usa uma conexão vinculada ao tenant.
Se o armazenamento for compartilhado, a consulta exige também o predicado de
tenant fornecido pelo host. Restrições de visibilidade de linhas entram na
mesma consulta. A chave é consultada por igualdade em todas as suas colunas,
com valores parametrizados e nomes de coluna vindos do schema. A busca nunca
tenta outro tenant após um resultado vazio.

## Compatibilidade e validação

O ThinkIac consome Scriba pelo módulo externo `db`. O proxy global legado
continua disponível para seus chamadores atuais e conserva a busca numérica
por `id`. A leitura tipada chama
`readByPrimaryKey` do Scriba para consultar a chave declarada e projetar os campos
escalares do schema. Campos de relação ficam fora do resultado. O carregador
local do Lógos é o ponto de integração desta entrega. A execução isolada por RPC
precisa expor a mesma capacidade para oferecer essa sintaxe.

| Caso | Resultado esperado |
| --- | --- |
| Modelo com `slug String @id` | Busca pelo slug e retorna o registro tipado. |
| Modelo com `@@id([workspaceId, code])` | Busca por ambos os campos, independentemente da ordem do objeto. |
| Chave composta incompleta ou com campo extra | `SCRIBA_INVALID_KEY`, sem consultar o adaptador. |
| Chave válida sem linha visível | `null`. |
| Principal sem permissão ou contexto sem tenant | `SCRIBA_READ_DENIED`, sem consultar o adaptador. |
| Mesma chave em dois tenants | Cada contexto recebe apenas o registro de seu tenant. |
| Chave existe apenas em outro tenant | `null`. |
| Compilação de uma assinatura que usa `User.ID` | Resolve o tipo sem inicializar a persistência. |
| Leitura numérica pelo proxy legado | Preserva o comportamento anterior. |
