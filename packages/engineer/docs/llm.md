# LLM disponível para outros packages

## Via evento (recomendado)

```js
import { dispatchEvent } from 'logos';

const result = await dispatchEvent('llm:call', {
  prompt: 'Classifique: "Adorei o produto"',
  system: 'Responda apenas: positivo, negativo ou neutro.',
});
console.log(result.text); // "positivo"

// Com histórico
const result = await dispatchEvent('llm:call', {
  system: 'Você é um assistente técnico.',
  messages: [
    { role: 'user',      content: 'O que é um índice?' },
    { role: 'assistant', content: 'Um índice acelera buscas...' },
    { role: 'user',      content: 'E quando não usar?' },
  ],
});

// Com modelo específico
const result = await dispatchEvent('llm:call', {
  prompt: 'Resuma em 1 frase: ...',
  model:  'openai/gpt-4o',
});
```

**Retorno:** `{ success: boolean, text: string, model: string | null }`

## Parâmetros do evento `llm:call`

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `prompt` | `string` | sim* | Mensagem única do usuário |
| `messages` | `array` | sim* | Histórico `[{ role, content }]` |
| `system` | `string` | não | System prompt |
| `model` | `string` | não | Override pontual do modelo |

*`prompt` ou `messages` — ao menos um obrigatório. Se ambos, `messages` tem prioridade.

Use `llm:call` para geração pontual (classificação, sumarização, extração). Use um agente completo quando precisar de loop ReAct com tools ou memória de sessão.
