# @thinkiac/module-svelte

Motor Svelte 4 reutilizável para Runtime/Lógos: SSR, hidratação, cache de
bundles, páginas `.svx`, widgets, Tailwind opcional e HMR com validação antes
da publicação.

```js
const { SvelteEngine } = require('@thinkiac/module-svelte');

const engine = new SvelteEngine('.svelte-cache');
const html = await engine.render(
  '/workspace/packages/blog/views/Index.svelte',
  'blog__Index',
  {},
  '/workspace/packages',
);
```

`svelte`, `esbuild` e `esbuild-svelte` são peers opcionais: o módulo pode ser
instalado em runtimes sem views, mas a primeira compilação informa claramente
as dependências ausentes.

O módulo também exporta `mountPackageViews(container, pkg, adapters)`, que
registra as rotas de páginas e o cache no mount HTTP fornecido pelo host. Os
adaptadores fornecem o motor, a resolução de páginas públicas e privadas, a
renderização e o middleware estático. O host continua responsável por aplicar
a autorização antes dessas rotas e por normalizar aliases de URL.
