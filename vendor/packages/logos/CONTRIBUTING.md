# Contributing to Lógos

Lógos is a launcher and capability-neutral protocol with compatibility seams. Before a
change, decide whether it belongs to the launcher or to an external module.

## Boundary

Changes belong here only when they are required to resolve a host, launch it,
transport generic declarations, coordinate the minimal lifecycle or preserve a
documented compatibility seam during migration.

HTTP, WebSocket, MCP, tools, views, databases, storage, repositories,
authentication and product policy belong in external packages. Do not add a
fallback implementation to Lógos when a module is missing; report the missing
capability explicitly.

External modules must use the public host ports described in
[docs/modules.md](docs/modules.md). They must not import `logos/src` internals.

## Compatibility code

The tree retains typed facades, contracts and compatibility tests. Concrete
implementations belong to external modules and their compat/ directories. Keep
one active owner. Do not restore internal fallbacks or remove facades while
consumers depend on them. Native migration requires parity validation.

Decorator vocabularies belong to the host. The scanner may transport generic
`@register` metadata, but Lógos must not define new HTTP-, tool- or view-specific
tags.

## Build and test

```bash
npm install
npm run build
npm test
```

When extracting a capability, run both the Lógos compatibility tests and the
external module's tests. See [docs/testing.md](docs/testing.md).
