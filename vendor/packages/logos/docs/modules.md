# External runtime module protocol

This document describes the protocol currently used to extract capabilities
from Lógos. It is an internal compatibility contract under active evolution,
not yet a separately versioned public API.

## Discovery

The compatibility host scans the configured adjacent modules roots. A directory
is a runtime capability only when requiring its public entry succeeds and the
entry exports `createRuntimeModule` as a function.

Ordinary libraries are ignored. A package name or directory name alone never
makes a module active.

## Factory

```js
function createRuntimeModule(host) {
  return {
    name: 'capability-name',
    phase: 'boot', // or 'wire'
    after: ['dependency-name'],
    swappable: true,
    api: {},
    install() {},
  };
}

module.exports = { createRuntimeModule };
```

Required fields are `name`, `phase` and `install`. `api` is optional. When it is
present, Lógos freezes it and stores it by module name for compatibility
facades and other host ports.

`boot` modules install before application packages are touched. `wire` modules
install before `package:wiring` is emitted. Dependencies in `after` participate
in lifecycle ordering.

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
