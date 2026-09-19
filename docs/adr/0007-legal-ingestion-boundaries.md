# ADR-0007: Legal ingestion: ownership, rights at every boundary, and human review

- Status: Accepted
- Date: 2026-09-19
- Stage: 5

## Context

Stage 4 made the corpus enforce rights, provenance and a lifecycle. Stage 5 must put legal material into it without weakening any of that. Ingestion is the largest source of untrusted input the platform has: bytes from outside, parsed by code, turned into passages that will one day be cited. `AGENTS.md` and docs 14, 16 and 18 set the rules: never fabricate authority, never treat machine inference as verified fact, never process a source for a purpose its rights do not permit, never lose provenance, never let private material reach the public corpus, never let ingestion publish its own work.

The stage started from an existing implementation and plan produced outside this session. It was adopted and hardened (see the [review](../reviews/stage-5-existing-implementation-review.md)); its migration could not be applied and several of its boundaries were in the wrong place. This ADR records the decisions that came out of that.

## Decision

### Ownership

1. **A package owns the invariants of its own tables, and no others.** Corpus invariants (rights in force, the approval gate, passage immutability, what a source kind may be) live in the corpus package's migrations, added forward as `0003`; accepted migrations were not rewritten. The ingestion package owns its tables and installs **no trigger on a corpus table and no `SECURITY DEFINER` function**. It reads rights through `corpus.rights_decision_in_force` and moves versions through `corpusStore`. A guard keyed on a caller-set column (`pipeline_version LIKE 'ingestion/%'`), as the first implementation had, is not a guard.
2. **Jobs, one per bounded artifact,** with stage events, rather than the `runs/items/stage_executions` sketch in docs/25. Each retry, lock, audit record and failure is bounded by one artifact.

### Rights

3. **Rights are a third concept**, separate from authorisation and entitlements, and are checked per operation, fail closed, at every boundary: request, claim, each stage, each evidence write, hand-off and approval. `structure` needs `acquire_store` and `derive_metadata`; no other use is implied. `acquire_store` is a new use, so existing approvals do not silently gain it.
4. **Processing reads the clock each time.** `corpus.rights_decision_in_force` uses `clock_timestamp()`; the read-time gate uses a per-statement `now()`, correct for policies and wrong for work that lasts minutes. Both are parity-tested against the TypeScript rules.
5. **A refusal is always possible, an approval is not.** Rejecting or holding a review never asks for rights; approving does.

### The corpus is public-only

6. **`user_supplied` is removed as a source kind.** It was a path from an organisation's private document to a published authority. Private tenant document ingestion is not built; if it is, it is a separate tenant-scoped design that never writes to the corpus tables. The public-corpus schemas have no tenant column and no reference to a tenant table, the application role has no access to `ingestion`, and the ingestion request accepts no tenant, path, URL or storage key. These are tested as impossibilities.

### Human review

7. **Approval requires a recorded human decision**, enforced by the corpus for every role including a superuser: the latest decision for the version must be an approval by the person named as approver. Decisions are append-only (`corpus.version_review_decisions`); a later hold or rejection withdraws an earlier approval. A version with no passages cannot be handed to review.
8. **Review is orchestrated, not triggered.** One transaction records the corpus decision, performs the transition, records the ingestion disposition (which references the corpus decision, and is refused if the two disagree) and audits by identifier. Reasons are machine-readable codes, not free text. Approving and publishing stay separate permissions held by different people (the Stage 4 two-person rule).
9. **Machine output is never verified.** Every derived field carries value, exact quote, offsets, origin, confidence and a review state, and the database accepts only `unreviewed` at ingestion. Treatments are never inferred by ingestion.

### Evidence and integrity

10. **The database verifies what the pipeline claims:** the stored text is the hashed text; a version's provenance equals its artifact's; every quote, passage and citation is the text at its offsets. Every check is written as "provably true or fail", because a missing key that evaluates to NULL is silently a pass in PL/pgSQL.
11. **Failures are typed, fixed-message and classified** as retryable (`acquisition_failed`, `storage_failed`), review, or terminal. An unrecognised fault is a visible terminal `internal_error`; a database outage is never reported as a legal decision. Classification reads stable hints and SQLSTATE classes, never message text.
12. **Duplicates go to a person.** A duplicate stops in review with candidates; nothing is merged silently; a rejected version does not block ingesting the same bytes again.

### Definer functions

13. **`SECURITY DEFINER` is inventoried and enforced.** Every definer function must pin `search_path` with `pg_catalog` first, must not be executable by `PUBLIC`, must not use dynamic SQL, and outside `iam` must not reach a tenant table. `apps/migrate` holds the explicit inventory (six functions, none in ingestion); an unlisted or stale entry fails the build.

## Consequences

- Every safety rule above was checked by disabling it and confirming a targeted test fails (seventeen mutations, all killed; see the review document).
- Reviewing is slower than a trigger and involves more code. That is intended: the record of who decided is the thing that authorises the change, not a side effect of it.
- Because rights are re-checked at each boundary, a revocation is felt within one stage. It costs several small queries per stage, negligible against IO. If it ever matters, batch the checks; do not drop them.
- The reviewer sees a job that stopped for a person as a dead end: a review-class failure cannot be resumed, only re-run as a new job after the cause is fixed.
- Stage 6 (search and embeddings) can rely on: a version reaches `pending_review` only with complete evidence; approval requires a human decision; and every passage's text equals the extraction at its offsets.

## Known limits

- **PDF and OCR are not implemented** (`unsupported_format`, by design, until an isolated worker exists).
- **No Ghanaian parser and no pattern-based citation detection.** Both need verified sources and conventions that have not been provided. The one parser reads explicitly labelled lines and is for controlled and synthetic sources.
- **Machine metadata cannot be marked verified** by any current path. Human verification of metadata is a separate append-only decision, not built.
- **The database cannot know who the human is** (ADR-0006). `decided_by` comes from the authenticated staff user in application code; two accounts held by one person defeat the two-person rule.
- **Raw artifacts of a source whose rights are withdrawn are retained.** Retention on revocation is a legal decision.
- **Publication, withdrawal and rights changes are not audited** here (ADR-0006); approval and rejection through ingestion review are.
- **The local storage adapter is for development.** Its safety claims hold on a POSIX filesystem and do not transfer to an object store.

## Alternatives considered

- **Keep the cross-domain triggers, key them better.** Rejected: a guard on a table the ingestion package does not own couples the corpus to it, and any keying by a caller-set value is bypassable. The corpus gate applies to every role and every version.
- **Publish automatically when a source's rights include display.** Rejected: ingestion must never publish its own work; approval and publication are separate acts by separate people.
- **A `human` metadata origin at ingestion.** Rejected: nothing at ingestion is human. Verification is a later, separately audited decision.
- **Retry every failure with backoff.** Rejected: a rights decision, a tampered file and an unclassified fault are not cured by trying again.
- **Ingest tenant documents through the same pipeline with a flag.** Rejected: a flag is one mistake from a leak. Public and private are separate designs.
