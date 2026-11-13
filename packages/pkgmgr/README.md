# ThinkIac Package Manager

`pkgmgr` manages the local package lifecycle. Packages remain disabled until
they are explicitly enabled after review.

## User interface

The package view lists only local packages. Operators can search, filter,
enable, disable, remove, and apply bulk lifecycle actions. Search runs against
the local list and remains usable on narrow screens.

## Runtime model

Each tenant uses an isolated `PackageRuntime` rooted at `/app/data/runtime`, or
an equivalent volume-backed path. The manifest records intent, the lockfile
records applied state, and retained releases allow rollback without downloading
the package again.

Active packages live in `packages/`. Disabled releases are archived under
`.disabled-packages/`, including version history. The bootstrap closure
(`shell`, `auth`, `agent`, `pkgmgr`, and `ui-dialogs`)
cannot be disabled or removed because the runtime depends on it.

## Tags de pacote

Tags são declaradas no `package.json`, de preferência dentro de `manifest`:

```json
{
  "manifest": {
    "tags": ["Android"]
  }
}
```

Também é aceito `tags` na raiz do manifesto para compatibilidade. Cada valor
deve ser uma string curta. `System` é reservado e atribuído automaticamente à
closure protegida do Runtime; ele não pode ser declarado por um pacote. Pacotes
sem tags válidas aparecem em `Others`. A tela de Pacotes oferece o filtro por
tag e, em `All`, cada grupo de tag pode ser recolhido.

## Theme integration

Package views must read the Runtime theme from `localStorage['think:theme']`,
whose supported values are `dark` and `light`. To react without a reload, listen
for the browser `storage` event on that key and for the local
`think:theme-changed` custom event. Do not use the retired `aurora:theme` key.

## Public tenant creation

`createPublicTenantLifecycle()` receives tenant-scoped runtime, `Environment`,
driver operations, and health-check dependencies. Before creating an
environment, it resolves exact Verdaccio releases and verifies both package
identity and the SHA-512 `dist.integrity` declared in the manifest. It then:

1. Persists the request and its idempotency key.
2. Creates the environment, reconciles the manifest, and provisions the driver.
3. Requires the composite health check to pass.
4. Runs the official teardown with `purge` and records compensation if a step
   after creation fails.

Because `deleted` is terminal, a later public attempt must use a new idempotency
key and a new environment. Callers must provide one runtime per tenant; manifests,
lockfiles, files, secrets, and configuration are never shared between tenants.

## Immutable image rollout

`createImageRollout()` persists promotion decisions for immutable images
referenced by SHA-256 digest. An image enters rollout only when the `build`,
`runtime`, `packageRuntime`, and `health` gates all pass.

The default progression is 5%, 25%, and 100%. Every stage requires all canaries
to remain healthy unless a different threshold is configured. A failed stage is
marked `rolled_back`, and the delivery driver receives the previous image as its
target. Decisions and results are stored in `state/image-rollouts.json`.

## Development

Run the complete package test suite from `apps/thinkiac`:

```sh
npm test --prefix packages/pkgmgr
```

The suite covers package history, environment lifecycle, public tenant
compensation, responsive UI contracts, and image promotion or rollback using
local fixtures.
