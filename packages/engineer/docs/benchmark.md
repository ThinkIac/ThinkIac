# Benchmark por capacidades

Pacotes registram suítes em `packages/<pacote>/benchmark.json`.

```json
{
  "suites": [
    {
      "name": "Tool schema adherence",
      "requires": {
        "tools": true,
        "structuredOutput": true
      },
      "measures": [
        { "capability": "tools.schemaAdherence", "weight": 0.6 },
        { "capability": "tools.argumentAccuracy", "weight": 0.4 }
      ],
      "tests": []
    }
  ]
}
```

`requires` impede a execução em acessos incompatíveis. `measures` descreve as
capacidades atômicas que recebem evidência. O manifesto não escolhe modelo e não
deve conter categorias abstratas de uso.

Uma evidência persistida identifica `target` (`modelo@acesso`), `capability`,
`score`, `confidence`, `samples`, `measuredAt` e `benchmarkVersion`.

Regras:

- O manifesto é a fonte de verdade da suíte.
- Evidência mede qualidade; não prova suporte técnico sozinha.
- Runs incompletos não substituem o snapshot completo mais recente.
- Mudanças na semântica de uma medição exigem nova versão de benchmark.
- Testes de tool use devem declarar o catálogo realmente mostrado ao modelo.
