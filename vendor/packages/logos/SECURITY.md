# Security policy

Report vulnerabilities privately through the repository's security reporting
channel or maintainer contact. Include the affected version, impact and a
minimal reproduction when possible.

## Boundary

Lógos launches host-selected code. Loading a module or application package is a
trust decision; the launcher protocol alone is not a sandbox. The current
compatibility kernel also runs substantial code in the host process.

Security claims for HTTP authentication, uploads, databases, vaults, tools or
process isolation belong to the external module or host that implements them.
Do not infer those protections from the presence of Lógos.

Module factories receive host ports, not authority to import launcher
internals. A module that bypasses those ports may bypass attribution, cleanup
or policy supplied by the host. Treat direct imports from `logos/src` as a
boundary violation.

The extraction itself must never create two active owners for one capability;
duplicate listeners, guards or transports can invalidate security assumptions
even when each implementation is correct in isolation.
