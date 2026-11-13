# hermes — Barramento do Lógos aberto aos aparelhos

> WebSocket bidirecional entre o runtime e os aparelhos pareados, para o app
> **emitir e receber evento de barramento**.

## Notificações por aparelho

`ntfy:notify` entrega primeiro pelo Hermes para os aparelhos pareados com
`notificationsEnabled: true`. Uma entrega imediata ou a entrada na fila offline
conta como sucesso e impede publicação duplicada no ntfy. Quando não há aparelho
apto, o ntfy continua como fallback legado.

Cada aparelho pode chamar, com seu próprio `token`:

```
PUT /hermes/devices/:appId/notifications
{ "token": "…", "enabled": true,
  "push": { "provider": "fcm", "token": "…" } }
```

O token FCM/APNs fica guardado, mas não é retornado por nenhuma rota ou tool.
Ele prepara o transporte de push nativo; a entrega atual pelo Hermes requer que
o app esteja conectado. Para avisar com o app terminado/background é preciso
configurar o provedor FCM/APNs no host e o cliente Flutter correspondente.

O que este pacote abre é o barramento em si: até então o app só falava com o
runtime indiretamente, com o usuário tocando em algo dentro da WebView.
Agora existe canal direto nas duas direções.

| Precisa de… | Use |
|-------------|-----|
| Avisar o usuário (notificação na tela) | `ntfy` — `dispatchEvent('ntfy:notify', …)`; ele roteia Hermes primeiro |
| Mandar dado pro app reagir | `dispatchEvent('device:emit', …)` |
| Receber algo que o app emitiu | escutar o evento `device:*` no barramento |

A entrega de notificação por aqui (`device:notify`) existe e funciona, mas
**nada a dispara automaticamente**: não há ponte a partir de `ntfy:notify`,
justamente pro aparelho não receber a mesma coisa duas vezes.

## Pareamento

```
POST /hermes/devices   { appId, name, token? }  → { appId, token, created }
```

TOFU (*trust on first use*): o primeiro registro de um `appId` cria o
aparelho e cunha o token. Um registro posterior para o mesmo `appId` só é
aceito **apresentando o token vigente** — senão descobrir um `appId` bastaria
para pedir um token novo e assumir o stream de outra pessoa.

O aparelho guarda o token e o reapresenta em toda conexão. `DELETE
/hermes/devices/:appId` (ou a tool `unpairDevice`) invalida o token e derruba
os sockets daquele aparelho.

> **Limite conhecido:** o registro em si é aberto — qualquer um consegue
> parear um `appId` que ainda não existe. Isso é estritamente melhor que o
> tópico público de antes, mas o passo seguinte é emitir o pareamento pela
> sessão web autenticada, em vez de deixar o aparelho se auto-registrar.

## O socket

O aparelho conecta em `wss://<host>/ws?session=<appId>` e conversa no canal
`hermes:link`. **O `?session=` não autentica nada** — é escolhido pelo
cliente. A entrega só acontece em socket que apresentou `(appId, token)`;
por isso o pacote mantém seu próprio registro de sockets autenticados em vez
de usar `pushToSession` do hub.

### Frames do aparelho → runtime

| `action` | Campos | Efeito |
|----------|--------|--------|
| `auth` | `appId`, `token` | Autentica e descarrega a fila acumulada |
| `ack` | `id` | Confirma a entrega (é o que tira da fila e mede o tempo) |
| `ping` | — | Responde `pong` |
| `respond` | `id`, `response`, `value?` | Emite `device:response` no barramento |
| `event` | `event`, `payload?` | Emite o evento no barramento |

`response` é `confirm`, `cancel` ou `submit` (este exige `value`).

`event` só aceita o namespace **`device:`**. Um aparelho não emite evento de
sistema — sem isso, um celular no bolso de alguém dispararia `auth:check` ou
`reload:*` no runtime inteiro.

### Evento de barramento: runtime → aparelho

```js
await dispatchEvent('device:emit', {
  event: 'build:done',
  payload: { pkg: 'agent' },
  appId,            // opcional; omitido, vai para todos os conectados
})
```

Chega no app como `{ channel, type: 'event', event, payload }`.

Evento de barramento **não vai para a fila offline**: ao contrário de uma
notificação, ele descreve algo de agora — entregar meia hora depois
confundiria o app em vez de ajudar.

### Frames do runtime → aparelho

```jsonc
{
  "channel": "hermes:link",
  "type": "notify",
  "id": "…",            // identifica entrega/interação e volta no ack
  "sentAt": 1700000000000,
  "title": "ThinkIac",
  "message": "build terminou",
  "click": "https://…",  // deep-link ao tocar
  "priority": 3,
  "display": { "mode": "discrete", "key": "sessao-42" }, // cartão visual
  //        | { "mode": "principal", "holdSec": 60 }
  "interaction": { "type": "confirm" }   // ou "prompt", ou null
}
```

Outros `type`: `auth` (`{ ok }`), `pong`, `responded`, `error`.

## Como a mensagem aparece no aparelho

- **`display.mode: "discrete"`** — notificação própria, deduplicada por
  `key`: reenviar com a mesma key **atualiza** aquela notificação em vez de
  empilhar outra. Use uma key estável e relevante (o `sessionId` de um chat,
  `app:<nome>` para um job).
- **`display.mode: "principal"`** — não cria notificação nova; só faz a
  notificação persistente do foreground service mostrar este texto por
  `holdSec` segundos antes de voltar a rotacionar as frases genéricas.

São mutuamente exclusivos. `discreteId` no envio escolhe o primeiro; `hold`
escolhe o segundo.

## Notificação que espera resposta

Com `interaction`, a notificação ganha botões (`confirm` → Confirmar/Cancelar;
`prompt` → campo de texto + Responder/Cancelar) e **sempre** vira notificação
própria — não faria sentido perguntar algo no texto rotativo da persistente,
que some sozinho.

```js
await dispatchEvent('device:notify', {
  message: 'Publicar o rascunho agora?',
  interaction: 'confirm',
})
```

A resposta sai no barramento como **`device:response`**:

```js
{ appId, id, action, value }
// action: 'confirm' | 'cancel' | 'submit'   (value = texto, só no submit)
```

Quem fez a pergunta escuta esse evento e decide o que fazer.

O toque num botão da notificação roda **num isolate próprio do Android**, que
não enxerga o socket do foreground service. Por isso a resposta também é
alcançável por HTTP, com o mesmo efeito:

```
POST /hermes/devices/:appId/respond  { token, id, response, value? }
POST /hermes/devices/:appId/events   { token, event, payload? }
```

Isso é o que faz responder funcionar mesmo com a conexão caída.

## Entrega offline

Mensagem para aparelho desconectado vai para a fila dele (24h de validade,
teto de 200 por aparelho, as mais novas ganham no estouro) e sai inteira
quando ele autentica de novo. Um aparelho parado por 30 dias é esquecido — e
o token some junto, para que um celular trocado não fique com acesso
vitalício.

## Tools

| Tool | O que faz |
|------|-----------|
| `notifyDevice` | Envia uma notificação (todos os pareados, ou `appId` específico) |
| `listDevices` | Aparelhos pareados, quais estão online, quantos itens na fila |
| `unpairDevice` | Invalida o token e derruba os sockets do aparelho |
| `android_cloud_bridge` | Executa uma ação ADB permitida no Flutter conectado, com resposta sincronizada |

## Ponte Android pelo Flutter principal

O app Flutter é a ponte entre Cloud e a bridge ADB que existe no próprio
aparelho. Isso funciona tanto com a interface no modo Cloud quanto no modo
Local: o Runtime local continua em loopback, enquanto o link Hermes sai para o
Cloud. O Cloud nunca vê endereço da LAN, porta ADB ou token da bridge.

O agente usa `android_cloud_bridge` com o `appId` retornado por `listDevices`.
O pedido só é entregue a um Flutter conectado e vence em até 35 segundos. As
ações aceitas são enumeradas: status, activate, stop, capabilities, screenshot, foreground,
packages, battery, identity, ui-tree, screen-state, prepare, tap, swipe, key,
text, open-app e app-info. Pareamento por código não é aceito remotamente e
continua uma ação local explícita no aparelho.

## Diagnóstico

`GET /hermes/devices` e `listDevices` mostram `notificationsEnabled`,
`pushConfigured`, `lastDelivery`, `lastAck` (incluindo `latencyMs` quando a
entrega correlacionada é confirmada), fila e conexão. Não expõem tokens.


## Testes

```
npm test --prefix apps/thinkiac/packages/hermes
```

Cobre pareamento/TOFU, fila offline, e — o mais importante — que um socket
não autenticado não recebe entrega.
