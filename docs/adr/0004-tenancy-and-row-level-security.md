# ADR-0004: Tenant isolation with restrictive row-level security

- Status: Accepted
- Date: 2026-09-19
- Stage: 2

## Context

`AGENTS.md` makes one rule non-negotiable: **private tenant documents must never leak across tenants.** Law firms will judge the product on this. A design that depends on every query remembering a `WHERE organization_id = ?` fails the first time someone forgets, and nothing in review reliably notices a missing clause.

## Decision

Shared database, shared schema, `organization_id` on every tenant-owned row, **isolation enforced by the database**:

1. **Context is set per transaction**: `set_config('app.org_id', …, true)` inside `withTenantTransaction`. It is local to the transaction, so it cannot leak to the next borrower of a pooled connection and works behind a transaction-mode pooler. `withPublicTransaction` sets an explicitly empty context for shared-corpus reads.
2. **It fails closed.** `app.current_org_id()` returns `NULL` when the setting is missing, blank or malformed, so a forgotten or corrupt context matches no rows. The identifier is also re-validated in TypeScript before any query runs.
3. **The tenant policy is `RESTRICTIVE`** (`FOR ALL TO PUBLIC`, in both `USING` and `WITH CHECK`). Restrictive policies are ANDed with every other policy, so a later permissive policy, such as a careless `USING (true)`, cannot widen access. A permissive-only design is one such policy away from a leak; the tests demonstrate that it leaks.
4. **`ENABLE` and `FORCE` row-level security**, so the owner is subject to it too.
5. **One helper defines all of this** — `app.enable_tenant_rls(table)` — so the pattern is not retyped, slightly differently, per table.
6. **Foreign keys between tenant tables are composite `(organization_id, id)`.** Referential-integrity checks bypass RLS: with a plain foreign key, tenant B can attach a row to tenant A's record by guessing its id, and gets a different error depending on whether the id exists. The tests demonstrate both.
7. **Uniqueness is per tenant**, so constraint errors cannot reveal that another tenant holds a value.
8. **Views over tenant data are `security_invoker`; materialized views over tenant data are forbidden** (they cannot enforce RLS).
9. **Runtime roles never hold `TRUNCATE`, `TRIGGER` or `REFERENCES`.** `TRUNCATE` is not subject to RLS.
10. **The application refuses to start on an over-privileged connection.** `assertRuntimeRoleIsConstrained` rejects a superuser, a `BYPASSRLS` role, a role that can create roles or databases, or a role that owns tables. A wrong `DATABASE_URL` would otherwise disable isolation silently while every functional test still passed.
11. **Guardrail tests read the catalog and fail the build** if any table with `organization_id` lacks forced RLS or the restrictive policy, has a non-composite tenant foreign key, is referenced by a shared table, or sits under a non-invoker view; if a `SECURITY DEFINER` function does not pin `search_path`; or if a runtime role is unsafe. Each rule is proven to fire on a deliberately bad schema. Exceptions are an explicit, reviewable list with a written reason.

## Consequences

- Adding a tenant table is: create it with `organization_id uuid NOT NULL`, composite unique key, call `app.enable_tenant_rls()`, grant explicit privileges. Forgetting any step fails CI.
- Application code cannot forget the tenant: the only supported route to tenant tables is the transaction helper, and the unsupported route returns nothing.
- Weakening the design is detected: replacing `RESTRICTIVE` with `PERMISSIVE` breaks 15 isolation tests; removing `FORCE` breaks the forced-RLS test and guardrail.

## Known limits — what this does not protect against

- **SQL injection.** Any statement running as the application role can call `set_config('app.org_id', …)` and change tenant. RLS bounds the damage of *logic errors*; it is not a defence against injected SQL. Mitigation is parameterized queries only, raw SQL confined to adapters, and review. A stronger option, if warranted, is a signed tenant context verified by a `SECURITY DEFINER` function.
- **Guardrails check structure, not intent.** They prove every tenant table has the standard policy; they cannot judge whether an *additional* permissive policy grants something it should not.
- **Performance.** Every tenant query carries a policy predicate. `organization_id` must lead tenant indexes. Revisit with real load; denormalised visibility columns are the usual escape hatch.
- **Session features.** Advisory locks, `LISTEN`, temporary tables and prepared statements do not survive transaction-mode pooling and are not available through the helper.
- **Users belong to many organizations**, so `iam.users` is global and needs deliberate handling (Stage 3).
- **Privileged staff and the migrator** can read tenant data. Access to those credentials is an operational control (Stage 10), not a database one.

## Growth path

Because all tenant access goes through one helper, a tenant that demands physical isolation (a firm, a regulator) can be moved to a dedicated database later without changing application code. Schema-per-tenant was rejected: N× migration cost, catalog bloat and no stronger guarantee than the above.

## Alternatives considered

- **Application-layer filtering only.** Rejected: one missed `WHERE` leaks everything.
- **Permissive single-policy RLS.** Rejected: see decision 3.
- **Database or schema per tenant from day one.** Rejected as premature; retained as an upgrade path.
