# Phase 7H1 — durable Work Products database layer

This increment introduces the Work Products-owned PostgreSQL schema but does
not register or execute its migration yet.

Tables:

- `work_products.work_products` — mutable aggregate/current-state pointer.
- `work_products.revisions` — immutable content snapshots.
- `work_products.revision_provenance` — immutable exact source/version references.
- `work_products.reviews` — immutable human approval/rejection history.

Every table is organization-scoped and uses the repository tenant-RLS helper.
The application role receives only SELECT/INSERT on immutable history.
Ingestion and data-ops receive no Work Products privileges.

Revision creation locks the aggregate before allocating the next revision number.
A new revision resets aggregate review state to draft while preserving historical
review rows.

This store intentionally does not write audit events. The application service
must combine store mutation plus `recordAuditEvent` in the same tenant transaction.

Pending:

- application mutation services,
- transactional audit events,
- human-only review persistence integration,
- migration composition registration,
- real PostgreSQL/RLS tests,
- concurrent revision database test,
- generated database privileges update.
