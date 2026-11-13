# Widgets de pacote e bus de UI

Este documento detalha a extensão do chat. Para escolher entre widget, menu,
Settings, schema e diálogos, consulte o [mapa central](../../../README.md#contratos-de-pacotes-e-interface).

Este documento descreve os dois contratos usados por pacotes para integrar
interfaces ao Agent:

1. renderizar uma view do pacote dentro de um bloco Markdown no chat;
2. trocar eventos entre a view, o shell do Agent e o backend do Runtime.

Também existe um slot declarativo para ações abaixo das mensagens. Um pacote
contribui sem editar o `MessageList`:

```json
{
  "manifest": {
    "messageActions": [{
      "id": "listen",
      "kind": "audio",
      "label": "Ouvir resposta",
      "endpoint": "speak",
      "roles": ["assistant"],
      "order": 15
    }]
  }
}
```

O endpoint recebe `POST { "text": "..." }` e devolve bytes de áudio com o
`Content-Type` correto. A ação só entra no registry quando `GET /<pacote>/status`
responde `{ "ready": true }`. A view do pacote deve emitir
`message-actions:refresh` pelo bus depois de ativar ou desativar o recurso.
Copiar, like e dislike usam o mesmo registry como contribuições nativas.

## Slots nomeados entre pacotes

Um pacote hospedeiro pode criar um ponto de extensão sem importar o provedor.
O provedor declara `manifest.slots`, usando um nome global qualificado pelo
host:

```json
{
  "manifest": {
    "slots": {
      "email-manager.account-connect": {
        "id": "google",
        "view": "Connect",
        "href": "/gmail-bridge/oauth/start",
        "label": "Conectar Google",
        "order": 100,
        "contract": 1,
        "permission": "email-manager.mailbox.manage"
      }
    }
  }
}
```

`/aura-system/apps/list` publica a contribuição em `app.slots` apenas na view
escolhida. O host coleta as contribuições cujo `slot` coincide com o ponto de
extensão. Sem provedor instalado, a lista é vazia. A identidade de resolução é
`slot + id`: se repetir, a última contribuição ativa vence e informa
`overrides`; `order` apenas ordena identidades diferentes.

O campo `permission` é metadado de visibilidade. Ele não concede acesso: host e
provedor devem autorizar novamente cada operação no backend. Campos existentes
como `widget`, `menu`, `inputbar`, `composerSlot` e `messageActions` continuam
compatíveis e não exigem migração.

Os módulos canônicos são:

- `views/lib/widget_bootstrap.js`: descobre widgets publicados pelos pacotes;
- `views/lib/renderers.js`: registra e resolve linguagens de blocos Markdown;
- `views/components/PackageWidget.svelte`: hospeda a view em um `iframe`;
- `views/lib/bus.js`: implementa o bus local e a ponte de `postMessage`;
- `views/Home.svelte`: consome os eventos de navegação do shell;
- `views/chatSocket.js` e `core/chat_bus.js`: fazem a ponte WebSocket com o
  backend.

## Declarar um widget de Markdown

O pacote declara `manifest.widget` em seu `package.json`:

```json
{
  "name": "example-widget",
  "type": "module",
  "manifest": {
    "name": "Example",
    "widget": {
      "lang": "example",
      "title": "Example",
      "view": "Widget",
      "aliases": ["exemplo"],
      "partialMin": 0
    }
  }
}
```

Campos:

- `lang` é a linguagem canônica do bloco, como `example` em
  ```` ```example ````;
- `title` vira o título acessível do `iframe`;
- `view` é opcional e seleciona `views/<view>.svelte`; sem ele, o registry usa
  a view principal (`Index` ou `Home`);
- `aliases` é uma lista opcional de linguagens equivalentes;
- `partialMin` define o mínimo de caracteres para mostrar o preview enquanto a
  resposta ainda está em streaming.

O endpoint `/apps/list`, fornecido por `aura-system`, anexa o manifesto do
widget apenas à view escolhida. No boot, `bootstrapPackageWidgets()` consulta
esse endpoint e registra cada `lang` em `renderers.js`. Assim, não existe um
registro manual por pacote no Agent.

Um bloco como:

````markdown
```example
conteúdo de entrada
```
````

é resolvido para `PackageWidget.svelte`. O componente abre a URL publicada da
view em um `iframe` e envia o conteúdo do bloco no fragmento da URL:

```text
#data=<base64(JSON.stringify({ source: "conteúdo de entrada" }))>
```

Em modo de edição, o payload também inclui `mode: "edit"`.

## Ler a entrada e ajustar a altura

A view do pacote decodifica o payload sem depender do Agent:

```js
const params = new URLSearchParams(location.hash.slice(1))
const payload = JSON.parse(
  decodeURIComponent(escape(atob(params.get('data')))),
)

console.log(payload.source)
```

Depois de renderizar ou mudar de tamanho, ela pode informar a altura desejada:

```js
parent.postMessage({
  source: 'agent',
  type: 'widget:height',
  detail: document.documentElement.scrollHeight,
}, '*')
```

`PackageWidget.svelte` só aceita `widget:height` quando a mensagem veio do
`contentWindow` do próprio `iframe`. A altura é limitada a 2000 pixels.

## Bus local e navegação do shell

Código que roda diretamente no frontend do Agent pode importar:

```js
import { $, on } from './lib/bus.js'

const unsubscribe = on('example:changed', (detail) => {
  console.log(detail)
})

$('example:changed', { value: 1 })
unsubscribe()
```

Views de pacote rodam em `iframe` e não importam esse módulo. Elas publicam o
mesmo evento via `postMessage`:

```js
parent.postMessage({
  source: 'agent',
  type: 'open:app',
  detail: 'file-manager',
}, '*')
```

A ponte global ignora mensagens que não tenham `source: "agent"`. O campo
`type` vira o nome do evento e `detail` vira seu payload.

Eventos de navegação consumidos pelo shell incluem:

- `open:app`: recebe nome do pacote, id do app ou URL publicada;
- `open:iframe`: recebe `{ url, title }`;
- `open:with`: recebe `{ pkg, url, title, path }`;
- `open:canvas`: recebe `{ html }`.

Exemplo para abrir uma URL em uma aba:

```js
parent.postMessage({
  source: 'agent',
  type: 'open:iframe',
  detail: { url: '/docs', title: 'Documentação' },
}, '*')
```

## Ponte frontend → backend

Eventos são locais por padrão. Nomes iniciados por `logos:` ou `think:` são
também encaminhados ao backend. Código dentro do Agent pode forçar o
encaminhamento de qualquer nome com `{ server: true }`:

```js
$('logos:example:refresh', { id: '42' })
$('example:refresh', { id: '42' }, { server: true })
```

O fluxo é:

```text
view/widget
  → bus.js
  → chatSocket.js ({ type: "bus:emit", event, detail })
  → core/chat_bus.js
  → dispatchEvent(event, detail)
  → @register_hook <event>
```

Uma view em `iframe` inicia o mesmo fluxo com `postMessage`:

```js
parent.postMessage({
  source: 'agent',
  type: 'logos:example:refresh',
  detail: { id: '42' },
}, '*')
```

O backend trata o evento com um hook normal:

```js
export async function refreshExample(payload) {
  /**
   * @register_hook logos:example:refresh
   */
  return { ok: true, id: payload?.id }
}
```

## Ponte backend → frontend

Para emitir um evento de volta às abas conectadas, o backend usa `broadcast`
com o envelope `bus:event`:

```js
import { broadcast } from 'logos'

broadcast({
  type: 'bus:event',
  event: 'example:refreshed',
  detail: { id: '42' },
})
```

`chatSocket.js` recebe a mensagem e `Home.svelte` a reemite apenas localmente
com `emitLocal()`. Isso evita devolver ao backend um evento que acabou de vir
dele.

No frontend:

```js
const unsubscribe = on('example:refreshed', (detail) => {
  console.log(detail.id)
})
```

## Checklist para um novo widget

1. Declare `manifest.widget` e uma view Svelte no pacote.
2. Leia `source` do payload em `location.hash`.
3. Envie `widget:height` depois da montagem e de mudanças de layout.
4. Use mensagens com `source: "agent"` para interagir com o shell.
5. Reserve `logos:` como prefixo primário para eventos que devem chegar ao
   backend; `think:` existe apenas como alias.
6. Remova listeners adicionados pela view quando ela for desmontada.
7. Teste descoberta em `/apps/list`, renderização do bloco, altura do `iframe`
   e, se aplicável, os dois sentidos da ponte WebSocket.
