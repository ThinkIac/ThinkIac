# WebSocket

Hub WebSocket reutilizável com sessões, canais isolados, handlers por dono,
heartbeat e uma política assíncrona de autorização opcional.

```js
const { WsHub } = require('@thinkiac/module-websocket');
const hub = new WsHub();
hub.create(server, { authorize: request => hasAccess(request) });
hub.onMessage('chat', handler, { owner: 'chat' });
```
