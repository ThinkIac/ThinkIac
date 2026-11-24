# External runtime module protocol

Lifecycle envelopes use `RUNTIME_PROTOCOL_VERSION = 1`. The factory host ports
remain a transitional compatibility API; a versioned envelope does not imply
that every existing capability has migrated to generic resource consumers.

## Discovery

The host selects workspace-relative paths, absolute paths or installed packages
using `externalModules`. `[]` selects no capabilities. Compatibility discovery reads
`runtime.role = "module"` and `runtime.entry` from adjacent manifests without probing
libraries by executing them. Entrypoints must stay inside their package; declared
modules that fail to load fail boot explicitly.

## Native entrypoints

```js
exports.register = context => context.register({
  name: 'arithmetic', version: '1.0.0', phase: 'wire',
  resources: {
    arithmetic: resource => context.state.set(resource.declaration.name, resource.handler),
  },
  install(moduleContext) { moduleContext.log('installed'); },
  close() { context.state.clear(); },
});
```

A package declares `@register arithmetic double` on an exported function. The
kernel delivers the normalized declaration and mediated handler after sealing
the catalog. `ModuleContext` and `ModuleDeclaration` are public types. The context
exposes identity, protocol version, workspace, own `moduleConfig[entrypoint]`,
own state, logging, events and early registration. It exposes no container,
registry or capability-specific ports. Entrypoint listeners are removed during
shutdown, including failed boot.

`capabilities: { surface(request, { package: owner }) {} }` declares a mediated
isolated IPC provider. Conflicting surface names fail before installation.
Providers retain the requester's package authority and own validation. Inside an
isolated process, `require('logos').requestCapability(request)` invokes this port.
The database provider restricts its legacy facade to the requesting tenant.

## Factory

```js
function createRuntimeModule(host) {
  return {
    name: 'capability-name',
    version: '1.0.0',
    phase: 'boot', // or 'wire'
    after: ['dependency-name'],
    requires: ['required-module'],
    swappable: true,
    api: {},
    install() {},
    async prepare() {},
    async start() {},
    async close() {},
  };
}

module.exports = { createRuntimeModule };
```

Required fields are `name`, `phase` and `install`. `api` is optional. When it is
present, Lógos freezes it and stores it by module name for compatibility
facades and other host ports.

`boot` modules install after module entrypoints have been collected. `wire` modules
install before `package:wiring` is emitted. Dependencies in `after` participate
in lifecycle ordering.
`after` is an optional ordering constraint: an absent name is ignored for
compatibility. `requires` declares modules that must exist and install first;
a missing module fails the phase before any of its pending modules install.

Workspace module-package functions can also declare dependencies in their
JSDoc. Both registration spellings remain supported:

```js
/**
 * @register module cache
 * @phase wire
 * @requires storage
 * @after metrics
 */
function install(container) { /* ... */ }
```

`@register_module cache` is the legacy alias. Repeat `@requires` or `@after`
for multiple names. This compatibility path still receives the container and is
not the versioned event-based module protocol described by the migration plan.

## Host boundary

The factory receives a frozen object of functions and narrow namespaces. A
module may use only the ports it is given. It must not import files from
`logos/src`, receive the `Container` object, or infer paths into the Lógos
distribution.

General ports currently include logging, configuration access, event
subscription and dispatch, namespaced state, package discovery and scoped
resource lifecycle. Transitional namespaces expose narrower adapters for HTTP,
tools, commands, storage, processes and repository support.

Those namespaces are compatibility seams. New module work should prefer
capability-neutral declaration events and explicit versioned ports. Passing
another implementation object through the host would recreate the coupling the
extraction is removing.

## Generic declarations

The scanner recognizes both:

```js
/** @register example action */
```

and the legacy spelling:

```js
/** @register_example action */
```

It emits this serializable metadata:

```json
{
  "type": "example",
  "name": "action",
  "legacy": false,
  "tags": {
    "register": ["example action"]
  }
}
```

The handler travels separately and is delivered through `register:example`.
The launcher does not define what `example`, `action` or any additional tag
means. The subscribing module owns validation and execution semantics.

Current ThinkIac capability modules have not all moved to this generic event.
Some still use dedicated scanners supplied by the host. Consult the ThinkIac
decorator reference for syntax that works in the active distribution.

## Lifecycle ownership

A module that acquires listeners, processes, timers, sockets or watchers must
attach their cleanup to the lifecycle ports supplied by the host. Mutable
module-level state is unsafe across multiple runtimes and reload generations;
use the provided namespaced state and scopes.

## Completion criteria for an extraction

A capability is external only when:

- its implementation and tests live outside the Lógos package;
- Lógos has no direct import or fallback for it;
- absence of the module produces an explicit unavailable-capability result;
- one external module owns installation and teardown;
- compatibility behavior is covered by the module's tests.

## HTTP transport migration

The external HTTP module now owns application and server creation, body parsers
(including raw signed JSON), global middleware timing, CORS, health/debug routes,
view recovery, final 404/error handlers, port binding and HTTP teardown. The
bootstrap preserves its existing app/server return values and delegates these
operations through the compatibility API. The HTTP package declares its own
Express, CORS and upload dependencies.

The WebSocket runtime module requires HTTP and creates its hub during installation,
before package wiring. This preserves cold-boot stream registration even when the
host lists WebSocket before HTTP. Views resolve the application lazily, so factory
loading does not capture an application that has not been created yet.

HTTP owns `prepare` (final middleware) and `start` (listen), views own their
warmup, MCP owns its startup and transport shutdown. WebSocket, process bridges,
repository and Supervisor own their teardown. HTTP route staging and smoke
checks execute inside the HTTP module through package lifecycle events.

## Sealed catalog and lifecycle v1

`bootstrap({ externalModules: [], modules: [], workers: false })` starts without
HTTP, views, WebSocket, MCP, repository or mediated I/O. It retains the kernel's
package registry and generic lifecycle coordination; no stabilizer is created. `app`, `server` and `mcp` are null
when their providers are absent. Compatibility compiler/class exports load
their external implementation only when called or constructed.

The bootstrap collects configured modules and workspace module entrypoints,
then validates both phases and seals a copied catalog before any installer runs.
Missing required modules, cycles, impossible phase order and conflicting
`resources` claims reject boot. Overrides remain supported before sealing.
Adding a module after sealing requires another boot; adding normal packages
continues to work through activation and workspace discovery.

Lifecycle events are `logos:starting`, `logos:modules:register`,
`logos:modules:sealed`, `logos:module:installing|installed|failed`,
`logos:packages:scanning`, `logos:wiring`,
`logos:resource:discovered|registering|registered|failed`, `logos:ready`,
and `logos:stopping|stopped`. Critical events propagate handler failures through
`emitStrict`; ordinary `emit` preserves its error-logging compatibility behavior.
Envelopes include version, origin, workspace, package, correlationId, phase and
authority. The registration event supplies a `register(module)` callback.

A configured module may consume a new type without changing the parser:

```js
{
  name: 'example', version: '1.0.0', phase: 'wire',
  resources: { example: async ({ declaration, handler, package: owner }) => {
    // Validate declaration.tags and register the mediated callable.
  } },
  install() {},
  async prepare() {},
  async start() {},
  async close() {},
}
```

All installers finish before declarations are delivered. All prepare hooks
finish before start hooks; readiness follows successful startup. Failed boot
closes partially installed modules in reverse acquisition order. Shutdown is
idempotent and attempts remaining cleanup after a disposer fails. External host
subscriptions are removed during module cleanup. Module close hooks must tolerate
partial installation. Long-running installers must cooperate with host shutdown;
this protocol does not forcibly cancel arbitrary JavaScript promises.

Compatibility boundaries remain: optional adjacent-directory discovery, the
external factory adapter, legacy annotation aliases and one-shot consumers.
Stabilization, concrete scanner semantics, private database operations, worker
threads and isolated processes are external module implementations. The launcher
has no runtime dependency list. Migrating every legacy consumer to native
snapshot registration and retiring compatibility exports are separate work.
Local verification does not certify a published Runtime release.

## Transactional resource consumers

A resource consumer can provide `prepare(resources, { package, version })` instead
of a function. It receives the complete snapshot for its type, including an empty
array when declarations were removed. Preparation must leave live state untouched
and return `commit()`, `rollback()` and `dispose()` methods. Rollback must undo a
partially failed commit; disposal must release only its own generation without
removing a newer publication.

Boot and reload prepare consumers before publication. A failed commit rolls back
prepared consumers in reverse order. A rejected swapping listener restores the
previous resource publication and event schemas. Successful replacement retires
the previous generations. Shutdown waits for in-flight preparation/publication,
rolls back pending candidates and disposes live generations before module close.
Duplicate commit attempts are rejected; explicit rollback waits for publication.
This is compensating rollback, not isolation from concurrent readers while
multiple consumers publish. Legacy swapping listeners remain responsible for
their own side effects.

Explicit external module entries accept workspace-relative paths, absolute paths
and installed package names. Legacy aliases matching Node built-ins, including
`http`, resolve through the compatibility capability directory. The default
adjacent-directory discovery remains supported.

## Native context reference

| Member | Contract |
| --- | --- |
| `version` | Context version, currently `1` |
| `identity` | Selection string used to load the entrypoint |
| `workspace` | Resolved workspace directory |
| `config` | Shallow-frozen copy of `moduleConfig[identity]` |
| `state` | Entrypoint-owned Map scoped to this container |
| `log(message)` | Log with entrypoint identity |
| `on(event, handler, options)` | Tracked subscription; returns unsubscribe |
| `emit(event, payload)` | Ordinary dispatch with error-logging semantics |
| `register(declaration)` | Registration only during early collection |

Native `install(context)` differs from programmatic `LogosModule.install(container)`
and the legacy workspace installer. Only native entrypoints receive the restricted
context. These ports limit coupling, not authority of trusted JavaScript.

The correlation ID is retained for the container protocol stream, not regenerated
per resource. Native `context.emit` does not add a protocol envelope automatically.
`register:<type>` receives the resource payload, distinct from lifecycle envelopes.
A resource `registered` event means delivery, not final transaction acceptance.

Legacy `package:wiring`, `package:activating`, `package:added`, `package:module`,
`runtime:packages_wired` and `runtime:ready` remain integration points. They do not
all share strict error propagation or v1 envelopes. See [structure.md](structure.md).

## Transactional example

This publishes a complete snapshot per package. The identity check prevents old
generation disposal from removing a newer publication.

```js
exports.register = context => {
  const live = context.state;
  context.register({
    name: 'arithmetic', version: '1.0.0', phase: 'wire',
    resources: {
      arithmetic: {
        prepare(resources, { package: owner }) {
          const previous = live.get(owner);
          const next = new Map();
          for (const { declaration, handler } of resources) {
            if (next.has(declaration.name)) throw new Error('Duplicate name');
            next.set(declaration.name, handler);
          }
          return {
            commit() { live.set(owner, next); },
            rollback() {
              if (live.get(owner) !== next) return;
              if (previous === undefined) live.delete(owner);
              else live.set(owner, previous);
            },
            dispose() { if (live.get(owner) === next) live.delete(owner); },
          };
        },
      },
    },
    install() {},
    close() { live.clear(); },
  });
};
```

Preparation must clean acquisitions if it throws before returning a generation.
Rollback may run without commit. Resource objects contain `declaration`, `file`,
`package` and `handler`. Metadata is serializable; the callable is not. Handlers
run under their package authority or through its isolated runner.

### Package preparation before registration

`logos:package:preparing` is delivered strictly in dependency order before a
workspace package entrypoint is imported, including module-packages. Its versioned
payload contains `pkg` and `package` (the folder). The external stabilizer owns npm
dependency preparation. A failure blocks that package and its required consumers,
while optional consumers may continue. No installer runs when that module is absent.
