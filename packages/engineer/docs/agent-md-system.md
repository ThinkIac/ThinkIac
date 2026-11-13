# Sistema de AGENT.md

Cada pacote pode declarar um `AGENT.md`. A Aurora descobre esses arquivos, fixa os
marcados com `always: true` e classifica os demais por relevância para a mensagem
do usuário. O `AGENT.md` de `packages/aurora` é a personalidade base e não passa
por esse roteador.

## Front matter

```md
---
name: Agenda
description: Especialista em agenda, recorrência e lembretes.
language: pt-BR
always: false
event: agenda:agent-context
---

Hoje existem {{ events.length }} eventos.

{#each events as event, i}
{{ i + 1 }}. {{ event.title }}
{/each}
```

| Campo | Obrigatório | Contrato |
|---|---:|---|
| `name` | não | Nome exibido e usado pelo roteador; por padrão, nome do pacote. |
| `description` | recomendado | Descreve quando ativar o agente. Se ausente, usa o primeiro heading. |
| `language` | não | Metadado de idioma. |
| `always` | não | `true` fixa o agente em todo prompt. O typo legado `alway` ainda é aceito, mas não deve ser usado em arquivos novos. |
| `event` | não | Evento do Runtime que fornece o contexto do Inflect após a ativação. |

## Evento de contexto dinâmico

O evento só é disparado quando o agente está ativo, seja por `always` ou pelo
roteamento. Ele recebe um único objeto:

```js
export async function provideAgentContext(payload) {
  /**
   * @register_hook agenda:agent-context
   */
  const { sessionId, message, agent } = payload
  return {
    events: await loadEventsForSession(sessionId),
    request: message,
    agent,
  }
}
```

O payload recebido contém `{ sessionId, message, agent }`. O retorno final da
cadeia de hooks deve ser um objeto não nulo e não pode ser um array. Esse objeto
vira o contexto do template. Como o retorno de um hook é o payload do próximo,
todo hook da cadeia deve preservar ou devolver os campos necessários.

A decisão de roteamento pode ser cacheada, mas o evento e o template são
executados novamente a cada composição do prompt. Se o evento ou a renderização
falhar, somente esse `AGENT.md` é omitido e a Aurora registra um aviso; os demais
agentes continuam normalmente.

## Sintaxe Inflect

```md
Olá {{ user.name }}.

{#if items.length > 0}
{#each items as item, i}
- {{ i + 1 }}. {{ item.title }}
{/each}
{:else if loading}
Carregando.
{:else}
Nenhum item.
{/if}

{#switch language}
{#case 'pt'}Português{/case}
{#case 'en'}English{/case}
{:default}Idioma desconhecido
{/switch}

{#include ./partials/rules}
```

O Inflect suporta expressões `{{ ... }}`, `each`, `if`/`else if`/`else`,
`switch`/`case`/`default` e includes. Includes sem extensão tentam `.md` e
`.mdjs`, são relativos ao diretório do `AGENT.md` e não podem sair do diretório
do pacote. Include inexistente, circular ou fora desse limite é erro de
renderização. Uma interpolação cujo valor não existe permanece intacta para
facilitar diagnóstico.

## Checklist para novos agentes

1. Use `always: true` somente para instruções realmente universais.
2. Escreva uma `description` específica o bastante para o roteador decidir.
3. Use `event` apenas quando o Markdown precisar de dados atuais.
4. Faça o hook receber e retornar um único objeto.
5. Não coloque segredos no retorno: o conteúdo renderizado entra no system prompt.
6. Teste sucesso, retorno inválido e ausência de dados antes de ativar o agente.

Implementação de referência: `packages/aurora/core/skills.js`. Motor de template:
`inflect (monorepo pai)`.
