# Phase 7H3 — transactional application mutations and audit

Work Product persistence is now exposed through application functions rather
than requiring callers to invoke the PostgreSQL store directly.

Each successful mutation records a tenant audit event through the exact same
transaction object:

- `work_product.created`
- `work_product.revision_created`
- `work_product.submitted`
- `work_product.approved`
- `work_product.rejected`
- `work_product.archived`

Reviewer/author identity is always derived from the authenticated human IAM
principal. API-key and system principals are rejected.

Audit metadata contains identifiers, revision numbers, counts and outcomes only.
It never includes Work Product content, source text, or rejection-reason prose.

The application service deliberately does not open its own transaction. Server
composition must call it inside the repository's existing tenant transaction
boundary so persistence and audit commit or roll back together.

Still pending:

- live PostgreSQL integration tests,
- actual migration application in a test database,
- RLS and role privilege verification,
- concurrent revision allocation acceptance,
- application/store live acceptance,
- generated database privilege documentation.
