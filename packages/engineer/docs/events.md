# Eventos

Hooks são interpretados pelo módulo externo de hooks; o barramento pertence à
composição do host. Consulte também o
[catálogo completo de decorators](../../../docs/decorators.md#hooks).

```js
import { dispatchEvent } from 'logos';

await dispatchEvent('tasks:created', { id: task.id, title: task.title });
```

```js
export function onTaskCreated(payload, context) {
  /**
   * @register_hook tasks:created
   */
  console.log('Nova task:', payload.title, context.matchedEvent);
}
```

> Use apenas um parâmetro sempre do tipo Objeto nos eventos.

- Convenção: `namespace:acao` (ex: `tasks:created`, `users:deleted`).
- Suporta wildcard: `@register_hook tasks:*`.
- O retorno do hook vira o novo payload para o próximo hook na cadeia.
- Em eventos usados por `AGENT.md`, o retorno final deve ser um objeto não nulo;
  ele será usado como contexto do Inflect. Veja `docs/agent-md-system.md`.
- `context` contém `{ pkg, matchedEvent, ... }`.
- `boot` é um evento padrão do sistema; use para setup do pacote.
- `db:schema_composed` informa `{ pkg, sources }` depois que o tenant passa a usar o schema efetivo.
- `db:schema_compose_failed` informa `{ pkg, error }` quando um fragmento é rejeitado; o tenant anterior permanece ativo.

Padrão combinado de rota + tool + evento no mesmo handler: ver `docs/routes.md`.
