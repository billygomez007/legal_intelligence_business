# Database privileges

<!-- Generated from the migrated schema. Do not edit by hand; run `UPDATE_DOCS=1 pnpm test:integration`. A test fails if this file is stale. -->

What each runtime database role may do, read from the catalog after all migrations. Tenant tables additionally apply row-level security (see ADR-0004): a privilege here is the ceiling, RLS narrows it to the current organization. `legalintel_migrator` owns every object and is not listed; it belongs to the deploy pipeline only.

Reviewing a migration? A change to this file is a change to what a role can do.

## legalintel_app

### schema

| Object | Privileges |
| --- | --- |
| `app` | USAGE |
| `audit` | USAGE |
| `iam` | USAGE |

### table

| Object | Privileges |
| --- | --- |
| `audit.events` | INSERT, SELECT |
| `audit.platform_events` | INSERT |
| `iam.api_keys` | INSERT, SELECT |
| `iam.memberships` | INSERT, SELECT |
| `iam.organizations` | SELECT |
| `iam.platform_role_assignments` | SELECT |
| `iam.role_assignments` | DELETE, INSERT, SELECT |
| `iam.users` | SELECT |

### column

| Object | Privileges |
| --- | --- |
| `iam.api_keys.last_used_at` | UPDATE |
| `iam.api_keys.revoked_at` | UPDATE |
| `iam.memberships.status` | UPDATE |
| `iam.memberships.updated_at` | UPDATE |
| `iam.organizations.name` | UPDATE |
| `iam.organizations.updated_at` | UPDATE |
| `iam.users.display_name` | UPDATE |
| `iam.users.updated_at` | UPDATE |

### function

| Object | Privileges |
| --- | --- |
| `app.current_org_id()` | EXECUTE |
| `app.current_user_id()` | EXECUTE |
| `iam.create_organization()` | EXECUTE |
| `iam.provision_user()` | EXECUTE |
| `iam.resolve_identity()` | EXECUTE |

## legalintel_ingest

### schema

| Object | Privileges |
| --- | --- |
| `app` | USAGE |
| `audit` | USAGE |

### table

| Object | Privileges |
| --- | --- |
| `audit.platform_events` | INSERT |

### function

| Object | Privileges |
| --- | --- |
| `app.current_org_id()` | EXECUTE |
| `app.current_user_id()` | EXECUTE |

## legalintel_dataops

### schema

| Object | Privileges |
| --- | --- |
| `app` | USAGE |
| `audit` | USAGE |

### table

| Object | Privileges |
| --- | --- |
| `audit.platform_events` | INSERT, SELECT |

### function

| Object | Privileges |
| --- | --- |
| `app.current_org_id()` | EXECUTE |
| `app.current_user_id()` | EXECUTE |
