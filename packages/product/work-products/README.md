# Work Products — Phase 7

Server-side Work Products for Ghana legal workflows: immutable content
revisions, exact source-version provenance, human approvals/rejections, tenant
isolation and same-transaction audit.

See [Phase 7 acceptance](PHASE7_ACCEPTANCE.md) for validation evidence, fixes,
commands and the server-composition boundary. Earlier `PHASE7*.md` increment
notes describe their historical implementation state.

## Package boundaries

- Domain policy binds an approval or rejection to one exact submitted revision.
  A newer revision starts as draft without deleting prior decisions.
- Source readers authorize the current AI Task scope by organization, task ID
  and scope revision. Firm Knowledge and Matter Documents stay tenant-scoped;
  Ghana corpus sources require current `ai_processing` rights.
- Provenance preserves the exact source ID, immutable version ID and locator.
  The corpus source ID is the stable legal-document ID.
- PostgreSQL stores the aggregate, immutable revisions, provenance and review
  ledger. Aggregate locking serializes revision allocation.
- Application mutations derive actor identity from a server-resolved IAM
  context and write content-free audit events through the same transaction.
- All Work Product operations are human-authenticated. Review permissions are
  granted to owners/admins; members can create/read/revise/submit, viewers can
  read, and staff receive no grants from this contribution. Permissions are not
  API-key eligible.

## Integration

Use the existing tenant transaction boundary. Authenticate and resolve IAM,
authorize source references and prepare content, then persist and audit within
that transaction. For subsequent revisions, lock the aggregate before loading
and preparing previous revision state. Never accept IAM context, prepared
hashes, prior state or source-reader implementations from a request body.

The store and persistence functions are internal building blocks that consume
trusted server-prepared data. They are not public request validators. Database
errors are redacted; returned Work Product content remains private tenant data
and must not be logged.

## Checks

```sh
pnpm --filter @legalintel/work-products check
pnpm exec vitest run --project integration apps/migrate/test/work-products.integration.test.ts
```

The live suite runs at the migration composition root and uses only synthetic
fixtures in disposable PostgreSQL databases. It includes all three source types,
rights revocation, two-tenant isolation, privileges, immutable history, pointer
integrity, concurrent writers, review lifecycle and transactional audit.
