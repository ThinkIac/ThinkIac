# 🌀 Inflect

**Inflect** is a lightweight recursive template engine for Node.js.  
It supports **includes**, **loops**, **conditions**, **switch blocks**, and **inline expressions**.

---

## 🚀 Installation

```bash
npm install inflect
````

or

```bash
yarn add inflect
```

---

## 🧩 Usage

### CommonJS

```js
const { renderTemplate } = require('inflect');

const template = `
Hello {{ name }}!
{#if items.length > 0}
Items:
{#each items as item, i}- {{ i + 1 }}. {{ item }}{/each}
{:else}
No items found.
{/if}
`;

const result = renderTemplate(template, {
  name: "John",
  items: ["Apples", "Bananas"]
});

console.log(result);
```

### ES Modules

```js
import { renderTemplate } from "inflect";

const template = `
{#switch lang}
  {#case 'en'}Hello {{ name }}!{/case}
  {#case 'pt'}Olá {{ name }}!{/case}
  {:default}Hi!{/default}
{/switch}
`;

console.log(renderTemplate(template, { lang: 'pt', name: 'Maria' }));
```

---

## 🧠 Features

### 🔁 Loops

```md
{#each items as item, i}
  {{ i + 1 }}. {{ item }}
{/each}
```

### ⚙️ Conditions

```md
{#if age >= 18}
  You are an adult.
{:else if age >= 13}
  Teenager.
{:else}
  Child.
{/if}
```

### 🔄 Switch / Case

```md
{#switch lang}
  {#case 'en'}Hello{/case}
  {#case 'es'}Hola{/case}
  {:default}Hi{/default}
{/switch}
```

### 🧩 Includes

```md
{#include ./partials/header}
```

> Automatically tries `.mdjs` or `.md` extension if none is provided.

---

## 🧱 Syntax Summary

| Block Type    | Syntax Example                                         |
| ------------- | ------------------------------------------------------ |
| Variable      | `{{ name }}`                                           |
| Include       | `{#include ./path/file}`                               |
| Loop          | `{#each items as item, i}...{/each}`                   |
| Conditionals  | `{#if cond}...{:else if cond}...{:else}...{/if}`       |
| Switch / Case | `{#switch x}{#case v}...{/case}{:default}...{/switch}` |

---

## 📦 Example Template

```md
# Welcome {{ user }}

{#if notifications.length > 0}
You have {{ notifications.length }} new notifications:

{#each notifications as n, i}
- ({{ i + 1 }}) {{ n.title }}
{/each}
{:else}
No notifications 🎉
{/if}
```

Developed with ❤️ using **Inflect**