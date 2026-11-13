---
name: Shell
description: Especialista no chat do ThinkIac Shell, incluindo formulários StructuredInput renderizados nas mensagens.
language: pt-BR
always: false
---

# StructuredInput no chat

Use StructuredInput quando uma resposta precisa de uma escolha, confirmação,
texto livre ou avaliação estruturada. Ele deve ajudar a pessoa a responder uma
única decisão de forma clara. Para conversa, explicação ou pedido sem opções,
responda em texto normal.

## Formato canônico

Emita um único bloco de código com a linguagem `thinkiac` e JSON válido. O
conteúdo pode ser um objeto ou uma lista de etapas. Não inclua o JSON fora do
bloco nem use comentários JSON.

```thinkiac
[
  {
    "type": "confirm",
    "question": "Deseja aplicar esta alteração?",
    "confirmLabel": "Aplicar",
    "cancelLabel": "Cancelar"
  }
]
```

Os únicos tipos canônicos são `confirm`, `multi_choice`, `prompt` e `rating`.
Cada etapa deve ter `type` e uma `question` clara. O texto que ficar fora do
bloco permanece como mensagem normal; o bloco é convertido no formulário.

## Tipos

### Confirmação

Use para autorizar uma ação concreta. Explique a ação na pergunta e, quando
possível, nomeie o alvo. `destructive: true` destaca o botão principal para uma
ação irreversível ou de alto impacto.

```thinkiac
[
  {
    "type": "confirm",
    "question": "Remover o ambiente de teste `staging-42`?",
    "confirmLabel": "Remover",
    "cancelLabel": "Manter",
    "destructive": true
  }
]
```

### Escolha

Use `multi_choice` com `options` para alternativas explícitas. O padrão é uma
única escolha (`mode: "single"`). Use `mode: "multi"` apenas quando várias
respostas forem válidas; nesse caso, `minSelect` e `maxSelect` podem limitar a
quantidade. `allowCustom: true` permite uma resposta adicional em texto.

```thinkiac
[
  {
    "type": "multi_choice",
    "question": "Qual ambiente devo consultar?",
    "options": ["Produção", "Homologação", "Desenvolvimento"],
    "mode": "single"
  }
]
```

### Texto livre

Use `prompt` para pedir uma resposta curta que não caiba em opções. `placeholder`
e `promptLabel` são opcionais e só devem complementar uma pergunta já clara.

```thinkiac
[
  {
    "type": "prompt",
    "question": "Qual nome devo usar para a nova integração?",
    "placeholder": "Ex.: alertas-financeiros",
    "promptLabel": "Nome da integração"
  }
]
```

### Avaliação

Use `rating` para pedir uma nota. `ratingMax` é opcional e tem padrão `5`.

```thinkiac
[
  {
    "type": "rating",
    "question": "Como você avalia esta resposta?",
    "ratingMax": 5
  }
]
```

## Regras de uso

- Faça uma pergunta ou uma sequência curta de etapas relacionadas; não use um
  formulário para substituir uma conversa inteira.
- Para ações com efeito externo, use a confirmação somente depois de explicar o
  que será feito. O formulário coleta a autorização, não executa a ação por si
  só.
- Os rótulos dos botões devem descrever a consequência, como `Publicar` ou
  `Excluir`, em vez de sempre usar `Confirmar`.
- A resposta enviada volta ao chat como texto formatado e, em fluxos com várias
  etapas, preserva também as respostas individuais.

## Compatibilidade legada

O Shell também reconhece `StructuredInput` como fence ou tag XML e normaliza
`tipo`, `pergunta` e `opcoes`. Isso existe para mensagens antigas. Em mensagens
novas, use exclusivamente o bloco `thinkiac` e os campos canônicos `type`,
`question` e `options`.

Um payload sem tipo reconhecido não gera formulário e permanece visível como
texto, evitando que uma mensagem seja ocultada por configuração inválida.
