# Tools

O módulo externo de tools dá significado a `@register_tool`. Consulte também o
[catálogo completo de decorators](../../../docs/decorators.md#tools).

```js
export function greet({name, language}) {
  /**
   * @register_tool greet
   * @description Cumprimenta um usuário no idioma escolhido
   * @param {string} name - Nome do usuário
   * @param {string?} language - Idioma (padrão: pt)
   */
  const msgs = { pt: `Olá, ${name}!`, en: `Hello, ${name}!` };
  return msgs[language ?? 'pt'] ?? msgs.pt;
}

export function sumNumbers({numbers}) {
  /**
   * @register_tool sum
   * @description Soma uma lista de números
   * @param {number[]} numbers - Lista de números
   */
  return numbers.reduce((acc, n) => acc + n, 0);
}

function createUser({ user }) {
  /**
   * @register_tool createUser
   * @description Cria um novo usuário
   * @param {string} user.name - Nome completo
   * @param {string} user.email - E-mail
   * @param {number?} user.age - Idade (opcional)
   */
  return { id: crypto.randomUUID(), ...user, createdAt: new Date() };
}
```

Padrão combinado de rota + tool + evento no mesmo handler: ver `docs/routes.md`.
