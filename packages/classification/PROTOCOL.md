# Protocolo de exemplos de classificação

Pacotes podem contribuir exemplos no próprio `package.json`. O classificador
descobre todos os pacotes instalados e monta protótipos locais, sem rede, chave
ou LLM gerador:

```json
{
  "name": "clock",
  "classification": {
    "examples": [{
      "id": "current-time",
      "utterances": ["que horas são", "me diga a hora agora"],
      "target": { "type": "tool", "value": "clockNow" },
      "threshold": 0.72
    }]
  }
}
```

Alvos aceitos:

- `response`: resposta determinística indicada em `value`;
- `model`: perfil de modelo local indicado em `value`;
- `runtime`: escala para o Agent Runtime; não exige `value`;
- `tool`: sugere a tool indicada em `value`.

O pacote consumidor publica `classification:route` com `{ "text": "..." }`.
O retorno acrescenta `decision` com `package`, `id`, `target` e `score`, ou
`null` quando nenhum exemplo atinge seu limiar. Uma decisão `tool` é somente
roteamento: ela não amplia autoridade e não executa a ferramenta sozinha.

O encoder semântico recomendado é `multilingual-e5-small`, ONNX local, com 384
dimensões. O OTA-base o distribui separadamente do MiniLM NLI: o encoder produz
vetores reutilizáveis, enquanto o NLI decide somente `local/runtime/clarify`.

`embedText` permanece como fallback lexical determinístico de 384 dimensões
para hosts sem o encoder. Esse fallback usa palavras e n-grams e, portanto, não
deve ser reportado como embedding MiniLM. O construtor `ExampleRouter` recebe o
adaptador `embed`, mantendo o manifesto dos pacotes independente do executor.

Para um alvo `tool`, o resultado é reconciliado com `availableTools` a cada
iteração. Somente `eligible` pode ser incluído em `selectedToolNames`; ausente do
catálogo, o estado é `unavailable`. A auditoria associa a decisão a `runId`,
`iteration` e `catalogVersion`. O modelo ainda decide se chamará a tool e toda
governança posterior continua valendo.

### Cache e disponibilidade por iteração

O roteador mantém até 128 resultados por instância, incluindo ausência de match,
com descarte LRU. Mensagens maiores que 8192 caracteres não entram no cache.
O resultado devolvido é uma cópia: consumidores não alteram o alvo cacheado.
O cache contém apenas a intenção. `reconcileDecision` continua obrigatório em
cada iteração com o catálogo atual, mesmo quando há cache hit. `reload:swapped`,
adição e parada de pacote invalidam a instância e seus vetores.
