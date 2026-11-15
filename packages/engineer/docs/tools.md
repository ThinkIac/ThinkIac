# Tools

Este guia explica como declarar uma tool no ThinkIac. O contrato canônico dos
decorators está em [docs/decorators.md](../../../docs/decorators.md#tools); esta
página descreve seu uso operacional no workspace.

## Declaração mínima

Uma tool é uma função exportada com `@register_tool`, `@description` e os
`@param` correspondentes à entrada que ela aceita.

```js
/**
 * @register_tool greet
 * @description Cumprimenta uma pessoa no idioma escolhido.
 * @param {string} name - Nome da pessoa
 * @param {string?} language - Idioma; padrão pt
 * @reach auto
 */
export function greet({ name, language = 'pt' }) {
  const messages = { pt: `Olá, ${name}!`, en: `Hello, ${name}!` };
  return messages[language] ?? messages.pt;
}
```

O catálogo transforma os parâmetros em JSON Schema para o modelo, MCP e demais
consumidores. Descreva efeito, pré-requisitos e limites relevantes; não anuncie
parâmetros que a função não aceite.

## Campos

| Campo | Uso |
| --- | --- |
| `@register_tool nome` | Expõe a função sob o nome estável `nome`. |
| `@description texto` | Explica finalidade, pré-requisitos e limites. |
| `@param {tipo} nome - descrição` | Declara uma entrada. `tipo?` a torna opcional. |
| `nome[]` ou `tipo[]` | Declara uma lista. |
| `obj.campo` | Declara um campo aninhado. |
| `@enum a,b,c` | Ao fim de `@param`, declara valores fechados. |
| `@enumSource origem` | Ao fim de `@param`, indica opções dinâmicas. |
| `@reach auto\|always\|manual` | Controla a participação na seleção por turno. |
| `@recovery none\|read-only\|idempotent\|reconcile` | Descreve recuperação para consumidores compatíveis. |
| `@reconcile nome-da-tool` | Indica a tool usada para reconciliar uma operação. |

Exemplo com objeto, lista e valores fechados:

```js
/**
 * @register_tool createUser
 * @description Cria um usuário no diretório atual.
 * @param {string} user.name - Nome completo
 * @param {string} user.email - E-mail
 * @param {string?} user.role - Perfil @enum viewer,editor,admin
 * @param {string[]} tags - Etiquetas iniciais
 */
export function createUser({ user, tags }) {
  return { id: crypto.randomUUID(), ...user, tags };
}
```

`@enumSource` é metadado dinâmico: se a fonte não estiver disponível, o
consumidor deve aceitar texto livre. A gramática completa está no
[contrato canônico](../../../docs/decorators.md#tools).

## Alcance e classificação

`@reach` controla descoberta, não autorização:

| Valor | Efeito |
| --- | --- |
| `auto` | Padrão. Candidata à classificação e presente quando selecionada. |
| `always` | Entra no catálogo de todos os turnos. Reserve para capacidades transversais. |
| `manual` | Fica fora do catálogo automático e exige mecanismo explícito autorizado. |

Permissões, política de execução e validação de parâmetros continuam valendo.
A classificação não executa tools nem concede acesso. Veja [Classification](../../classification/README.md)
e [Agent](../../agent/README.md).

## `run_parallel`

`run_parallel` é uma tool interna de coordenação com `reach: always`. Recebe uma
lista `tools` de objetos `{ name, input }` e executa as chamadas em paralelo.
Use apenas para duas ou mais operações independentes, como leituras de arquivos
ou consultas de estado. Não a aninhe e não a use quando a entrada seguinte
depende de um resultado anterior.

```json
{
  "tools": [
    { "name": "read_file", "input": { "path": "README.md" } },
    { "name": "list_runtime_routes", "input": {} }
  ]
}
```

O resultado é individual por chamada, portanto falhas parciais devem ser
tratadas individualmente. As chamadas internas continuam submetidas ao catálogo
autorizado no turno: `run_parallel` não contorna classificação ou governança.

Para rota, tool e evento no mesmo handler, consulte [routes.md](routes.md).
