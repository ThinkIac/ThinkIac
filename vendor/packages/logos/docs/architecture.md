# Launcher architecture

`bootstrap()` is the single runtime entrypoint. The production manifest has no
required or optional runtime dependencies. A packed installation boots without
HTTP, Svelte, database, workers, stabilization, or adjacent module directories.

## Kernel boundary

The kernel owns events, generic declaration scanning, the module catalog,
dependency ordering, contracts, authority, service/effect scopes, resource
transactions and boot/shutdown coordination. It creates no Express server,
worker pool, database key, file watcher or isolated package process.

ThinkIac selects capabilities in its root `index.js` and depends on them in its
own `package.json`. Compatibility discovery reads `runtime.role = "module"` and
`runtime.entry` from manifests without executing unrelated libraries.
Declared modules that fail to load produce explicit errors.

## Resource owners

| Resource | External module directory |
| --- | --- |
| HTTP, route staging and request performance | `http` |
| WebSocket | `websocket`, `websocket-runtime` |
| Tools, hooks, commands, environment | `tools`, `hooks`, `commands`, `env` |
| Credentials, MCP, views | `credentials`, `mcp`, `svelte` |
| Database, schemas and private vault | `db` |
| Storage and repositories | `storage`, `repo` |
| Checkpoints, watching, health, reload and recovery | `stabilizer` |
| CPU worker threads | `workers` |
| Permission-limited processes and mediated IPC | `isolated-runtime` |
| Concrete annotation vocabulary and scan adapters | `annotations` |
| Transitional factory host and import compatibility | `runtime-compat` |

Isolated requests go to module-declared providers. There is no database switch
in the kernel. Provider conflicts fail before installation; each provider
validates its operations under the requesting package's authority.

## Native protocol and compatibility

An entrypoint exports `register(context)`, called in the early registration
window. It registers a `ModuleDeclaration` and receives the same scoped
`ModuleContext` during installation. Context contains identity, version, workspace,
own configuration/state, logging and events, without a raw container or registry.
The catalog is sealed before installation and resource delivery. Transactional
resource consumers prepare, commit, roll back and dispose package snapshots.
Shutdown attempts every disposer and removes entrypoint subscriptions.

Existing factories use the external `runtime-compat` adapter. Old internal imports
are typed facades over implementations in each owning module's `compat/` directory;
they do not install a second internal implementation. An experimental standalone
browser client remains as a compatibility artifact outside the boot graph.
Some existing capabilities still consume lifecycle events and legacy annotations.
Migrating every consumer to native snapshots and retiring the broad factory
adapter remain compatibility work, not a second bootstrap.

## Verification boundary

`npm run test:independent` packs Logos into a temporary project with no production
dependencies or sibling modules, rejects capability imports, and verifies empty
boot, a native module, an arbitrary resource type and shutdown. Module independence
tests also check simultaneous runtimes and generic isolated capability requests.
Arbitrary JavaScript promises still require cooperative cancellation.

Local verification neither publishes a version nor certifies acceptance by the
running Runtime. Android fixtures and optional test dependencies must be available
for complete environment acceptance.

## Navigation

[Structure and operation](structure.md) maps directories, configuration, boot,
package failures and global state. [Migration](../MIGRATION.md) covers compatibility.
