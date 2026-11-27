
## Event delegation

The host maintains a frozen chain of caller, provider, event and operation
frames for in-process bus delivery. The chain follows asynchronous work and
survives switching to the provider's package identity. Payload and request
options cannot supply frames.

With delivery governance active, a nested cross-package delivery checks its
immediate caller and every upstream package caller for the destination and
operation. A direct receipt never covers delegated delivery. Version 3 package
receipts bind the delegation chain alongside the existing delivery fields.
Direct delivery continues to use version 2 receipts. A handler's flow ID is
available for tracing and cannot authorize nested delivery. Delegated approval
supports once and package scopes. Audit entries contain the host chain and the
existing payload hash.

Without delivery governance, nested requests, notifications and transformations
also check upstream callers' event authority according to their manifest modes.
The provider executes as its owner.

The isolated executor associates child-to-host events and capability requests
with an active host invocation. The host restores the invocation's original
authority before running the mediator. Concurrent invocations have separate
contexts, and the mediator rejects requests from completed, cancelled or
expired invocations. Capability providers apply their own surface permissions.
