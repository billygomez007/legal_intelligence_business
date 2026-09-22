# Phase 7D - workspace package registration

Work Products has its own manifest, TypeScript configuration, and unit-test
configuration. Package dependencies reuse the existing AI Tasks declarations.

From the repository root:

    pnpm --filter @legalintel/work-products run check

No temporary compiler aliases or temporary checker files are needed by that
command. Existing Phase 7A-C source files and the 180 unit tests are preserved.
Integration tests are excluded from this unit-only command.

Not yet complete: database tables/migrations, production source-reader adapter,
transactional audit, RLS, application permission registration, and HTTP/UI wiring.
A passing package check is not proof of database isolation or production readiness.
Root CI and the full repository test suite must also pass before acceptance.
