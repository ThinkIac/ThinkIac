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

Um provedor pode declarar fases em `extensions` no contrato de
`provideResponse`. `ctx.events.hook(evento, fase, handler, prioridade)`
registra um hook por pacote, evento e fase. A prioridade menor executa primeiro.
Hooks são descartados junto com o escopo do pacote.

- `before` recebe uma cópia da entrada validada.
- `transform` recebe uma cópia da saída atual. Um retorno diferente de
  `undefined` substitui a saída após cópia e validação.
- `after` recebe uma cópia da saída final.

As fases de observação ignoram o retorno, inclusive `false`. Uma falha do hook
rejeita a chamada. O prazo e o sinal de cancelamento da chamada abrangem as três
fases. Valores expostos a hooks precisam aceitar a serialização do V8.
Com governança habilitada, cada fase exige autorização da sua entrega.

Quando o manifesto tem política `$`, o contrato ativo resolve o nome
qualificado e verifica a permissão de chamada antes de consultar a governança
de entrega. Isso vale tanto para a chamada legada quanto para `requestResponse`.
Sem a política, os nomes recebidos são preservados.

Recibos de entrega da versão 2 incluem origem, integridade da origem, evento,
destinatário e operação. Recibos de fluxo também incluem o identificador do
fluxo. Recibos da versão 1 permanecem disponíveis para auditoria e precisam
de nova decisão para autorizar entregas futuras.
