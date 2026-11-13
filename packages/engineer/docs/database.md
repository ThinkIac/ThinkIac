# Banco de Dados

Cada pacote pode ter seu próprio banco SQLite isolado. O runtime compõe recursivamente
arquivos `*.prisma` e `*.scriba` do pacote e provisiona o tenant automaticamente.
Quando existe, `schema.prisma` na raiz é a declaração principal.

## Declarar o schema

```prisma
// packages/meuPacote/schema.prisma
model Task {
  id    String  @id @default(uuid())
  title String
  done  Boolean @default(false)
  // createdAt / updatedAt / deletedAt são injetados automaticamente
}
```

Fragmentos podem acrescentar modelos, enums e campos a modelos existentes:

```prisma
// packages/meuPacote/features/reminders.scriba
model Task {
  reminderAt DateTime?
}
```

Regras de composição:

- campos e declarações do `schema.prisma` principal têm precedência;
- fragmentos são processados em ordem estável de caminho;
- declarações idênticas são deduplicadas;
- campos divergentes entre dois fragmentos invalidam o candidato;
- o schema gerado fica em `.logos/generated/db/schema.prisma` e não deve ser editado;
- adição, alteração e remoção de fragmentos são aplicadas ao tenant aberto após validação.

Uma falha de composição ou aplicação preserva o schema ativo anterior e emite
`db:schema_compose_failed`. Uma aplicação válida emite `db:schema_composed`.

## Acessar com getProxy

```js
const { getProxy } = require('logos');
const db = getProxy('meuPacote'); // db.task, db.user, etc.
```

## Operações disponíveis

```js
const task  = await db.task.push({ title: 'Comprar pão', done: false });
const task  = db.task['uuid-aqui'];
const task  = db.task.findOne({ title: 'Comprar pão' });
const list  = db.task.query({ done: false }, { sort: 'createdAt DESC', limit: 10 });
const total = db.task.count({ done: true });
const todos = db.task.all(true); // inclui soft-deletados

task.title = 'Novo título'; // persiste e atualiza updatedAt automaticamente

const task = await db.task.upsert({ email: 'x@x.com' }, { name: 'João' });
await db.task.delete(task.id); // soft delete se o model tiver deletedAt
```

## Operadores de query

| Sintaxe | SQL gerado |
|---|---|
| `{ campo: 'valor' }` | `campo = 'valor'` |
| `{ campo: { $gt: 5 } }` | `campo > 5` |
| `{ campo: { $gte: 5 } }` | `campo >= 5` |
| `{ campo: { $lt: 5 } }` | `campo < 5` |
| `{ campo: { $ne: 'x' } }` | `campo != 'x'` |
| `{ campo: { $like: '%x%' } }` | `campo LIKE '%x%'` |
| `{ campo: { $in: [1, 2] } }` | `campo IN (1, 2)` |
| `{ campo: { $null: true } }` | `campo IS NULL` |
| option `includeDeleted: true` | inclui registros deletados |
