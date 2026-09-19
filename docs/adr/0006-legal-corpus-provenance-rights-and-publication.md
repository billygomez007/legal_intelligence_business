# ADR-0006: Legal corpus: provenance, rights and publication

- Status: Accepted
- Date: 2026-09-19
- Stage: 4

## Context

`AGENTS.md` and docs 14, 16 and 18 set the rules for legal data: never fabricate authority; preserve provenance and version; no source enters the commercial corpus merely because it is technically accessible; corrections must not destroy audit history; the graph must never imply a relationship it cannot trace to evidence. Source licensing for Ghanaian material is unresolved (docs/25 §0), so the platform must be able to *enforce* whatever rights are eventually granted, and to withdraw content the moment they are not.

## Decision

### Model

1. **Work / Version.** `legal_documents` is the stable identity (a case, an Act); `document_versions` is one immutable acquisition of it, carrying its source, acquisition time, SHA-256 checksum, storage key and pipeline version. Passages and citations attach to a *version*, so a correction or amendment is a new version and history is never destroyed. (This normalises doc 12's single `LegalDocument`; it is compatible with FRBR/Akoma Ntoso if adopted for interchange.)
2. **Jurisdiction is structural.** A document, its case details, its versions and their sources are tied together by composite foreign keys on `jurisdiction_id`, so attaching a court or source from another jurisdiction is impossible rather than merely discouraged. Court authority is a rank per jurisdiction; authority never crosses jurisdictions.

### Rights

3. **An append-only source-rights ledger.** Each decision has a status, the *specific uses* it allows (`display`, `index_search`, `ai_processing`, `derive_metadata`, `redistribute_api`, `bulk_export`), an evidence reference (a licence or counsel sign-off), the deciding staff member and an optional expiry. An approval without evidence or without any use is refused by a `CHECK`. Nothing is edited or deleted, even by a superuser.
4. **Order comes from a sequence, not a clock.** "Which decision is latest" decides whether a source's content is shown at all. The first parity test found the TypeScript model and the SQL disagreeing when two decisions shared a millisecond (JavaScript dates have millisecond precision; PostgreSQL keeps microseconds). The ledger is now ordered by a strictly monotonic identity column, which is exact and independent of clock skew.
5. **Rights are enforced at read time, not only at publication.** The application role's row-level policies show a version only while it is `published` **and** `corpus.source_allows(source_id, 'display')` is true *now*. Revoking, denying or letting a decision expire hides the source's content immediately, including its passages, its documents and every citation edge that touches it. Publication additionally requires display **and** search rights, checked by a trigger.
6. **The application cannot read the ledger.** It can only ask the yes/no question, through a `SECURITY DEFINER` function that pins `search_path`.

### Lifecycle and separation of duties

7. **A database-enforced state machine** (`ingesting → pending_review → approved → published → withdrawn`, plus `rejected`). The permitted moves live in `corpus.lifecycle_transitions`, and a parity test asserts they equal the TypeScript `TRANSITIONS`. Terminal states have no exit, so withdrawn or rejected content cannot reappear.
8. **Ingestion proposes; data-ops decides.** Row-level policies confine the ingestion role to creating drafts and moving them to review or rejection; it cannot approve or publish, and cannot touch a version once it has left ingestion. It also cannot insert or change a document's metadata (`case_details`, `legislation_details`, which carry the court, decision date and `repeal_status`) once any of its versions is approved, published or withdrawn: reviewed metadata is a fact only data-ops may correct. Data-ops cannot create versions or edit text.
9. **Two-person rule, and a record that cannot be rewritten.** A `CHECK` requires that whoever approved a version is not the person who published it. The approver, publisher and withdrawal records are **write-once**: each is set only by the transition that establishes it and any later transition that changes it is refused. The approval, publication and withdrawal *times* are assigned by the trigger and cannot be supplied, so a transition cannot be backdated, and data-ops holds no privilege to name them. A pre-publication review of the first implementation found that data-ops could publish its own approval by replacing the recorded approver in the same statement, and could backdate a transition; tests reproduced both exploits against the earlier schema before it was fixed.
10. **Nothing is deleted.** Withdrawal is a state and requires a reason. `DELETE` and `TRUNCATE` are refused by trigger, for superusers as well.

### Immutability and integrity

11. **Provenance and content identity are frozen** after creation (checked by trigger, even against a superuser). **Passages are frozen** once a version leaves ingestion. Each passage's SHA-256 is **verified by the database**, so a corrupted or mismatched write cannot be stored. The same bytes cannot become two versions of one work.

### Citation graph

12. **An edge is an assertion about evidence.** Every edge points at a passage *in the citing version* (a composite foreign key enforces that), machine edges carry a confidence, and machine extraction cannot mark its own edges as reviewed or human-authored.
13. **High-impact treatments are hidden until a person has reviewed them.** `graph.relationship_types.requires_review` marks `overruled`, `distinguished`, `followed`, `questioned`, `amends`, `repeals` and the rest; plain `cites` and `mentions` are shown automatically. A rejected edge is never shown, and an edge is hidden whenever either end is not visible.

### Test data

14. **Synthetic data is labelled and fenced.** Fixtures live under a jurisdiction flagged `is_synthetic`, are named and worded as fabricated, and live only in test-support code that the architecture rules keep out of production code. No migration seeds any. A production deploy through `apps/migrate` fails if any synthetic jurisdiction exists, and the API and worker apply the same guard at their own startup when they exist (Stages 8-9). No real legal content or Ghanaian reference data is committed; that waits for Phase 0 and counsel.
15. **Least privilege, by column.** The application role sees provenance (source name, checksum, acquisition date) but not storage keys, reviewer identities, pipeline versions or the rights ledger. The generated `docs/architecture/database-privileges.md` makes every role's reach reviewable.

## Consequences

- Each rule was checked by disabling it and confirming a test fails: the rights gate, the read-time rights policy, treatment review gating, the two-person rule and passage freezing.
- Rights are evaluated per row at read time. Correct and simple now; if it costs too much at corpus scale, denormalise a visibility flag maintained by triggers, and keep the parity tests.
- Because nothing is deleted, **data-protection erasure requests (docs/18) will need an explicit, audited erasure path** that does not exist yet.

## Known limits — what this stage does not yet do

- **Purpose-specific rights are modelled and tested but not yet applied to retrieval.** Read-time visibility requires `display` only. Filtering candidates for AI generation on `ai_processing`, and API responses on `redistribute_api` (docs/15: "API rights must never exceed content rights"), is applied when search and research exist (Stages 6–7). Until then nothing calls those paths.
- **Not built:** provisions and point-in-time legislation, the legal-concept taxonomy, full-text and vector columns, and revision history for metadata edits beyond platform audit events.
- **A source must belong to the same jurisdiction as its documents.** A regional publisher is registered once per jurisdiction it serves.
- **The database cannot know who the human is.** `approved_by`, `published_by` and `reviewed_by` are supplied by the caller, because runtime roles are shared database roles. The write-once rule stops a later rewrite, not a false statement at the time it is made, and the two-person rule compares user ids, so one person holding two accounts defeats it. The API must set these fields from the authenticated staff user and give reviewing and publishing separate permissions; the corpus permissions (`corpus:review`, `corpus:publish`) are contributed to the permission catalog in Stage 5. These are organisational controls the schema alone cannot provide.
- **Data-ops may still correct metadata and titles of published documents,** by design, with no revision history beyond platform audit events. A history table for metadata edits is deferred.
- **The data-ops credentials are the trust root of the rights ledger.** The ledger is tamper-evident against accident and against lesser roles, not against whoever holds those credentials.
- **Publication is not yet audited.** Recording publish/withdraw/rights events in `audit.platform_events` belongs to the API and ingestion layers. The end-user API role cannot write that log; only ingestion and data-ops can.

## Alternatives considered

- **Check rights only when publishing.** Rejected: a later revocation would leave withdrawn-in-law content live until someone remembered to unpublish it.
- **Order rights decisions by timestamp.** Rejected after the parity test showed the clock-precision mismatch.
- **Mutable versions with a history table.** Rejected: immutability by construction is simpler to reason about and to audit than mutability plus a log.
- **Store rights as a column on the document.** Rejected: rights belong to the source and change over time; per-document flags would drift.
