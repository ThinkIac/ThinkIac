# Launcher architecture

## Intended boundary

The final `logos` distribution is a small, capability-free launcher. It should
resolve an explicitly selected host, create a minimal launch context, invoke
the host and propagate its result. It must not decide that a runtime includes
HTTP, tools, views, a database, an MCP server or any other product capability.

The host is an ordinary external package. ThinkIac can assemble one host; a
different product can assemble another without forking the launcher.

```text
logos
  `-- host
       +-- lifecycle and event modules
       +-- discovery and contract modules
       +-- HTTP / tools / views / data modules
       `-- application packages
```

## What is true today

The active implementation is halfway through that extraction:

1. `builtinModules()` is empty.
2. `discoverExternalRuntimeModules()` scans the adjacent modules directory.
3. Only packages exporting `createRuntimeModule(host)` become runtime modules.
4. `installExternalModules()` registers them in the lifecycle container.
5. Capability modules receive a frozen set of host ports and may return a
   frozen public `api` stored by module name.
6. Generic declarations are emitted as `register:<type>` events.

HTTP, hooks, tools, commands, storage, repository support, views and related
capabilities are already external packages. Transport-only libraries such as a
WebSocket library or process bridge are not installed unless they deliberately
export the runtime-module factory.

## What remains transitional

Lógos still contains bootstrap, Express server creation, the event bus,
container, registry, authority, package scanner, stabilizer, isolated runner,
database compatibility and legacy public facades. This is observable in
`src/index.ts`, `src/kernel/`, `src/stabilizer/`, `src/core/` and `src/database/`.

The host port also still exposes capability-specific adapters such as
`scanRoutes`, `scanHooks` and the tools scanner. This lets the extracted modules
preserve current ThinkIac behavior, but it means decorator interpretation is
not fully external yet.

The docs must describe this as a migration, not erase the remaining coupling or
present the target as shipped.

## Extraction invariant

Each next step must preserve one active owner for a capability:

- define a versioned port or declaration contract;
- move implementation and tests to an external package;
- make the host select that package explicitly;
- remove the corresponding implementation import and fallback from Lógos;
- prove a fixture fails clearly without the module and works with it.

Do not run an internal and external copy concurrently. Do not add a new
capability to Lógos as a temporary convenience. Compatibility adapters may
remain only while an existing consumer still needs them and must be identified
as such.

## Destination of responsibilities

| Responsibility | Destination |
| --- | --- |
| launch arguments and host resolution | launcher protocol |
| lifecycle, events, discovery, contracts, authority | external foundation modules |
| HTTP, WebSocket, tools, commands, hooks, views | external capability modules |
| database, storage, vault, process and repository support | external capability modules |
| staging, checkpoints and supervision | external operational modules |
| decorator vocabulary and application guides | host documentation, such as ThinkIac |

The final launcher should be auditable without understanding any capability it
can launch.
