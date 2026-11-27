
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

Without delivery governance, nested response requests also check the upstream
callers' event request authority according to their manifest modes. The
provider still executes as its owner. This contract covers work carried by
the in-process event bus. The isolated module's independent child-to-host
messages and authority on other surfaces require their own mediation.
