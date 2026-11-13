# Decorators do ThinkIac

Os decorators são declarações JSDoc usadas pelos módulos do ThinkIac para
expor rotas, tools, hooks, comandos e middleware. Eles não são capacidades do
Lógos: cada significado vem de um módulo externo, como HTTP, tools ou hooks.

O Lógos ainda faz a leitura genérica e oferece scanners específicos por
compatibilidade. Portanto, remover o módulo correspondente remove também a
capacidade: uma declaração de rota não cria HTTP sozinha.

## Estado da migração

O protocolo neutro é `@register <tipo> <nome>`. O Lógos o transporta como um
evento `register:<tipo>` sem interpretar o tipo. Os módulos do ThinkIac ainda
não consomem todos os tipos por esse caminho.

Use as formas indicadas como **ativas** nesta página. Não troque
`@register_tool` por `@register tool`, por exemplo: a declaração genérica seria
emitida, mas o módulo de tools atual ainda usa o scanner compatível.

| Capacidade | Módulo que dá significado | Forma ativa |
| --- | --- | --- |
| rota HTTP | `@thinkiac/module-http` | `@register_router` ou `@register router` |
| hook de evento | `@thinkiac/module-hooks` | `@register_hook` ou `@register hook` |
| tool | `@thinkiac/module-tools` | `@register_tool` |
| comando | `@thinkiac/module-commands` | `@register_command` |
| predicate e middleware | política do host | `@register_predicate`, `@register_middleware` |
| módulo de workspace legado | lifecycle compatível | `@register_module` |

## Posição do bloco

O bloco pode ficar acima da declaração ou dentro da função. Prefira acima da
declaração em código novo.

```js
/**
 * @register_tool sum
 * @description Soma dois números.
 * @param {number} a - Primeiro número
 * @param {number} b - Segundo número
 */
export function sum({ a, b }) {
  return a + b;
}
```

O estilo dentro da função continua válido:

```js
export function sum({ a, b }) {
  /** @register_tool sum */
  return a + b;
}
```

Se houver blocos nas duas posições, o bloco interno vence. Use funções
exportadas com nome. Um bloco acima da declaração é associado ao identificador
da função; uma arrow anônima atribuída diretamente a `exports.x` pode não ser
associada.

## Rotas HTTP

```js
/**
 * @register_router tasks/:id
 * @method get
 */
export function getTask(req) {
  return { data: { id: req.params.id } };
}
```

A rota legada acima é montada em `/<pacote>/tasks/:id`. A forma nova também é
aceita:

```js
/**
 * @register router tasks/:id
 * @method get
 */
```

Tags suportadas pelo módulo ativo:

| Tag | Efeito |
| --- | --- |
| `@method <verbo>` | método HTTP; o padrão é `get` |
| `@public [true\|false]` | libera ou mantém a sessão de navegador exigida pelo host |
| `@requireCredential` | exige a credencial de máquina configurada |
| `@auth` | alias legado de `@requireCredential` |
| `@upload <campo> [quantidade] [tamanho] [memory\|disk]` | multipart com limites explícitos |
| `@streaming` | o handler escreve a resposta diretamente |
| `@stream`, `@channel`, `@direction` | superfície WebSocket compatível |
| `@offline cache\|online` | política de cache; `cache` só é válido em GET |
| `@only`, `@when`, `@never` | condições avaliadas no contexto |

Em rotas não streaming, retorne `{ data }`, `{ status, headers, body }` ou um
objeto que possa ser serializado como JSON.

Na forma legada, um caminho iniciado por `/` é montado na raiz. Use isso apenas
para protocolos com caminho fixo, pois dois pacotes podem disputar o mesmo
endereço. A forma `@register router` remove a barra inicial e mantém o prefixo
do pacote.

## Tools

```js
/**
 * @register_tool createTask
 * @description Cria uma tarefa.
 * @param {string} title - Título
 * @param {('low'|'high')?} priority - Prioridade
 * @reach auto
 */
export function createTask({ title, priority = 'low' }) {
  return { id: crypto.randomUUID(), title, priority };
}
```

O módulo transforma `@param` em JSON Schema. `?` no tipo torna o campo
opcional; `string[]` representa uma lista; nomes como `user.email` descrevem
campos aninhados.

Valores fechados podem ser declarados por união literal ou no fim da linha:

```js
/**
 * @param {string} status - Estado @enum draft,published
 * @param {string?} channel - Canal @enumSource tool:ntfy/listChannels#name
 */
```

`@enumSource` é metadado dinâmico. O consumidor decide como resolver a fonte e
deve cair para texto livre quando ela estiver indisponível.

`@reach auto|always|manual` controla a participação na seleção de tools do
agente. O padrão é `auto`. `manual` não torna a operação segura por si só; a
governança continua responsável por ações consequenciais.

As tags opcionais `@recovery none|read-only|idempotent|reconcile` e
`@reconcile <tool>` descrevem política de recuperação para consumidores que a
suportam.

## Hooks

```js
/**
 * @register_hook tasks:created
 * @priority 50
 */
export function onTaskCreated(payload, context) {
  console.log(payload.id, context.matchedEvent);
}
```

`@register hook tasks:created` também funciona. `@priority` menor executa
antes; o padrão é 100. `@only`, `@when` e `@never` aplicam as mesmas condições
de disponibilidade.

Um retorno não nulo substitui o payload entregue ao próximo hook. Hooks que
apenas observam normalmente não devem retornar valor. Wildcards como
`tasks:*` são aceitos pelo barramento.

## Comandos

```js
/**
 * @register_command seed
 * @description Cria dados locais de desenvolvimento.
 * @param {number?} count - Quantidade
 */
export async function seed({ count = 10 }) {}
```

Comandos usam as mesmas tags de parâmetros e condições das tools. O modo
padrão é `@cli_runtime minimal`; use `@cli_runtime full` somente em código
legado que realmente dependa do host todo inicializado.

## Predicates e middleware

```js
/** @register_predicate isAdmin */
export function isAdmin(context) {
  return context.req?.headers['x-role'] === 'admin';
}

/**
 * @register_middleware requireAdmin
 * @predicate isAdmin
 */
export async function requireAdmin(context, next) {
  return next();
}
```

O middleware envolve handlers do mesmo pacote. Mantenha a regra de negócio em
funções JavaScript comuns e use decorators apenas nas interfaces. Assim rota,
tool e hook podem chamar o mesmo handler sem acoplarem suas implementações.

## Módulos de workspace

`@register_module` é uma superfície de compatibilidade para pacotes com
`"runtime": { "role": "module" }`. Suporta `@phase boot|wire`, `@after`,
`@swappable false`, `@runtime` e `@events`.

Novas capacidades fundamentais devem preferir um pacote externo que exporta
`createRuntimeModule(host)`, conforme o protocolo do Lógos. Não importe
internals do Lógos nem dependa de um caminho dentro da distribuição.

## Declarações genéricas

Um módulo novo pode definir seu próprio tipo sem alterar o parser do Lógos:

```js
/**
 * @register report daily-sales
 * @format csv
 */
export function dailySales(input) {
  return input;
}
```

O Lógos entrega `{ type, name, tags, legacy }` e o callable separadamente em
`register:report`. O módulo `report` valida as tags e decide como registrar,
executar e desmontar o handler. Esse é o destino dos decorators atuais depois
que cada módulo abandonar seu scanner específico.
