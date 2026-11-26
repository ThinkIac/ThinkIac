# Acesso tipado por chave no Scriba

Proposta para [ThinkIac #51](https://github.com/ThinkIac/ThinkIac/issues/51).

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

O host verifica autorização para o modelo e o tenant antes de instanciar ou
consultar o adaptador de dados. O adaptador usa uma conexão vinculada ao tenant.
Se o armazenamento for compartilhado, a consulta exige também o predicado de
tenant fornecido pelo host. Restrições de visibilidade de linhas entram na
mesma consulta. A chave é consultada por igualdade em todas as suas colunas,
com valores parametrizados e nomes de coluna vindos do schema. A busca nunca
tenta outro tenant após um resultado vazio.

## Compatibilidade e validação

A main do ThinkIac consome Scriba por um módulo externo. O proxy global legado
continua disponível para seus chamadores atuais e conserva a busca numérica
por `id`. O novo caminho precisa de uma capacidade explícita no host e de uma
operação de leitura por chave primária no módulo Scriba. O novo caminho não
deve passar por `RecordProxy`, cuja API atual permite mutações.

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
