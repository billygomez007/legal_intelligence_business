# ADR-0008: Integrity hardening of Stages 0–5

- Status: Accepted
- Date: 2026-09-20
- Stage: 0–5 (foundation hardening, before the stack is merged)
- Amends: [ADR-0005](0005-authentication-authorization-and-audit.md) (who may grant roles), [ADR-0006](0006-legal-corpus-provenance-rights-and-publication.md) (succession, verification, provenance) and [ADR-0007](0007-legal-ingestion-boundaries.md) (decisions 1 and 13, and two known limits)

## Context

An independent review of Stages 0–5 (2026-09-20) found that the foundation's central properties were enforced by the database, with a handful of exceptions where an integrity rule lived only in TypeScript, in a default, or in a promise about how the pipeline would behave. None was a tenant-isolation or rights failure. Each was a place where a real legal record could enter, or be trusted, on the strength of something the database did not check:

- deployment tooling read `APP_ENV` through a schema that defaults to `development`, so a forgotten variable switched the "no synthetic fixtures in production" check off;
- "an admin may not grant owner" was checked in TypeScript only, and the runtime role could write `iam.role_assignments` directly;
- a version could be recorded as superseding a version of a different document;
- the person who requested an ingestion could approve its result;
- a version whose title, court or date was machine-extracted and never checked by a person could be approved and published;
- the corpus verified no provenance: nothing tied an approved version to evidence that anyone had checked.

The founder decided each of these (2026-09-20). This ADR records the designs, and what each one deliberately does not do. All changes are forward migrations (`iam/0002`, `corpus/0004`, `ingestion/0002`); no accepted migration was edited.

## Decision

### 1. Deployment tooling states its environment; guards fail closed

`@legalintel/config` has two schemas for `APP_ENV`. `baseEnvSchema` keeps its `development` default, which suits a developer's machine. `deployEnvSchema` has **no default** and accepts exactly `development`, `test`, `staging` or `production`. The migration entry point (`apps/migrate`) resolves the environment **first** and exits with code 2 on a missing, blank or invalid value, before any command can create roles, create a database or connect. Every future composition root whose safety checks depend on the environment must use `deployEnvSchema`.

Both guards (`assertProductionSafety`, `assertNoSyntheticInProduction`) used to return quietly for any name other than `production`. An unrecognised name is now an error. `staging` is a named, recognised environment and **may** contain synthetic fixtures; only `production` refuses them.

### 2. The role hierarchy is enforced twice

The TypeScript matrix stays, for clear errors. IAM migration `0002` enforces the same matrix in the database (`iam.role_may_assign`), so direct SQL, or a service that forgot to ask, cannot bypass it:

| Actor | May grant and revoke |
| --- | --- |
| owner | owner, admin, member, viewer |
| admin | member, viewer |
| member, viewer | nothing |

- **Who is acting** is `app.user_id` from the transaction context, the variable row-level security already trusts. No identity column was added and none is trusted. With no acting user the answer is no, including for a superuser: maintenance that changes roles must state who is acting or disable the trigger on purpose.
- **Current authority only.** A role counts only through an *active* membership held by an *active* account, so suspending either removes authority at once. Several roles give the union of what each may grant.
- A grant must name the acting user as its grantor, so the record of who granted a role cannot be forged.
- **Suspending or removing a member** is the same authority: the actor must hold a role that can grant something and be able to grant every role the target holds (`canManageMember`). One allowance: a person accepting their own invitation.
- **The first owner of a new organization** (`iam.create_organization`) is allowed by a narrow, data-derived condition (owner, to oneself, granted by oneself, in an organization with no role assignment of any kind) that cannot be used on an organization that already exists.
- The last-owner trigger keeps the final word on what the hierarchy allows.
- **One matrix, tested as one**: a parity test compares every actor/target pair, the union of several roles and `canManageMember` for every pair between TypeScript and SQL.
- No `SECURITY DEFINER` function was added. The checks run as the caller, whose row-level security already lets it read what they need.

### 3. Succession of versions is within one document

`document_versions.supersedes_version_id` now carries a composite foreign key `(supersedes_version_id, document_id) → (id, document_id)`, and a check that a version does not supersede itself. Version succession is a fact about one work. How **different** documents relate (amends, repeals, supersedes, distinguishes, cites) is a legal relationship and belongs in the citation graph, with evidence and review. The single-column key it replaces was dropped, because keeping both would make the reported constraint depend on which PostgreSQL checked first.

### 4. The requester of an ingestion cannot approve its result

The rule lives in the **ingestion** migration, on `ingestion.review_decisions`, because the requester is an ingestion fact (`ingestion.jobs.actor_id`) and the corpus must not depend on ingestion. It applies to **approval only**: a requester may still inspect, reject (withdrawing their own request) and hold, none of which can put anything in front of a user. It applies even when one person holds both permissions, because role separation alone is not separation of duties. `IngestionReview.decide` checks first, for a clear error (`ingestion.requester_cannot_approve`), and the database refuses whatever a caller does; the refusal rolls back the whole review transaction, including the corpus decision recorded a moment earlier.

### 5. Publish-critical metadata is verified by a person, field by field

```
machine extraction → value recorded in the corpus → a person verifies THAT value → the approval gate checks it
```

- **Machine extraction is untouched** and stays `unreviewed`. Verification is a separate, corpus-owned, **append-only** record, `corpus.version_field_verifications`: the version, the field, the status (`verified` or `rejected`), the fingerprint of the value the person saw, the evidence they checked, the person (`verified_by`), and a time assigned by the database. The database also writes a copy of the value, so the record explains itself. There is no flag to flip. The latest record for a field governs, so a later rejection withdraws an earlier verification.
- **Bound to the value.** The caller quotes a fingerprint (SHA-256 over the field name, a newline and the value); the database recomputes it from the corpus and refuses a stale or invented one, a field that does not apply to the document type, and a version that is not awaiting review. The field name is part of the hash, so a fingerprint cannot be moved from one field to another. If the value changes later, the verification no longer matches and must be made again.
- **What is critical depends on the kind of document, and is data**, in `corpus.critical_metadata_fields`: every document needs a title and a jurisdiction; a case also needs a court and a decision date; a neutral citation, a docket number and a legislation identifier need verifying when the corpus records one ("where applicable"). Legislation is never asked about a court. Adding a document type means adding its rows; a type with no rows is refused, never waved through.
- **The gate** (`versions_trust_gate`) runs on approval and again on publication, so an approval recorded through another path cannot be published.
- Reviewers get what they need through ingestion review: the packet lists the critical fields with the fingerprint to quote, `verifyMetadata` records a batch atomically (audited by field and outcome, never by value), and `recordCaseDetails` lets a person record the court and date a case needs, which extraction does not write.

**What this does not do.** Stage 3 decided that data-ops (people) may correct metadata on a reviewed document, while ingestion (a machine) may not. That decision stands, so metadata is **not** frozen after approval. A correction after approval simply blocks publication, because the verification was of the old value; verification is only possible while a version awaits review, so it goes back through review. An audited correction workflow is future work.

### 6. Approval requires attested provenance, without the corpus reading ingestion

The corpus cannot query ingestion tables (ingestion migrates after the corpus, and the dependency runs the other way). So it owns a record and ingestion writes it:

- `corpus.version_provenance_attestations`: append-only; the version, source, content checksum and pipeline version; an attestation type and version; a pointer to the attester's evidence; the system that attested and the person on whose request the version was acquired; a time the database assigns. A **composite foreign key** to the version's own source, checksum and pipeline version means a forged attestation naming the wrong ones cannot be recorded at all.
- **No runtime role can insert into it.** The only writer is `ingestion.attest_provenance(job)`, a `SECURITY DEFINER` function. It takes a job, requires that the job passed the hand-off gate (`pending_review`, evidence, review task and passage records in place), re-checks that the rights hold now, and **derives every value from the evidence it verified**. A caller who cannot produce valid evidence cannot produce an attestation. That is what turns "ingestion may attest only after its checks succeed" from a promise about the pipeline into a property of the database.
- A deferred constraint trigger on `ingestion.jobs` refuses to let a job end its transaction in `pending_review` without its attestation, so a pipeline that forgets fails at hand-off, not later at approval.
- The corpus gate (decision 5) requires an attestation before approval and before publication.

**This amends [ADR-0007](0007-legal-ingestion-boundaries.md) decision 1 and 13.** Ingestion no longer defines *no* `SECURITY DEFINER` function: it defines exactly one, the sole writer of the record above, and `apps/migrate` inventories seven definer functions instead of six. It remains narrow (search path pinned, static SQL, reads only ingestion tables, executable by the ingest role alone) and every one of those properties is enforced by the structural guardrails. Ingestion still installs no trigger on a corpus table.

### 7. Nothing here weakens a rights control

Rights and authorisation remain separate. Acquisition, metadata-derivation, display, search, AI and API rights are enforced exactly as before, and the attestation re-checks them at the moment it is written.

### 8. The review architecture is preserved

ingestion review transaction → corpus review decision → corpus lifecycle transition → ingestion decision mirror → audit event. The only additions are gates inside that sequence.

## Consequences

- A version now needs, to be approved: a recorded human decision (ADR-0007), verified critical metadata, an attestation of its provenance, and an approver who is not the requester. Publication needs the last three again and a different person from the approver.
- Every control was checked by removing or weakening it and confirming a test fails (the mutation record is in the pull request). Three first-pass survivors exposed test gaps (nothing tried to rewrite the rules catalogue; one refusal could not tell the table privilege from the function privilege beside it; one error mapping was reachable only through a raw-SQL forgery) and were fixed.
- Ingesting a **case** now needs a person to record its court and decision date from the source and verify them. That is intended: extraction alone is not enough to make a case a citable authority.
- Existing suites that approve versions verify and attest first through helpers, so the gates themselves are tested against real refusals.

## Known limits

- **The actor is `app.user_id`.** A session that can run arbitrary SQL can also set it (the limit ADR-0004 already states for the tenant). The hierarchy stops a service that forgot to ask, and direct SQL in the actor's own transaction; it does not stop an attacker who controls the context. API-key requests are not distinguishable from their issuer at this level: keys cannot hold `member:assign_role`, and the API layer must not present a key's issuer as the acting user for member management.
- **Authority is judged at the moment of the statement** (READ COMMITTED), as any check-then-write is. If a role is revoked concurrently with a grant by its holder, the grant may or may not be honoured, depending on which commits first. It cannot break the last-owner rule, which serialises on the organization row. It also means a refusal's reason depends on the interleaving: two owners removing each other at once end with exactly one success, and the loser is refused either by the last-owner rule or, if the winner already committed, because it is no longer an owner.
- **Inviting a member** (`iam.memberships` INSERT) is not gated by the hierarchy. A membership grants no permission by itself (permissions come from roles), but it makes the person visible to co-members. Gating it needs a decision about invitation flows.
- **Requester ≠ approver is enforced at the ingestion mirror.** A service holding the data-ops role could approve directly in the corpus and never write the mirror row; the corpus cannot see ingestion, and the founder placed the rule in ingestion. The attestation records the requester (`actor_id`), so a corpus-level check is possible if that is later wanted.
- **Two accounts held by one person** defeat requester/approver and approver/publisher separation (the database cannot know who the human is).
- **Verification proves a named person recorded a value with evidence, not that they read the source.** `evidence_reference` is free text.
- **An attestation proves ingestion's checks passed, not that the source document is authentic.** A future way of creating versions outside the pipeline (a manual upload) needs its own attestation type, added by migration.
- **No reviewer-facing API yet for the other critical fields.** `recordCaseDetails` covers what extraction does not write for cases; a legislation identifier has no entry path beyond data-ops tooling.
- **Only the migration entry point requires an explicit environment today**, because it is the only deployment entry point that exists. Future ones must use `deployEnvSchema`.
- **`staging` may contain synthetic fixtures.** Whether it must not is a policy choice recorded here, not a technical one.

## Alternatives considered

- **Let the ingest role insert attestations directly, and rely on the pipeline.** Rejected: nothing then makes an attestation depend on ingestion's checks; a compromised writer could attest anything it created.
- **Let the corpus read ingestion evidence in a trigger.** Rejected: it reverses the dependency direction and puts an ingestion invariant in the corpus.
- **Freeze reviewed metadata.** Rejected: it would silently overturn Stage 3's accepted, tested decision that people may correct it. The verification's binding to the value gives the same protection at the moments that matter.
- **Exempt the table owner from the hierarchy trigger.** Rejected: the owner is what definer functions run as, and an exemption would be a path around the rule. The one legitimate owner-run write (the first owner) has a narrow, explicit condition instead.
- **Require every field for every document type.** Rejected: a court makes no sense for legislation. The rules are data, per type.
- **Keep a default `APP_ENV` and warn.** Rejected: a warning is read after the check has been skipped.
- **Put requester ≠ approver in the corpus.** Rejected by the founder: the corpus must not depend on ingestion.
