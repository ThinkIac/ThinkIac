# Migration status

Lógos 2.x is being reduced from a bundled runtime into a launcher for external
runtime modules. This is an architectural migration inside the 2.x development
line; it is not complete in the current source tree.

## Already external

The built-in module list is empty. Capabilities are discovered from adjacent
packages that export `createRuntimeModule(host)`. HTTP, hooks, tools, commands,
views, storage, repository support and other capabilities already install
through that mechanism.

## Still provided for compatibility

`bootstrap()` and existing loose exports remain available. The package still
contains the event kernel, registry, package scanning, authority,
stabilization, isolation and several compatibility implementations. External
modules also still use dedicated scanner ports for the established
`@register_*` decorators.

Applications do not need to rewrite decorators during this phase. ThinkIac
documents the currently supported syntax in
[its decorator reference](../../../docs/decorators.md).

## Direction

New capability work must go to an external module. Each extraction ends only
when Lógos no longer imports or falls back to that implementation and a host
fixture proves composition explicitly. The intended boundary and completion
criteria are in [docs/architecture.md](docs/architecture.md).

Historical migration details for `runtime-js` and the old bundled v2 feature
set have been removed from this package because they described ThinkIac's host
composition as if it were intrinsic to Lógos.
