// Nome que uma view ganha no launcher.
//
// Contexto (card "Store Funcional"): o manifest sempre aceitou
// `manifest.page[] = { name, source }`, mas o registro de apps ignorava e
// derivava o rótulo do NOME DO ARQUIVO. Resultado no Store: "Publish App"
// aparecia como "Store - Publish" e "Store Validation" como "Store - Admin".
//
// A regra vive dentro de `getActiveApps`, que varre o disco e fala com o
// Docker — não dá para chamar num teste. O que se testa aqui é a regra
// isolada, mantida idêntica à do index.js.
//
// Rodar: node --test packages/shell/test/system/page_names.test.js

import assert from 'node:assert/strict'
import test from 'node:test'

// Espelho de packages/shell/runtime/system/apps/index.js (getActiveApps).
function resolveViewName(pkgManifest, pkgJsonName, viewName) {
  const declaredPages = new Map(
    (pkgManifest?.page || [])
      .filter(p => p?.source && p?.name)
      .map(p => [p.source.replace(/^\.?\//, '').replace(/\.svelte$/i, ''), p.name])
  )
  const pkgName = pkgManifest?.name || pkgJsonName || 'App'
  const formattedPkgName = pkgName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const formattedViewName = viewName.charAt(0).toUpperCase() + viewName.slice(1)

  const declaredName = declaredPages.get(`views/${viewName}`)
  return declaredName
    ? declaredName
    : (['index', 'home'].includes(viewName.toLowerCase())
      ? formattedPkgName
      : `${formattedPkgName} - ${formattedViewName}`)
}

// O manifest real do pacote store.
const STORE = {
  name: 'Store',
  page: [
    { name: 'Store', source: 'views/Home.svelte' },
    { name: 'Publish App', source: 'views/Publish.svelte' },
    { name: 'Store Validation', source: 'views/Admin.svelte' },
  ],
}

test('o nome declarado no manifest vence o derivado do arquivo', () => {
  assert.equal(resolveViewName(STORE, 'store', 'Publish'), 'Publish App')
  assert.equal(resolveViewName(STORE, 'store', 'Admin'), 'Store Validation')
})

test('a view principal continua com o nome do pacote', () => {
  assert.equal(resolveViewName(STORE, 'store', 'Home'), 'Store')
})

test('pacote sem `page` mantém exatamente o comportamento antigo', () => {
  const m = { name: 'Ntfy' }
  assert.equal(resolveViewName(m, 'ntfy', 'Index'), 'Ntfy')
  assert.equal(resolveViewName(m, 'ntfy', 'Home'), 'Ntfy')
  assert.equal(resolveViewName(m, 'ntfy', 'Widget'), 'Ntfy - Widget')
})

test('nome de pacote com hífen vira Title Case', () => {
  assert.equal(resolveViewName({ name: 'deep-research' }, 'deep-research', 'Index'), 'Deep Research')
})

test('`source` com ./ ou sem .svelte casa do mesmo jeito', () => {
  // O manifest é escrito à mão; as três grafias aparecem na prática e todas
  // apontam para o mesmo arquivo.
  const variants = [
    { name: 'X', source: './views/Admin.svelte' },
    { name: 'X', source: 'views/Admin.svelte' },
    { name: 'X', source: 'views/Admin' },
  ]
  for (const page of variants) {
    assert.equal(resolveViewName({ name: 'P', page: [page] }, 'p', 'Admin'), 'X')
  }
})

test('entrada de `page` incompleta é ignorada em vez de quebrar', () => {
  const m = { name: 'P', page: [{ source: 'views/Admin.svelte' }, { name: 'só nome' }, null] }
  assert.equal(resolveViewName(m, 'p', 'Admin'), 'P - Admin')
})

test('`page` apontando para view inexistente não afeta as outras', () => {
  const m = { name: 'P', page: [{ name: 'Fantasma', source: 'views/NaoExiste.svelte' }] }
  assert.equal(resolveViewName(m, 'p', 'Home'), 'P')
})
