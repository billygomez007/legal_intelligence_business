# Phase 2 — Authorized Jurisdictions Architecture Proposal

Date: 2026-09-21

Status: PROPOSAL ONLY — NOT IMPLEMENTED

This document defines the intended Phase 2 boundary for Law Afrique authorized
research jurisdictions.

It deliberately does not introduce a migration, schema change, HTTP API,
retrieval engine, Matter model, Firm Knowledge model, or private-document model.

---

## 1. Verified current state

The repository already has a canonical legal-jurisdiction registry:

`corpus.jurisdictions`

Jurisdiction is first-class and mandatory in the public legal corpus.

The database already structurally enforces jurisdiction consistency between:

- jurisdictions
- courts
- sources
- legal documents
- document versions
- case details

Existing integration tests prove that a court, source, document or version
cannot be silently attached across jurisdictions.

The existing corpus jurisdiction model MUST remain canonical.

Phase 2 must not create a second jurisdiction registry.

The repository currently has:

- no organization-to-jurisdiction entitlement table
- no jurisdiction lifecycle/status implementation
- no real Matter implementation
- no retrieval engine
- no Firm Knowledge implementation
- no private legal-document retrieval implementation

Those later domains must not be implemented as part of Phase 2.

---

## 2. Phase 2 objective

Phase 2 answers exactly one authorization question:

> Which canonical legal jurisdictions may this organization use for Law Afrique research?

The result must be:

- durable
- tenant-isolated
- auditable
- revocable
- compatible with future Matters
- compatible with future authorized retrieval
- independent of client-supplied jurisdiction claims

Phase 2 does not itself perform legal retrieval.

---

## 3. Recommended ownership

### Recommended package/schema owner

The organization-to-jurisdiction relationship should be introduced by the
legal corpus migration set rather than IAM.

Reason:

Migration-set ordering is currently:

1. platform
2. iam
3. audit
4. corpus
5. ingestion

IAM migrations are explicitly forbidden from referencing later corpus objects.

An IAM-owned table that has a foreign key to `corpus.jurisdictions` would violate
the migration dependency direction.

The corpus migration set may already reference IAM and is therefore capable of
safely linking:

`iam.organizations`

to:

`corpus.jurisdictions`

without reversing migration dependency order.

The relationship should therefore be owned by the corpus migration set unless
a future dedicated policy/entitlement module is intentionally introduced after
corpus.

Phase 2 should not create such a new module merely for abstraction.

---

## 4. Proposed logical table

Recommended logical table:

`corpus.organization_jurisdictions`

Purpose:

Tenant-owned authorization boundary stating that an organization is currently
authorized to conduct research within one canonical corpus jurisdiction.

Proposed columns:

- `id uuid`
- `organization_id uuid NOT NULL`
- `jurisdiction_id uuid NOT NULL`
- `status text NOT NULL`
- `granted_at timestamptz NOT NULL`
- `granted_by uuid NULL`
- `revoked_at timestamptz NULL`
- `revoked_by uuid NULL`
- `created_at timestamptz NOT NULL`
- `updated_at timestamptz NOT NULL`

Exact ID and timestamp conventions must follow existing repository standards
during implementation.

No jurisdiction name, code, country name, court information or other canonical
jurisdiction metadata should be duplicated into this table.

---

## 5. Identity and uniqueness

Recommended identity model:

Use a normal branded UUID `id` following existing repository conventions.

Also enforce:

`UNIQUE (organization_id, jurisdiction_id)`

This supports:

- tenant-owned row identity
- future references from Matter/policy records
- safe composite tenant references
- one current entitlement state per organization/jurisdiction pair

The row should not be hard-deleted during normal operation.

---

## 6. Entitlement lifecycle

Recommended lifecycle:

- `active`
- `revoked`

An entitlement begins active.

Revocation should update the existing entitlement row:

- status → revoked
- revoked_at populated
- revoked_by populated where an actor exists

Reauthorization should reactivate the same logical entitlement row:

- status → active
- granted_at updated to the new grant time
- granted_by updated to the new actor
- revoked_at cleared
- revoked_by cleared

Historical grant/revoke operations must additionally be preserved by the
existing append-only audit infrastructure.

This avoids accumulating multiple active/history rows for the same
organization/jurisdiction relationship while retaining durable event history.

Hard DELETE should not be part of the normal application contract.

---

## 7. Tenant ownership

Every entitlement belongs to exactly one organization.

Required tenant field:

`organization_id`

The row must reference:

`iam.organizations(id)`

and:

`corpus.jurisdictions(id)`

The table must follow the existing tenant-table requirements:

- `organization_id uuid NOT NULL`
- `UNIQUE (organization_id, id)`
- tenant RLS enabled
- RLS forced
- current organization derived from `app.current_org_id()`
- explicit runtime grants only
- no TRUNCATE privilege
- no unrestricted cross-tenant access

Application code must never trust an organization ID from a client body.

Organization context continues to come from authenticated IAM context and the
tenant transaction.

---

## 8. RLS design

Recommended RLS behavior:

`legalintel_app`

may see rows only when:

`organization_id = app.current_org_id()`

No organization may enumerate another organization's jurisdiction entitlements.

Cross-tenant SELECT must return no row.

Cross-tenant INSERT/UPDATE must be rejected by RLS.

The entitlement table should use the existing:

`CALL app.enable_tenant_rls(...)`

pattern where compatible with the schema.

The implementation must be validated by the repository tenant guardrail suite.

---

## 9. Runtime privileges

Initial Phase 2 runtime privileges should be minimal.

Recommended default:

`legalintel_app`

- SELECT own active/revoked organization entitlement rows
- no unrestricted DELETE

Whether normal organization owners/admins may grant or revoke jurisdictions is
a product-policy decision and should not be assumed.

Until an entitlement-administration surface is intentionally designed,
grant/revoke operations should be restricted to a controlled administrative or
system provisioning path.

No new public HTTP endpoint is required for Phase 2.

---

## 10. Permission model

Phase 2 should distinguish:

### Research usage

A user who is otherwise authorized to perform research may request a
jurisdiction only if their organization has an active entitlement for it.

Holding an IAM research permission alone must never imply access to every
jurisdiction.

### Entitlement administration

Granting or revoking organization jurisdiction entitlements is separate from
using an already-authorized jurisdiction.

Phase 2 should not automatically add owner/admin grant permissions until the
administration model is explicitly approved.

---

## 11. Authorized research-jurisdiction resolver

A future application-layer resolver should conceptually perform:

1. require authenticated organization context
2. resolve the requested canonical jurisdiction
3. ensure the jurisdiction exists
4. verify the current organization has an active entitlement
5. return the canonical `JurisdictionId`
6. never trust a raw client jurisdiction ID as authorization

Conceptual interface:

`resolveAuthorizedResearchJurisdiction(context, requestedJurisdiction)`

The exact interface should follow repository application/service conventions.

The resolver must not perform retrieval.

It establishes the authorization boundary future retrieval will consume.

---

## 12. Error behavior

Existing security semantics should be preserved.

Cross-tenant resource existence must not be leaked.

Where practical:

- malformed identifiers → validation/domain error
- unknown jurisdiction → not found
- unavailable entitlement → not found or authorization-safe equivalent
- missing organization context → authorization error
- inactive organization → existing IAM organization-inactive behavior

The final implementation should use existing kernel error types rather than new
parallel error machinery.

---

## 13. Canonical jurisdiction lifecycle

The current `corpus.jurisdictions` registry has no verified active/deprecated
lifecycle implementation.

Phase 2 should not automatically modify the canonical jurisdiction table until
there is a concrete lifecycle requirement.

Organization entitlement revocation already provides the tenant-level ability
to disable a jurisdiction.

A future canonical jurisdiction lifecycle may be appropriate for globally
retired jurisdictions, but that should be a separate explicit design decision.

---

## 14. Ghana / Nigeria bootstrap

No real Ghanaian or Nigerian jurisdiction reference data is currently committed
as production corpus data.

Existing documentation explicitly prohibits inventing or committing real legal
reference data before source-rights, licensing and legal review requirements
are satisfied.

Therefore Phase 2 must not silently seed Ghana or Nigeria merely to make the
entitlement table usable.

When canonical GH/NG jurisdiction rows are approved, their introduction should
use a controlled reviewed data/bootstrap mechanism consistent with corpus
governance.

Synthetic fixtures must remain clearly synthetic and production-fenced.

---

## 15. Matter compatibility

Matter implementation belongs to Phase 3.

Phase 2 must not create Matter tables.

Future Matter jurisdiction should conceptually obey:

`matter.organization_id`

+

`matter.jurisdiction_id`

must identify a jurisdiction currently authorized to that organization.

The strongest future design should favor structural tenant/jurisdiction
integrity where practical, backed by application validation.

Exact Matter FK design should be decided when the Matter schema exists.

---

## 16. Retrieval compatibility

Authorized retrieval belongs to Phase 8.

Future retrieval should follow:

authenticated IAM context

→ requested jurisdiction

→ authorized-jurisdiction resolver

→ canonical authorized JurisdictionId

→ retrieval query constrained by that JurisdictionId

→ corpus documents/passages only from that jurisdiction

A future retriever must never simply accept a client-provided jurisdiction ID
and use it as the database filter without resolving organization authorization.

Corpus structural jurisdiction consistency alone is not authorization.

---

## 17. Audit requirements

Entitlement state and entitlement history serve different purposes.

The entitlement row stores current authorization state.

The existing append-only audit system should preserve security-relevant events:

- jurisdiction entitlement granted
- jurisdiction entitlement revoked
- jurisdiction entitlement reactivated

Audit metadata should use stable identifiers and must not duplicate legal
document contents or sensitive material.

Exact event names should follow current audit naming conventions.

---

## 18. Security invariants

Phase 2 implementation must prove:

1. Organization A cannot read organization B's entitlements.
2. Organization A cannot mutate organization B's entitlements.
3. An organization cannot authorize itself by supplying a jurisdiction ID.
4. Entitlements reference only canonical corpus jurisdictions.
5. Duplicate organization/jurisdiction rows are impossible.
6. Revoked entitlements cannot authorize research.
7. Reauthorization follows the explicit lifecycle.
8. Inactive organizations remain unusable.
9. Suspended/deleted users remain unusable.
10. Stale/revoked API keys remain unusable.
11. Tenant RLS remains the database enforcement wall.
12. Application authorization remains an independent enforcement wall.
13. Future Matter creation cannot bypass organization jurisdiction policy.
14. Future retrieval cannot bypass organization jurisdiction policy.

---

## 19. Migration ownership

If approved, the schema change should be introduced as the next forward-only
migration in the corpus migration set.

Existing accepted migrations must never be edited.

The new migration must satisfy:

- migration sequence integrity
- migration checksum/history rules
- migration-set dependency rules
- database guardrails
- tenant RLS checks
- runtime privilege checks
- integration-test reapplication checks

No destructive migration should be needed.

---

## 20. Proposed implementation slices

### Phase 2A — Persistence

Add the organization-jurisdiction entitlement table.

Include:

- foreign keys
- uniqueness
- lifecycle constraints
- RLS
- runtime privileges
- integration tests

Do not add retrieval.

### Phase 2B — Store and domain model

Add typed entitlement IDs/types where justified.

Add store operations for:

- list current organization's entitlements
- resolve active entitlement
- controlled grant/revoke/reactivate operations

No HTTP API.

### Phase 2C — Authorized jurisdiction resolver

Add application-layer resolution of:

organization context

+

requested canonical jurisdiction

+

active entitlement

No search/retrieval implementation.

### Phase 2D — Audit integration

Record grant/revoke/reactivation through existing audit infrastructure.

### Phase 2E — Full security/regression validation

Run:

- unit tests
- PostgreSQL integration tests
- migration guardrails
- IAM tests
- corpus integrity tests
- ingestion regression tests
- typecheck
- lint
- dependency checks
- diff checks

---

## 21. Explicitly deferred

Not part of Phase 2:

- Clients
- Matters
- Matter access
- Matter Documents
- Firm Knowledge
- OCR
- private ingestion
- embeddings
- vector search
- hybrid retrieval
- AI Employees
- AI task runtime
- work products
- legal-answer generation
- grounded synthesis
- frontend
- billing/subscriptions
- integrations

---

## 22. Approval gates

Before creating a migration, approve:

1. corpus ownership of the organization-jurisdiction entitlement relationship
2. UUID entitlement row plus unique organization/jurisdiction pair
3. active/revoked lifecycle
4. no normal hard DELETE
5. audit-backed history
6. tenant RLS
7. no ordinary user entitlement administration yet
8. no GH/NG production bootstrap yet
9. no canonical jurisdiction lifecycle change yet
10. no Matter or retrieval implementation in Phase 2

Only after these are accepted should Phase 2A begin.
