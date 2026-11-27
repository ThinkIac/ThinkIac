# Operações do barramento Lógos

| Operação | API do barramento | Entrega e resultado |
| --- | --- | --- |
| Chamada com retorno | `request` e `provide` | Um provedor por nome exato. Valida entrada e saída. Retorna inclusive `null` quando o contrato permite e propaga falhas. |
| Notificação | `emit` | Entrega aos observadores, registra falhas individuais e continua. Resolve sem resultado funcional. |
| Transformação | `pipeline` | Executa em ordem crescente de prioridade e, em caso de empate, na ordem de registro. Um retorno diferente de `undefined` e `null` substitui o payload. Falhas de uma etapa são registradas e o pipeline continua com o valor anterior. |

Pacotes podem usar `ctx.events.provideResponse` para registrar uma chamada
no próprio namespace e `ctx.events.requestResponse` para solicitá-la.
Os validadores de entrada e saída são predicados de tipo. Registrar um segundo
provedor para o mesmo nome falha até o primeiro ser removido.

O prazo padrão é de 30 segundos. O chamador pode enviar `timeoutMs` e um
`AbortSignal`. Prazo excedido e cancelamento rejeitam a solicitação e sinalizam
o provedor. O provedor pode observar o sinal para interromper o trabalho.
A entrega respeita a autoridade e a governança do barramento.

As APIs legadas `ctx.events.call` e `ctx.events.request` continuam
adaptando as chamadas para `pipeline`. A escolha da operação é feita pelo
método chamado, inclusive quando o chamador usa `await`.
