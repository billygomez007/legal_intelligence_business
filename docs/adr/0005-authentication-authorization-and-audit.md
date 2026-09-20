# ADR-0005: Authentication, authorization and audit

- Status: Accepted
- Date: 2026-09-19
- Stage: 3
- Amended in part by [ADR-0008](0008-integrity-hardening-stages-0-5.md): the role-assignment hierarchy (who may grant and revoke which role) is now also enforced by the database, not only by the application.

## Context

`AGENTS.md` requires that private tenant data never leaks and that AI-assisted actions are auditable. The business will sell to individuals, firms and institutions, and intends to run more than one product on this foundation, so the permission engine must not know about legal research. The identity provider is not yet chosen (docs/25 §0).

## Decision

### Identity

1. **No home-grown credentials.** Passwords, MFA, SSO and SCIM belong to an external OIDC provider, which is not yet selected. The platform stores only `(provider, subject)` identities and resolves them to users through two narrow `SECURITY DEFINER` functions.
2. **A new identity is never linked to an existing account by email.** Automatic linking lets anyone who controls an identity at any provider take over an existing account. A second identity for a known email is a `conflict` that a verified account-linking flow must resolve.
3. **Users are global; organizations are the tenants.** A person may belong to many organizations. Creating an organization takes the acting user from the transaction context, never from an argument, and the function acts *inside* the new tenant's context so row-level security still constrains what it writes.

### Authorization is three separate checks

Permissions (RBAC, this ADR), entitlements (what an organization has paid for; not yet built) and content rights (what the platform may do with a source; Stage 4). They answer different questions and are never merged into one role list.

4. **The permission catalog is composed from contributions.** The platform contributes organization administration; each product contributes its own permissions and which roles hold them. `composeCatalog` refuses: duplicate keys, malformed keys, **wildcard grants**, grants of undefined permissions, scoped permissions granted without `:own`/`:any`, and **privilege inversion** (a junior role holding something a more senior role lacks; `:any` counts as covering `:own`). Grants are explicit strings, so a reviewer can read exactly what a role can do.
5. **Deny by default.** `authorize` allows only an exact grant. `:own` requires the resource's owner to be the acting user. A resource from another organization is refused, and reported as *not found*, never *forbidden*, so the answer cannot confirm the record exists.
6. **Role assignment has its own rules.** Holding `member:assign_role` is not enough: an admin cannot grant `owner` or `admin` (they could promote themselves) and cannot remove or re-role an owner or another admin.
7. **The last active owner cannot be removed or demoted**, enforced by a database trigger that first locks the organization row, so two owners removing each other concurrently are serialised and exactly one succeeds (tested).
8. **The permission matrix is generated from code** into `docs/architecture/permissions-platform.md`, and a test fails if the file is stale. Runtime database privileges are likewise generated into `docs/architecture/database-privileges.md` from the catalog after all migrations. A change to who can do what cannot land without a reviewed diff.

### API keys

9. **Format** `lip1_<organization id>_<key id>_<256-bit secret>`. The identifiers are not secret; carrying them lets the server open the correct tenant context *before* looking anything up, so lookups run under ordinary RLS with no privileged cross-tenant query. Only the secret authenticates.
10. **Only a SHA-256 of the secret is stored.** A fast hash suffices because the secret is 256 bits of randomness, and it keeps per-request cost low. The plaintext is shown once and never stored (tested by dumping the row).
11. **A key can never do more than its issuer can do *now*.** Effective permissions are the key's scopes intersected with the issuer's *current* permissions and with what keys may hold at all. Demoting the issuer narrows their keys immediately; removing them disables the keys. Otherwise a key is a confused deputy that outlives the authority it was created with.
12. **Keys are for data access, not administration.** `apiKeyEligible` defaults to false, so no key can manage members, keys, billing or audit. A key cannot issue keys. Requesting an ineligible scope, or one beyond the issuer's own, is refused rather than silently trimmed.
13. **Every authentication failure returns the identical error** (malformed, unknown, wrong secret, revoked, expired, issuer removed, organization suspended), and the secret comparison runs against a dummy hash when no key exists, so neither the response nor its CPU cost reveals which keys exist.

### Audit

14. **Append-only, enforced twice**: runtime roles hold no `UPDATE`, `DELETE` or `TRUNCATE`, and triggers reject those statements for everyone including superusers.
15. **Recorded in the same transaction as the action**, so "it happened but was not logged" and the reverse cannot occur.
16. **Content never enters the audit trail.** Validation rejects sensitive field names at any depth (reusing the logger's deny-list), strings over 256 characters (which is what pasted content looks like), deep nesting and oversized metadata; the database bounds size as a backstop. This implements docs/17: log identifiers, not content.
17. **Two tables**: tenant events (standard RLS) and platform events (operator and pipeline actions on shared data, readable only by data-ops). Only ingestion and data-ops may write the platform log. The end-user API role cannot: it has no operator actions to record, and granting it `INSERT` would let a compromised request handler forge entries in the operator trail.
18. **Staff roles are contributed by products**, and reviewing and publishing are separate roles (separation of duties, enforced further in Stage 4).

## Consequences

- Adding a product means contributing permissions; nothing in `platform` changes.
- Sessions, JWT verification, rate limiting and account linking are the API stage (Stage 8) and the identity provider's job. None of that exists yet.
- Every mutation is written to be audited but nothing yet *calls* the audit recorder for IAM actions; wiring belongs to the API layer, where request IDs exist.

## Known limits

- **`SECURITY DEFINER` functions trust the transaction context** (`app.current_user_id()`), which any statement running as the application role can set. This is the same SQL-injection caveat as ADR-0004: parameterized queries only.
- **Timing.** Equalising hash work does not remove database-lookup timing differences or network jitter. The uniform error removes the *response* oracle; a determined timing attack on key existence is mitigated by key entropy (guessing a 256-bit secret is infeasible even if a key ID is known) and, later, rate limiting.
- **Audit integrity depends on operational control of the owner role.** A superuser can drop the triggers. A tamper-evident hash chain or an external write-once sink is a later hardening.
- **Audit entries are only as truthful as the code that writes them.** The application role can insert an event for its own organization with any `actor_id`; the database cannot verify that the named actor is the person on the request. Correctness depends on the API recording the authenticated principal.
- **`iam.create_organization` is callable by any signed-in user, any number of times,** and members are added by user id directly (no invitation-and-acceptance step yet). Abuse limits and an invitation flow belong to the API stage.
- **Colleague visibility includes former members.** `iam.users` shows an organization the profile of anyone with a membership row in it, whatever its status, so a removed member's name and email remain readable to that organization. Restricting this is a product decision (audit logs still need to resolve past actors).
- **Invitations, entitlements, custom roles and per-resource sharing are not built.** Members currently see only what their role grants; collaboration features (docs/20, Phase 2) will need resource-level access lists.
- **Email lookup for adding members is deliberately absent** to avoid a user-enumeration endpoint; membership is added by user id.

## Alternatives considered

- **Build authentication in-house.** Rejected: credential storage, MFA and SSO are a liability we should not own.
- **Hard-coded permission enums in the platform package.** Rejected: it would force the platform to know every product.
- **A single role list combining permissions, plan and content rights.** Rejected: they change for different reasons and are decided by different people.
- **`BYPASSRLS` for the definer functions.** Rejected: acting inside the tenant context keeps RLS as a second wall around even the privileged code.
