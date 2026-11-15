# Classification

O pacote `classification` reduz o catálogo de tools por turno e encaminha
intenções declarativas. Ele não executa tools, não aprova ações e não amplia
permissões.

## Responsabilidades

- Descobrir tools e aplicar `@reach` antes de compor o catálogo do Agent.
- Ranquear candidatas de acordo com exemplos e nível de aproximação.
- Aceitar exemplos declarativos em `package.json` para `response`, `model`,
  `runtime` ou `tool`.
- Registrar decisões para auditoria, calibração e benchmark.

O ponto de integração por turno é `hook.js`. A decisão final do modelo e a
política de execução continuam no pacote `agent`.

## Relação com tools

| `@reach` | Tratamento |
| --- | --- |
| `auto` | Candidata ao ranking. É o padrão. |
| `always` | Incluída no resultado final em cada turno. |
| `manual` | Excluída do catálogo automático; requer invocação explícita autorizada. |

`always-include-tools.json` mantém compatibilidade com tools essenciais.
Prefira declarar `@reach always` junto da tool quando esse requisito pertencer à
própria capacidade. Uma sugestão só é válida se a tool ainda estiver elegível no
catálogo do turno.

`run_parallel` é uma tool transversal com `reach: always`: ela serve somente
para chamadas independentes e continua sujeita à política de execução.

## Exemplos declarativos

Pacotes podem contribuir exemplos no manifesto:

```json
{
  "classification": {
    "examples": [{
      "id": "workspace-shell",
      "utterances": ["execute os testes", "rode o lint"],
      "target": { "type": "tool", "value": "run_shell" },
      "threshold": 0.72
    }]
  }
}
```

`id` é estável no pacote; `utterances` contém de 1 a 64 exemplos sem segredos;
`threshold` vai de 0 a 1. Para `target.type: tool`, `target.value` é o nome da
tool. `runtime` não exige `value`. O contrato de eventos, cache e reconciliação
está em [PROTOCOL.md](PROTOCOL.md); o guia de autoria está em
[Engineer: classification](../engineer/docs/classification.md).

## Configuração e validação

- `approximation-config.json`: níveis `compact`, `detailed` e `full`.
- `benchmark.json`: cenários de avaliação.
- `protocol.test.js` e `semantic-router.test.mjs`: contratos de roteamento.

Para sintaxe de tool, consulte [Engineer: tools](../engineer/docs/tools.md) e o
[contrato de decorators](../../docs/decorators.md#tools).
