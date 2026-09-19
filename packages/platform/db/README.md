# @legalintel/db

Database foundation: migration runner, role model, tenant transactions and the integration-test harness. Design: [ADR-0003](../../../docs/adr/0003-postgresql-migrations-and-roles.md), [ADR-0004](../../../docs/adr/0004-tenancy-and-row-level-security.md).

## Local setup

```bash
docker compose -f infra/docker-compose.yml up -d      # PostgreSQL 16 + pgvector on 127.0.0.1:54320
cp .env.example .env
pnpm --filter @legalintel/db db:setup                 # create roles, create database, migrate
```

Other commands (run from the repo root):

| Command                                      | Purpose                                       |
| -------------------------------------------- | --------------------------------------------- |
| `pnpm --filter @legalintel/db db:migrate`    | apply pending migrations as the migrator      |
| `pnpm --filter @legalintel/db db:status`     | applied / pending / drifted; exits 1 on drift |
| `pnpm --filter @legalintel/db db:test:clean` | drop test databases and cached templates      |
| `pnpm test:integration`                      | integration tests against a real PostgreSQL   |

Integration tests connect to `TEST_DATABASE_ADMIN_URL` (default `postgres://postgres:postgres@127.0.0.1:54320/postgres`). Each test file gets its own database cloned from a template that already has migrations applied.

## Roles

| Role                  | Used by            | Can                                               | Cannot                               |
| --------------------- | ------------------ | ------------------------------------------------- | ------------------------------------ |
| `legalintel_migrator` | deploy pipeline    | own and alter the schema                          | be used by a running service         |
| `legalintel_app`      | end-user API       | read published corpus; read/write own tenant data | bypass RLS, alter schema, `TRUNCATE` |
| `legalintel_ingest`   | ingestion workers  | write draft corpus content                        | read tenant data, publish            |
| `legalintel_dataops`  | review back office | review and publish corpus content                 | read tenant data                     |

## Using tenant data from code

```ts
import { withTenantTransaction } from '@legalintel/db';

await withTenantTransaction(pool, { organizationId, userId }, async (tx) => {
  await tx.query('SELECT * FROM workspace.projects'); // only this organization's rows
});
```

Reading the shared corpus uses `withPublicTransaction`. Call `assertRuntimeRoleIsConstrained(pool)` at process start.

## Adding a migration

1. Add `migrations/NNNN_snake_case.sql` with the next number. Never edit an applied migration.
2. Destructive statements need `-- migrate:allow-destructive: <reason>`.
3. Run `pnpm test:integration`. The guardrail tests run against the migrated schema.

## Adding a tenant-owned table (checklist)

1. `organization_id uuid NOT NULL`, and `UNIQUE (organization_id, id)`.
2. Foreign keys to other tenant tables are composite: `(organization_id, x_id) REFERENCES x (organization_id, id)`.
3. `CALL app.enable_tenant_rls('schema.table');`
4. Grant only the privileges the role needs, explicitly. Never `TRUNCATE`, `TRIGGER` or `REFERENCES`.
5. Views over it use `WITH (security_invoker = true)`. No materialized views.

If you forget a step, `guardrails.integration.test.ts` fails and names the table and the rule.
