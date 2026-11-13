# Lógos

Lógos is the launcher and compatibility kernel used by ThinkIac. Its direction
is deliberately narrow: resolve a workspace, load external runtime modules,
coordinate their lifecycle and carry capability-neutral declarations. HTTP,
tools, hooks, commands, views, data and product policy belong to modules and to
the host assembled on top of Lógos.

```text
Lógos launcher / protocol
        |
        +-- @thinkiac/module-http
        +-- @thinkiac/module-tools
        +-- @thinkiac/module-hooks
        +-- @thinkiac/module-svelte
        +-- other host-selected modules
        |
        `-- ThinkIac applications
```

## Current status

The extraction is in progress. The active implementation already:

- discovers external packages whose public entry exports
  `createRuntimeModule(host)`;
- installs those modules through lifecycle phases instead of a built-in module
  list;
- exposes narrow host ports instead of passing Lógos internals to capability
  modules;
- emits generic `@register <type> <name>` declarations as
  `register:<type>` events.

Compatibility code still remains in `src/`: bootstrap orchestration, the event
kernel, package discovery, declaration scanning, stabilization and legacy
facades. Some external modules still receive compatibility scanner ports for
`@register_router`, `@register_tool` and related tags. A bare `logos` package is
therefore not yet the final capability-free launcher.

The boundary and remaining work are documented in
[docs/architecture.md](docs/architecture.md). The module protocol is in
[docs/modules.md](docs/modules.md).

## Runtime modules

A runtime capability is an ordinary package with this public shape:

```js
export function createRuntimeModule(host) {
  return {
    name: 'example',
    phase: 'wire',
    after: [],
    install() {
      host.on('package:wiring', ({ pkg }) => {
        host.log(`[example] wiring ${pkg.folder}`);
      });
    },
  };
}
```

The real packages currently live next to Lógos under `packages/modules/` and
own capabilities such as HTTP, hooks, tools and Svelte. Libraries that do not
export `createRuntimeModule` are not installed as runtime capabilities.

## Generic declarations

Lógos can transport arbitrary registration metadata without knowing its
meaning:

```js
/**
 * @register example action
 * @option first
 */
export function action(input) {
  return input;
}
```

During package wiring the launcher emits `register:example` with a
JSON-compatible declaration and the callable separately. A module may subscribe
to that type and define its semantics. The legacy, capability-specific
decorators remain available only as a compatibility surface while their
modules migrate to this protocol.

Application authors should use the host documentation, not this repository, for
route, tool, hook or view syntax. For ThinkIac, see
[ThinkIac decorators](../../../docs/decorators.md).

## Development

```bash
npm run build
npm test
```

See [docs/testing.md](docs/testing.md) for the focused launcher checks and
[CONTRIBUTING.md](CONTRIBUTING.md) for the boundary contributors must preserve.

## License

MIT. See [LICENSE](LICENSE).
