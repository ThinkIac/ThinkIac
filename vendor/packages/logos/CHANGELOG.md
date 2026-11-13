# Changelog

## Unreleased

### Changed

- Removed the built-in runtime module list. Runtime capabilities are discovered
  from external packages exporting `createRuntimeModule(host)`.
- Added the capability-neutral declaration shape and `register:<type>` delivery
  path.
- Reframed the package documentation around the launcher boundary. HTTP,
  tools, hooks, commands, views, data, stabilization policy and other host
  capabilities are no longer documented as intrinsic Lógos features.

### Transitional compatibility

- `bootstrap()` and the existing public facades remain available.
- The event kernel, scanner, registry, authority, stabilization and isolation
  code have not all been extracted yet.
- External ThinkIac modules still use dedicated scanner ports for parts of the
  legacy `@register_*` vocabulary.

See [MIGRATION.md](MIGRATION.md) and
[docs/architecture.md](docs/architecture.md) for the exact boundary.

## 2.0.0

The 2.0 release introduced the compatibility runtime that is now being split
into the launcher and external modules. Historical capability details belong to
the host release notes rather than this launcher changelog.
