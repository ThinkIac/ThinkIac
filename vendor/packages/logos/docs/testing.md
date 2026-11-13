# Testing Lógos

Run the package suite from this directory:

```bash
npm run build
npm test
```

The full suite still contains compatibility coverage for runtime behavior that
has not yet left the package. For the launcher reform, the highest-signal tests
are:

- `external-module-discovery.test.ts`: runtime modules are discovered by their
  exported factory, while ordinary libraries are ignored;
- `declarations.test.ts`: registration metadata is generic, repeatable and
  JSON-compatible;
- `declaration-events.test.ts`: metadata and its callable are delivered to the
  module-owned `register:<type>` event;
- `logos-dependencies.test.ts` and lifecycle/container tests: module ordering
  and failure behavior remain deterministic during extraction.

Each capability moved out of Lógos must gain tests in its external package.
Keeping only an old Lógos test is not evidence that the external module owns
the behavior. Conversely, compatibility tests should be removed from Lógos
only after the import or fallback they protect has actually been removed.

Use real temporary fixture packages for scanner tests because discovery reads
both source comments and exported functions. Redirect state to temporary
directories and never change `HOME` or a developer workspace from a test.
