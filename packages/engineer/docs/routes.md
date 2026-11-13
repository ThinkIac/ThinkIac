# Rotas

O módulo HTTP externo do ThinkIac dá significado a esta declaração. Consulte
também o [catálogo completo de decorators](../../../docs/decorators.md#rotas-http).

```js
/**
 * @register_router abc
 * @method GET
 */
export function routerHello(req, res) {
  return { hello: 'world' };
}

```

> Rotas não streaming retornam `{ data }`, `{ status, headers, body }` ou um
> objeto serializável como JSON.

Rota exposta em: `localhost:5040/packageName/abc`

> Observação, o nome do pacote vem sempre antes do nome da rota.
> {{default_url}}/{{packageName}}/{{routerName}}

> Register com "@register_router api/foo" funcionam: localhost:5040/{{packageName}}/api/foo

- Prefira o decorator acima da função. O bloco dentro da função continua
  compatível e vence quando as duas posições existem.
- Você pode usar `fetch` no Svelte para integrar com as rotas.

---

## Padrão: Rota + Tool + Evento no mesmo handler

```js
// packages/meuPacote/tasks.js
import { getProxy, dispatchEvent } from 'logos';

async function handleCreateTask(data) {
  const db   = getProxy('meuPacote');
  const task = await db.task.push({ title: data.title, done: false });

  await dispatchEvent('tasks:created', task);

  return task;
}

/**
 * @register_router tasks
 * @method POST
 */
export function routerCreateTask(req) {
  return handleCreateTask(req.body);
}

/**
 * @register_tool createTask
 * @description Cria uma nova tarefa
 * @param {string} title - Título da tarefa
 */
export function createTask(data) {
  return handleCreateTask(data);
}

/**
 * @register_hook integration:task-requested
 */
export function onExternalTrigger(payload, context) {
  return handleCreateTask({ title: payload.taskName });
}
```

**Regra:** o handler central não tem decorator — é JS puro, testável isoladamente.
