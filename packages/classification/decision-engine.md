# Decisor de classificação

O decisor é uma camada opcional do `classification`. Ele nunca cria ferramentas,
não altera `@reach`, não executa ações e não aprova operações governadas.

## Ativação do Jev

Configure um pool OpenRouter habilitado com uma chave já existente e inclua um
modelo Jev, por exemplo `typesafe/jev-1.13`, como `model` ou em `models[]` no
`aurora.config.json`. O pacote detecta o pool automaticamente e usa o endpoint
de decisões do OpenRouter. Chaves não são copiadas para arquivos do pacote.

```json
{
  "classification": {
    "decision": {
      "mode": "shadow",
      "reactive": {
        "enabled": true,
        "maxCallsPerTurn": 2,
        "minIterationGap": 2,
        "timeoutMs": 1500
      }
    }
  }
}
```

Modos:

- `shadow` é o padrão. Registra a recomendação, mas não altera o classificador.
- `assist` move a candidata recomendada para o início da lista enviada ao
  classificador atual. A lista final ainda é produzida e validada pelo fluxo
  existente.
- `off` desabilita Jev e o fallback por histórico.

Com `reactive.enabled`, falhas recuperáveis, novas instruções e mudanças do
catálogo podem reabrir a seleção antes da próxima chamada ao modelo. O orçamento
e o intervalo impedem consultas a cada iteração. Em erro ou timeout do Jev, o
classificador atual continua sendo o decisor e a última seleção elegível é o
fallback final.

## Aprendizado local

Em `data/decision-experiences.json`, o pacote guarda somente intenção limitada,
nomes das candidatas, recomendação, ferramentas finais e sucesso/erro observado.
Ele não persiste argumentos, resultados brutos, segredos ou permissões.

Quando Jev não está configurado ou falha, o histórico local exige pelo menos
duas unidades de evidência semelhante antes de recomendar uma candidata. Em
`assist`, essa recomendação é só ordenação, não automação. Esse arquivo é o
dataset operacional inicial para avaliar e treinar roteadores locais no futuro.
