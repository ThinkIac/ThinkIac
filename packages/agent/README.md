# Agent

O pacote `agent` executa o ciclo de conversa: prepara contexto, recebe o
catálogo de tools, chama o modelo e aplica a política antes de cada execução.
A classificação reduz o catálogo, mas não substitui a decisão do modelo nem as
verificações de permissão.

## Tools no ciclo do Agent

1. O Lógos descobre tools declaradas com `@register_tool`.
2. O pacote `classification` seleciona candidatas e aplica `@reach`.
3. O Agent combina candidatas, tools exigidas e tools `always`.
4. A política de execução valida cada chamada no catálogo permitido no turno.

`auto` é classificável, `always` permanece visível em todos os turnos e
`manual` não entra no catálogo automático. Esses valores controlam descoberta,
não autorização. Consulte [Engineer: tools](../engineer/docs/tools.md) e
[Classification](../classification/README.md).

## Execução paralela

`run_parallel` é uma capacidade arquitetural com `reach: always`. Agrupa duas
ou mais chamadas independentes em `tools: [{ name, input }]`. Use para leituras
e consultas que não dependem entre si. Não a aninhe e não a use para sequência
que precisa do resultado anterior.

Cada resultado é independente, inclusive em falhas parciais. O Agent valida as
chamadas internas com a mesma lista de tools permitidas no turno: a tool não
aumenta privilégios nem ignora governança.

## Referências

- [Prompt de capacidades do Runtime](prompts/capabilities/runtime.inflect)
- [Tools internas](core/builtin_tools.js)
- [Política de execução](core/execution_policy.js)
- [Contrato de decorators](../../docs/decorators.md#tools)
