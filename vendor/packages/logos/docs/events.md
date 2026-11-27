
## Typed response declarations

A local `.type` package can declare `response compose = (message: string):
string ->`, with one `@extensions before`, `@extensions transform`, or
`@extensions after` directive per enabled phase. Another package can declare
`extensionHook customize = transform agent::response:compose ({result}, context)
->`. Call the provider through `events.requestResponse` with its canonical
identity and an object containing the named arguments.

The provider owns its namespace and uses the event publish grant. Invocation
uses the request grant and the active call policy. Observation uses subscribe,
and transformation uses transform. With delivery governance enabled, the
request and each extension phase have their own delivery decisions. A denied
hook is skipped.

Before runs on projected inputs, before CoffeeScript applies defaults. Transform
receives the current result and can return a replacement that satisfies the
provider's output contract. Undefined keeps the current result, and null is a
replacement when the contract accepts it. After sees the final result.
Observers receive detached data and their return values are discarded.
Observers have no veto return value. A thrown hook error rejects the request.
All phases share the request's cancellation signal and deadline.

Hooks with equal priority run in registration order. Each package may declare
one hook per target and phase. Reload replaces declarations transactionally
and restores the previous generation on rollback. Hooks receive a separate
host context with the event, signal and optional flow ID. The flow ID is
correlation data. Packages running out of process cannot register these
declarations until the runner can transport request context and cancellation.

## Event authorization

The bus resolves invocation names with the caller's active contract when
available. A package with a `$` list can invoke its own namespace and the
exact external names in that list. This applies to both typed response entry
points. A package without `$` retains its legacy event names. The legacy
`"$": "*"` removes the caller's list restriction. With governance enabled,
cross-package delivery still requires a host grant or approval.

With delivery governance disabled, the manifest authority check applies as
before. With it enabled, cross-package delivery checks the source and
recipient folder IDs, the resolved event, and the delivery operation.
Invocation, before and after observation, and transformation each have their
own operation. The host can populate `eventGovernance.grants` with objects
containing `source`, `target`, `event`, and `operation`. Use an exact event
by default. The host can explicitly set `event: "*"` for a single directed
package pair and operation. Same-package and kernel deliveries retain their
existing exemptions.

Without a matching host grant, the bus checks signed receipts and then asks
the configured approval provider. Package and flow receipts bind event,
recipient, operation, source and source manifest integrity. Flow receipts also
bind the flow ID. Version 1 receipts require renewed approval. The audit
records host grants, receipt reuse, prompt decisions and active call policy
denials without recording payload contents. An approval cannot override a
denial from an active `$` list or approve manifest expansion.
