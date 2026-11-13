# Exemplos declarativos de classificação

Um pacote pode enviesar o roteamento declarando `classification.examples` em
seu `package.json`. A declaração escolhe uma intenção; ela não executa uma tool,
não concede permissão e não torna uma tool instalada.

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

Campos:

- `id`: identificador estável e único dentro do pacote;
- `utterances`: de 1 a 64 exemplos concretos, sem segredos;
- `target.type`: `response`, `model`, `runtime` ou `tool`;
- `target.value`: nome da tool, perfil de modelo ou resposta; omitido somente
  para `runtime`;
- `threshold`: similaridade mínima entre 0 e 1.

Para `tool`, o Agent reconcilia a decisão em cada iteração com
`availableTools`, depois das restrições de perfil, modo e permissão. A sugestão
só entra na chamada do modelo quando o schema daquela mesma tool está presente.
Catálogo alterado invalida o vínculo anterior. Decisões registram `runId`,
`iteration`, `catalogVersion`, confiança e estado `eligible` ou `unavailable`.

O encoder preferencial do OTA é o `multilingual-e5-small` local. Ausência ou
falha do encoder deve produzir degradação explícita; o fallback lexical preserva
compatibilidade, mas não deve ser descrito como classificação semântica.

O contrato completo e os limites ficam em `packages/classification/PROTOCOL.md`.
