# Contributing to ThinkIac

## Before opening a change

1. Create a branch from `main`.
2. Keep changes focused and preserve existing package behavior.
3. Do not add credentials, device records, session data, databases, uploads, or
   generated artifacts.
4. Run the checks relevant to the modified area. At minimum, run:

   ```bash
   npm run test:runner
   ```

5. Describe the behavior changed, validation performed, and any runtime impact
   in the pull request.

## Packages

Packages live in `packages/`; runtime capabilities are vendored under
`vendor/packages/modules/`. Follow the declaration reference in
[`docs/decorators.md`](docs/decorators.md) and the workspace conventions in
[`AGENTS.md`](AGENTS.md).

## Security

Follow [SECURITY.md](SECURITY.md) for a suspected vulnerability. Do not report
security issues in public issues or pull requests.
