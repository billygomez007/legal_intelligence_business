# Phase 7 acceptance — Work Products

Validated locally on 2026-09-22 in `legal_intelligence_business`.

Branch: `phase-7/work-products-approvals-provenance`.
Frozen base and unchanged HEAD: `26c5d27a366385a8da1fbf196f6b37bc56e067e6`.
The implementation remains uncommitted. Nothing has been pushed or merged.

## Scope

Ghana Work Products, immutable revisions and exact source-version provenance,
human approvals/rejections, tenant transactions, RLS, IAM and transactional audit.
All fixtures are synthetic. No real legal content, model provider or model
execution was added. Phase 8 has not started.

## Validation evidence

| Check                                         | Result                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Work Products unit tests                      | 346 passed across 8 files                                                                  |
| Full repository unit suite                    | 767 passed across 48 files, including migration integrity and permission-document drift    |
| Dedicated Work Products PostgreSQL acceptance | 38 passed                                                                                  |
| Full repository PostgreSQL integration suite  | 683 passed across 39 files                                                                 |
| Workspace typecheck                           | All 15 packages passed; Work Products and migrate also checked directly                    |
| Repository lint                               | Passed                                                                                     |
| Repository formatting                         | Passed                                                                                     |
| Dependency architecture rules                 | Passed                                                                                     |
| Frozen lockfile, offline, scripts disabled    | Passed; no dependency additions                                                            |
| Generated database privilege document         | Regenerated through the official database-backed generator; subsequent drift checks passed |
| Historical migrations                         | No accepted historical migration changed; migration-integrity checks passed                |

The packages expose TypeScript source and have no separate production build
script. The applicable compilation gate is workspace typechecking. These are
local results; no remote CI result or deployment is claimed.

## Database acceptance

The dedicated acceptance suite lives at
[`apps/migrate/test/work-products.integration.test.ts`](../../../apps/migrate/test/work-products.integration.test.ts).
It is at the migration composition root so it can use every owning package's
public entry point and the complete migration order without adding an ingestion
dependency to Work Products.

- A fresh empty database applies every migration in order: platform, IAM,
  audit, corpus, entitlements, workspace, knowledge, matter documents, AI tasks,
  Work Products, ingestion. Work Products migrations 1 and 2 are recorded and
  all four tables exist.
- All tenant tables retain enabled and forced RLS. Real `legalintel_app`
  tenant transactions prove populated records and history are isolated in both
  directions between two organizations. Cross-tenant mutations, history
  insertion and task attachment fail.
- The application has SELECT/INSERT on immutable history. UPDATE/DELETE are
  rejected by privileges, and actual populated-row UPDATE/DELETE attempts as
  an administrative fixture connection also hit the immutability triggers.
- Ingestion and data-ops have no Work Products schema access. PUBLIC has no
  explicit Work Products schema, table or function grants. The combined schema
  passes the repository's guardrails and privilege-document checks.
- Current and submitted revision pointers cannot target another Work Product
  or another tenant's revision.
- Two independent transactions start at a barrier and both commit. Revision
  numbers are exactly `[1, 2]`, history is retained, and the current pointer
  names a committed revision. A separate six-writer test verifies consecutive
  numbering and predecessor links.

## Review and audit acceptance

The live lifecycle creates revision 1, submits and approves it, creates revision
2 as draft, submits and rejects it with a reason, then creates revision 3 as
draft. The first approval and second rejection remain in the immutable ledger.
Stale review attempts cannot transfer approval to later revisions. Rejection
requires a reason, and archived Work Products cannot be revised or reviewed.

Authorized humans can approve and reject. API-key and system principals are
denied through the application layer. An injected `decidedBy` input does not
override the authenticated IAM user. The existing permission matrix tests
cover owner/admin/member/viewer/staff and keep permissions API-key ineligible.

All six audit actions are verified against real persisted events:

- `work_product.created`
- `work_product.revision_created`
- `work_product.submitted`
- `work_product.approved`
- `work_product.rejected`
- `work_product.archived`

Every mutation is tested with a forced transaction rollback; neither its state
change nor its audit event survives. An actual failed PostgreSQL audit insert
also rolls back the revision and provenance. Stale/denied operations leave no
false success event. Audit metadata uses an explicit key allowlist and contains
IDs, counts, kind or decision, never content, locators or rejection prose.

## Provenance and corpus rights acceptance

Tests exercise the actual database-backed source readers inside the same tenant
transaction as preparation and persistence:

- A Firm Knowledge reference retains its exact older immutable version even
  after a newer version exists.
- A Matter Document reference persists its exact version within the authorized
  matter; a task without that matter boundary cannot use it.
- Foreign-tenant, archived-parent, missing-version, stale-task-scope and
  cancelled-task references fail before durable revision/audit persistence.
- A synthetic Ghana corpus version passes the valid pending-review, metadata
  verification, provenance-attestation, approval and publication sequence,
  using the existing corpus test helpers and separate reviewer/publisher.
- Its stable legal-document ID and exact version ID persist unchanged.
- Removing AI-processing permission while retaining display/search permission
  denies subsequent use. Revoking rights also denies use.

The rights call remains exactly
`corpus.source_allows(dv.source_id, 'ai_processing')`; the database evaluates
time and effective rights internally. No timestamp argument was introduced.

## Repairs made during acceptance

1. Live inserts exposed `chr(0)` CHECK expressions that rejected valid text.
   Forward migration `0002_text_constraints.sql` replaces only those three
   expressions. PostgreSQL rejects null bytes natively; live regressions verify
   this for revision content, provenance locators and review reasons. Migration
   `0001_work_products.sql` was preserved.
2. Work Products database operations now discard driver diagnostics that could
   contain rejected row content. Errors retain only a fixed message and safe
   SQLSTATE, without driver detail or cause. A live constraint-error test proves
   private content is absent from the exposed error.
3. The store port now takes a generic transaction type, following the existing
   repository architecture instead of importing the database from a port.
4. Lint and formatting were resolved without removing runtime authorization,
   Ghana-boundary or source validation checks. Async unit-test doubles remain
   deterministic and no test coverage was removed.
5. The database privilege document was generated from the migrated catalog.

## Server composition boundary

This package provides server-side domain/application/store building blocks,
not a public request handler. IAM contexts, stores, prior revision state and
source-reader implementations must be server-resolved. Low-level store writes
and `appendPersistentWorkProductRevision` consume prepared, authorized inputs;
they must not be exposed as raw request-body persistence.

Call source preparation and persistence inside the same existing tenant
transaction. For a subsequent revision, acquire the aggregate row lock before
resolving/preparing its predecessor state so the revision fingerprint agrees
with the serialized allocation. The PostgreSQL store also locks the aggregate
before allocating a revision number. No tenant-transaction bypass or alternate
task-scope identity was introduced.

## Reproduction

From the repository root, with the existing local PostgreSQL service available:

```sh
pnpm --filter @legalintel/work-products test
pnpm test
pnpm test:integration
pnpm typecheck
pnpm lint
pnpm format:check
pnpm depcruise
pnpm install --frozen-lockfile --lockfile-only --offline --ignore-scripts
```

To deliberately regenerate the reviewed database privilege document, use its
official generator, then inspect the resulting diff:

```sh
UPDATE_DOCS=1 pnpm exec vitest run --project integration apps/migrate/test/all-sets.integration.test.ts
```

The supplied Phase 7 acceptance checklist is satisfied locally. Phase 8 remains
unstarted pending its scope; this record does not authorize a push or merge.
