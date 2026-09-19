# ADR-0003: PostgreSQL as system of record, SQL-first forward-only migrations, four database roles

- Status: Accepted
- Date: 2026-09-19
- Stage: 2

## Context

The platform stores three kinds of data with different trust levels: a shared legal corpus, tenant-private customer material, and operational records (doc 10). The properties that matter most (tenant isolation, "no publication without approved rights", append-only audit) are enforced with row-level security, triggers, privileges and constraints. An ORM schema DSL hides exactly those features.

## Decision

1. **PostgreSQL 16+** is the system of record. Full-text search and, from Stage 6, pgvector run inside it behind a port (docs/25 §8).
2. **Migrations are plain SQL files**, `NNNN_snake_case.sql`, applied by a small in-repo runner (`@legalintel/db`) that:
   - is **forward-only** (no down migrations; a mistake is fixed by a new migration);
   - records a **SHA-256 checksum** and fails if an applied migration is edited or deleted, or if a new one is numbered below an applied version;
   - takes a **session advisory lock**, so concurrent deploys serialise (verified with three parallel runners);
   - runs each migration **in its own transaction** and rolls back completely on failure, with an explicit `-- migrate:no-transaction` opt-out for `CREATE INDEX CONCURRENTLY`;
   - sets a **DDL `lock_timeout`** so a migration fails fast instead of queueing behind live traffic and blocking every query behind it;
   - **refuses unannotated destructive statements** (`DROP TABLE/SCHEMA/COLUMN`, `TRUNCATE`, unqualified `DELETE`). A migration needs `-- migrate:allow-destructive: <reason>`, visible in the diff. This enforces doc 14: corrections must not destroy audit history;
   - applies **named sets in dependency order** (`platform`, then legal-domain sets), each owned by the package that owns the tables.
3. **Four roles, provisioned outside migrations:** `migrator` (owns objects; deploy pipeline only), `app` (end-user API), `ingest` (writes draft corpus content; no tenant access; cannot publish), `dataops` (reviews and publishes; no tenant access). Runtime roles are non-superuser, `NOBYPASSRLS`, own nothing, cannot create objects, and carry role-level `statement_timeout` (30s), `lock_timeout` (10s) and `idle_in_transaction_session_timeout` (60s). Attributes are re-asserted on every bootstrap, so drift is corrected rather than preserved.
4. **The database is hardened**: `CONNECT` is revoked from `PUBLIC` and granted only to the four roles.
5. **Development bootstrap uses published throwaway passwords, so it refuses any non-loopback host.** Production roles are provisioned by infrastructure tooling with real secrets.
6. Migrations verify prerequisites instead of assuming them: the runner refuses to start if the roles do not exist.

## Consequences

- We own roughly 300 lines of migration tooling, covered by tests including tamper, out-of-order, rollback, concurrency and lock-timeout cases. Each safety property was checked by deliberately disabling it and confirming a test fails.
- **No rollbacks.** Recovery is roll-forward, or restore from backup for data damage. Backup and restore drills are a Stage 10 deliverable.
- Trusted extensions (`citext`, `pg_trgm`, `btree_gist`) are created by migration; that needs the database to be owned by the migrator. `pgvector` is **not yet exercised**: it is not installed on the current development machine and Docker was unavailable, so the vector schema is scheduled with Stage 6. The compose file and CI use `pgvector/pgvector:0.8.6-pg16`.
- A typed query builder (Kysely, with generated types checked for drift) was **not** adopted in Stage 3. The IAM repository uses explicit SQL with typed row interfaces behind a store port; the decision is deferred until the search stage (Stage 6), where query complexity justifies it.

## Alternatives considered

- **Prisma / Drizzle schema-first.** Rejected: policies, `FORCE`, restrictive policies, triggers and role grants would live in hand-written SQL beside a schema DSL that cannot describe them, so two sources of truth would drift.
- **dbmate, Atlas, node-pg-migrate.** All viable. None gave checksum-verified history, the destructive-statement guard and multi-set ordering together. Revisit if the maintenance burden of our runner grows.
- **One database role for everything.** Rejected: a bug in an ingestion worker could then read tenant data, and a request handler could alter the schema.
