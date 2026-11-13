# Security policy

## Supported version

Security fixes are made against the current `main` branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability and do not include
credentials, tokens, personal data, or an exploit proof in public discussion.

Use a private GitHub security advisory for the repository. Include a concise
description, affected paths or package versions, reproduction steps, impact,
and any suggested mitigation. Maintainers will acknowledge the report and
coordinate disclosure through that private advisory.

## Local secrets and runtime data

Never commit `.env` files, `.private/` directories, databases, device pairing
records, agent sessions, uploads, or generated backups. Use `.env.example` for
documenting required configuration without real values.
