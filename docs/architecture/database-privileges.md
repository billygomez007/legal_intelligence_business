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
| `corpus` | USAGE |
| `graph` | USAGE |
| `iam` | USAGE |

### table

| Object | Privileges |
| --- | --- |
| `audit.events` | INSERT, SELECT |
| `audit.platform_events` | INSERT |
| `corpus.case_details` | SELECT |
| `corpus.court_lineage` | SELECT |
| `corpus.courts` | SELECT |
| `corpus.jurisdictions` | SELECT |
| `corpus.legal_documents` | SELECT |
| `corpus.legislation_details` | SELECT |
| `corpus.passages` | SELECT |
| `graph.citations` | SELECT |
| `graph.relationship_types` | SELECT |
| `iam.api_keys` | INSERT, SELECT |
| `iam.memberships` | INSERT, SELECT |
| `iam.organizations` | SELECT |
| `iam.platform_role_assignments` | SELECT |
| `iam.role_assignments` | DELETE, INSERT, SELECT |
| `iam.users` | SELECT |

### column

| Object | Privileges |
| --- | --- |
| `corpus.document_versions.acquired_at` | SELECT |
| `corpus.document_versions.content_checksum` | SELECT |
| `corpus.document_versions.created_at` | SELECT |
| `corpus.document_versions.document_id` | SELECT |
| `corpus.document_versions.id` | SELECT |
| `corpus.document_versions.jurisdiction_id` | SELECT |
| `corpus.document_versions.language` | SELECT |
| `corpus.document_versions.lifecycle_state` | SELECT |
| `corpus.document_versions.published_at` | SELECT |
| `corpus.document_versions.source_id` | SELECT |
| `corpus.document_versions.source_reference` | SELECT |
| `corpus.document_versions.supersedes_version_id` | SELECT |
| `corpus.document_versions.version_number` | SELECT |
| `corpus.sources.id` | SELECT |
| `corpus.sources.jurisdiction_id` | SELECT |
| `corpus.sources.kind` | SELECT |
| `corpus.sources.name` | SELECT |
| `corpus.sources.reference` | SELECT |
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
| `corpus.source_allows()` | EXECUTE |
| `iam.create_organization()` | EXECUTE |
| `iam.provision_user()` | EXECUTE |
| `iam.resolve_identity()` | EXECUTE |

## legalintel_ingest

### schema

| Object | Privileges |
| --- | --- |
| `app` | USAGE |
| `audit` | USAGE |
| `corpus` | USAGE |
| `graph` | USAGE |

### table

| Object | Privileges |
| --- | --- |
| `audit.platform_events` | INSERT |
| `corpus.case_details` | INSERT, SELECT, UPDATE |
| `corpus.court_lineage` | SELECT |
| `corpus.courts` | SELECT |
| `corpus.document_versions` | INSERT, SELECT |
| `corpus.jurisdictions` | SELECT |
| `corpus.legal_documents` | INSERT, SELECT |
| `corpus.legislation_details` | INSERT, SELECT, UPDATE |
| `corpus.lifecycle_transitions` | SELECT |
| `corpus.passages` | DELETE, INSERT, SELECT, UPDATE |
| `corpus.sources` | SELECT |
| `graph.citations` | INSERT, SELECT |
| `graph.relationship_types` | SELECT |

### column

| Object | Privileges |
| --- | --- |
| `corpus.document_versions.lifecycle_state` | UPDATE |

### function

| Object | Privileges |
| --- | --- |
| `app.current_org_id()` | EXECUTE |
| `app.current_user_id()` | EXECUTE |
| `corpus.source_allows()` | EXECUTE |

## legalintel_dataops

### schema

| Object | Privileges |
| --- | --- |
| `app` | USAGE |
| `audit` | USAGE |
| `corpus` | USAGE |
| `graph` | USAGE |

### table

| Object | Privileges |
| --- | --- |
| `audit.platform_events` | INSERT, SELECT |
| `corpus.case_details` | INSERT, SELECT, UPDATE |
| `corpus.court_lineage` | INSERT, SELECT |
| `corpus.courts` | INSERT, SELECT |
| `corpus.document_versions` | SELECT |
| `corpus.jurisdictions` | INSERT, SELECT |
| `corpus.legal_documents` | SELECT |
| `corpus.legislation_details` | INSERT, SELECT, UPDATE |
| `corpus.lifecycle_transitions` | SELECT |
| `corpus.passages` | SELECT |
| `corpus.source_rights_decisions` | INSERT, SELECT |
| `corpus.sources` | INSERT, SELECT |
| `graph.citations` | INSERT, SELECT |
| `graph.relationship_types` | SELECT |

### column

| Object | Privileges |
| --- | --- |
| `corpus.document_versions.approved_at` | UPDATE |
| `corpus.document_versions.approved_by` | UPDATE |
| `corpus.document_versions.lifecycle_state` | UPDATE |
| `corpus.document_versions.published_at` | UPDATE |
| `corpus.document_versions.published_by` | UPDATE |
| `corpus.document_versions.withdrawal_reason` | UPDATE |
| `corpus.document_versions.withdrawn_at` | UPDATE |
| `corpus.legal_documents.title` | UPDATE |
| `graph.citations.review_status` | UPDATE |
| `graph.citations.reviewed_at` | UPDATE |
| `graph.citations.reviewed_by` | UPDATE |

### function

| Object | Privileges |
| --- | --- |
| `app.current_org_id()` | EXECUTE |
| `app.current_user_id()` | EXECUTE |
| `corpus.source_allows()` | EXECUTE |
