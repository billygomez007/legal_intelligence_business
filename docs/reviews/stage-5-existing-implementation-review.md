# Stage 5: review of the existing ingestion implementation

- Reviewed: commit `313b2e1` on `stage-5/legal-ingestion` (the work found in the working tree, imported unmodified so it could be reviewed and diffed).
- Plan it implements: [docs/architecture/stage-5-ingestion.md](../architecture/stage-5-ingestion.md) (`a3dab5d`).
- Outcome: adopted as the canonical Stage 5 branch, **hardened**. Everything below is fixed in this branch unless it is marked DEFER.
- Later hardening: the integrity gaps found by an independent review of Stages 0–5 (2026-09-20) were closed afterwards and are recorded in [ADR-0008](../adr/0008-integrity-hardening-stages-0-5.md); this document describes Stage 5 as it stood when it was reviewed and is not updated for them.
- Founder decisions on the open items were recorded on 2026-09-19 (section 9). They add no code; the requirements are in [ingestion-retention-and-exceptions.md](../architecture/ingestion-retention-and-exceptions.md).

## 1. Method and posture

The code was treated as an untrusted external contribution: nothing was relied on until it had been read and run.

1. Read every file (about 1,700 lines across the migration, the domain, the adapters and the composition) against the Stage 5 brief, ADR-0003 to ADR-0006 and the non-negotiable product rules.
2. Ran it. **It had no tests, its migration could not be applied, and lint reported 16 errors.** Several defects below were invisible to reading and appeared only when the code ran.
3. Wrote tests for what existed, then changed the code until they passed for the right reasons.
4. Mutation-checked the safety-critical tests (section 7). Every mutation was killed; every file was restored and verified byte-identical.

The design in the plan is sound and mostly kept. The implementation was not trustworthy until it was run.

## 2. Classification

Findings are classified as:

- **SECURITY BLOCKER** and **DATA-INTEGRITY BLOCKER**: must not ship as found. Each blocker also carries its disposition, in its heading: **REPLACE** (wrong shape, rewritten rather than patched) or **ACCEPT WITH CHANGES** (sound design, specific defects fixed).
- **ACCEPT WITH CHANGES** and **ACCEPT**: not blockers; kept, with the changes and tests stated.
- **DEFER**: correctly out of scope for this stage, or needs a decision that is not ours.

There are 4 security blockers (SB-1 to SB-4), 10 data-integrity blockers (DI-1 to DI-10), 9 further items accepted with changes (A-01 to A-09), 4 accepted (C-01 to C-04) and 11 deferred (D-01 to D-11).

## 3. Blockers

### SB-1 Ingestion installed behaviour on corpus tables (migration ownership) — SECURITY BLOCKER, REPLACE

- **File:** `packages/legal/ingestion/migrations/0001_ingestion.sql` (triggers `ingestion_passage_freeze` on `corpus.passages`; `ingestion_handoff` and `ingestion_lifecycle_audit` on `corpus.document_versions`, with three `SECURITY DEFINER` functions behind them).
- **Behaviour:** The ingestion package owned invariants of the corpus domain. The guards keyed on `pipeline_version LIKE 'ingestion/%'`, a free-text column the ingestion role sets itself.
- **Risk:** A version created with any other `pipeline_version` escaped the hand-off guard entirely. Corpus correctness depended on a package that is meant to sit above it. Reverting or renaming ingestion would silently remove corpus protections.
- **Change:** Corpus invariants moved into a **new forward corpus migration** (`packages/legal/corpus/migrations/0003_public_corpus_boundaries.sql`); accepted Stage 0 to 4 migrations were not touched. The ingestion migration now installs no trigger on any corpus table and defines no `SECURITY DEFINER` function. Its hand-off gate lives on its own `jobs` table.
- **Proof:** `boundaries.integration.test.ts` "defines no SECURITY DEFINER function of its own, and installs no trigger on a corpus table" and "refuses the hand-off until evidence, a review task and every passage record are in place"; corpus "review decisions gate approval"; mutations `approval-needs-no-decision` and `handoff-needs-no-evidence` killed.

### SB-2 `user_supplied` source kind: a path from private material to the public corpus — SECURITY BLOCKER, REPLACE

- **File:** `packages/legal/corpus/migrations/0001_corpus.sql` (`sources_kind_check`) and `SOURCE_KINDS` in `packages/legal/corpus/src/domain/authority.ts`.
- **Behaviour:** A source could be registered as `user_supplied`. With an approved rights decision it could feed an ingestion job, and the result could be approved and published.
- **Risk:** One mistaken or malicious registration turns an organisation's private document into public-corpus authority. This is the failure the platform exists to prevent.
- **Change:** Removed the kind (corpus migration 0003, and the TypeScript list). The corpus is public-only, stated in the table comment. Private tenant document ingestion, if it is ever built, is a separate design in a tenant-scoped schema (section 6).
- **Proof:** corpus "the corpus is public-only"; parity test on source kinds; `boundaries.integration.test.ts` "cannot describe a source as user-supplied, in the database or in the code" and "has no tenant column and no reference to a tenant table anywhere in the public-corpus schemas"; mutation `user-supplied-source-allowed-again` killed.

### SB-3 A version could be approved with no recorded human decision — SECURITY BLOCKER, REPLACE

- **File:** Stage 4 corpus lifecycle plus `ingestion.guard_handoff` / `ingestion.decide_review`.
- **Behaviour:** The corpus let a version become `approved` on the caller's word. The only "a person decided" check was the ingestion trigger in SB-1, which applied only to ingestion-produced versions, and `decide_review` performed the lifecycle change as a side effect of inserting a row.
- **Risk:** Any role able to update the approval columns could approve without a record of a decision; the record of who decided was not the thing that authorised the change.
- **Change:** Corpus migration 0003 adds `corpus.version_review_decisions` (append-only). Approval requires that the **latest** recorded decision is an approval **by the same person named as approver**, for every role, including a superuser. A version with no passages cannot be handed to review. Review is now orchestrated in one transaction: corpus decision, transition, ingestion disposition, audit (`IngestionReview.decide`). The ingestion decision row must reference the corpus decision and the version's state must agree.
- **Proof:** corpus "review decisions gate approval"; `boundaries.integration.test.ts` "cannot be short-circuited in the database"; mutations `approval-needs-no-decision`, `approval-accepts-anyone-s-decision`, `approval-ignores-later-decisions` killed.

### SB-4 `SECURITY DEFINER` functions: audit — SECURITY BLOCKER (`guard_handoff`, `audit_lifecycle`), REPLACE

The four functions in the imported migration were audited individually; the full inventory after this stage is in section 5.

| Function                             | Search path | Dynamic SQL | Verdict                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ----------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingestion.current_rights`           | pinned      | none        | Correct in isolation, but rights evaluation is corpus-owned and it hard-coded the uses. **Replaced** by `corpus.rights_decision_in_force(source, uses[])`; ingestion keeps a thin `SECURITY INVOKER` wrapper naming the uses it needs.                                                                          |
| `ingestion.freeze_evidenced_passage` | pinned      | none        | **Unnecessary privilege.** The caller could already read the table it consulted, and the composite foreign keys already prevent deleting an evidenced passage. Removed; corpus now makes passages immutable rows.                                                                                              |
| `ingestion.guard_handoff`            | pinned      | none        | **Bypassable** (SB-1) and cross-domain. Removed.                                                                                                                                                                                                                                                              |
| `ingestion.audit_lifecycle`          | pinned      | none        | **Audit that vouches for a claim.** Fired on every version update by any role and recorded the actor as `NEW.approved_by` / `NEW.published_by`, values the caller supplies (ADR-0006: the database cannot know who the human is). An audit record whose actor is a caller-supplied column is not evidence. Removed; audit is written by application code from the authenticated context, and the corpus decision table is the durable record of who decided. |

- **Guardrails added** (`packages/platform/db/src/testing/guardrails.ts`): every definer must pin `search_path` with `pg_catalog` first, must not be executable by `PUBLIC`, must not use dynamic SQL, and outside `iam`/`app` must not reference a tenant table. `apps/migrate` supplies an explicit inventory, so an unlisted definer (or a stale entry) fails the build.
- **Proof:** `guardrails.integration.test.ts` "SECURITY DEFINER checks": one negative control per rule, each isolating a single defect, plus the inventory tests; `all-sets.integration.test.ts` "pass every structural guardrail on the combined schema".

### DI-1 The migration could not be applied — DATA-INTEGRITY BLOCKER, REPLACE

- **File:** `0001_ingestion.sql`, `ingestion.extractions.text_checksum`.
- **Behaviour:** `GENERATED ALWAYS AS (encode(sha256(convert_to(text,'UTF8')),'hex')) STORED` fails with "generation expression is not immutable" (`convert_to` is `STABLE`). No part of the ingestion schema had ever been created.
- **Risk:** Every claim the code made about the database was untested. It also broke the all-sets composition test and the production guard test.
- **Change:** An ordinary column verified by a `CHECK`, the same pattern as `corpus.passages.text_sha256`. The application supplies the hash; the database refuses a mismatch.
- **Proof:** `boundaries.integration.test.ts` "verifies in the database that the stored text is the text that was hashed"; `apps/migrate` "apply cleanly and are all recorded as applied".

### DI-2 The provenance check could never pass — DATA-INTEGRITY BLOCKER, ACCEPT WITH CHANGES

- **File:** `0001_ingestion.sql` (`artifacts.acquired_at`, `validate_evidence`, version branch).
- **Behaviour:** The artifact timestamp had microsecond precision; it was copied through a JavaScript `Date` (milliseconds) into the version, then compared for equality. Once DI-1 was fixed, **every successful run failed** with "version provenance mismatch".
- **Risk:** The check was right and the data path was wrong. Left unfixed, the natural response is to loosen the check.
- **Change:** The artifact timestamp is stored at millisecond precision, with a comment. The check is unchanged.
- **Proof:** every end-to-end test; `pipeline.integration.test.ts` "takes a synthetic act from request to pending human review, and stops there".

### DI-3 A missing JSON key passed evidence validation — DATA-INTEGRITY BLOCKER, ACCEPT WITH CHANGES

- **File:** `0001_ingestion.sql`, `validate_evidence`.
- **Behaviour:** Checks were written as `IF a OR b OR (x)::numeric NOT BETWEEN 0 AND 1 ...`. A missing `confidence` makes that term NULL, the whole condition NULL, and PL/pgSQL does not take an `IF` over NULL. Metadata with no confidence was accepted.
- **Risk:** Unverifiable machine output stored as evidence.
- **Change:** Every check is phrased as "provably true, otherwise fail" (`IF NOT COALESCE(..., false)`), across metadata, concepts, passages, citations and the graph edge.
- **Proof:** `boundaries.integration.test.ts` "rejects malformed, unverifiable or self-promoting metadata, then accepts the same evidence when correct" (a table of refusals and a control); mutation `missing-evidence-key-passes-as-null` killed.

### DI-4 HTML extraction silently dropped visible legal text — DATA-INTEGRITY BLOCKER, REPLACE

- **File:** `packages/legal/ingestion/src/adapters/extractor.ts`.
- **Behaviour:** Any element with a `hidden` **or any `style`** attribute was dropped with its children, with no warning.
- **Risk:** `style="text-align:center"` on a real paragraph is routine in scraped legal HTML. Text vanished while the raw checksum still matched and every later stage looked healthy: silent loss of law, hidden from the reviewer.
- **Change:** Only content a reader cannot see is dropped (`hidden`, `display:none`, `visibility:hidden`), and doing so raises the warning `html_hidden_content_dropped`. Bidirectional overrides and zero-width characters are kept (removing them would alter the source) and reported.
- **Proof:** `extractor.test.ts` "keeps visible text that merely carries a style attribute (no silent content loss)" and "drops text a reader cannot see, and says so"; mutations `html-hidden-text-extracted` and `html-any-style-attribute-drops-text` killed.

### DI-5 Every error became a legal decision — DATA-INTEGRITY BLOCKER, ACCEPT WITH CHANGES

- **File:** `packages/legal/ingestion/src/adapters/pg-store.ts`, `rights()`.
- **Behaviour:** `catch { throw new IngestionFailure('rights_denied') }`: a dropped connection, a deadlock or a bug was reported, and stored, as "rights denied", a terminal, non-retryable, audit-visible outcome.
- **Risk:** An outage looked like a licensing decision. Jobs were killed that a retry would have completed; the audit trail asserted refusals that never happened.
- **Change:** Only the specific stable hint is a denial. Classification reads hints and SQLSTATE classes, never message text; connection, rollback, resource and shutdown classes are retryable; anything unrecognised is a terminal, visible `internal_error`.
- **Proof:** `model.test.ts` "failureCategory"; `pipeline.integration.test.ts` "retries a transient database fault and resumes without redoing what is already done" and "gives up after the maximum number of attempts and says so".

### DI-6 A job whose rights were withdrawn could never leave the queue — DATA-INTEGRITY BLOCKER, ACCEPT WITH CHANGES

- **File:** `pg-store.ts` `claim()`, `0001_ingestion.sql` `guard_job`.
- **Behaviour:** A queued job with revoked rights failed at claim; the failure handler then tried `queued -> failed`, which the transition guard forbids, so a raw database error escaped and the job stayed queued. Every worker pass re-listed it and failed again. A job left `running` by a worker that died on its last attempt was equally stuck.
- **Change:** `queued`/retryable `-> failed(rights_denied)` is a permitted transition; claim closes the job visibly. A job abandoned on its last attempt is closed as `internal_error`. Failures before a claim no longer try to mark an unclaimed job.
- **Proof:** `pipeline.integration.test.ts` "ends a queued job whose rights were withdrawn before it started, visibly and for good" and "closes out a job abandoned by a worker that died on its last attempt"; mutation `claim-does-not-close-rights-denied-job` killed.

### DI-7 A rejected version blocked its own re-ingestion — DATA-INTEGRITY BLOCKER, ACCEPT WITH CHANGES

- **File:** Stage 4 `document_versions (document_id, content_checksum)` uniqueness; the duplicate query in `pg-store.ts`.
- **Behaviour:** After a rejection the same bytes could never be ingested again (for example after a parser fix). The duplicate query also counted rejected versions.
- **Change:** Content uniqueness applies to versions that are not rejected (corpus migration 0003, partial unique index); rejected versions remain as history; duplicate detection ignores them.
- **Proof:** corpus "content uniqueness ignores rejected versions"; `boundaries.integration.test.ts` "lets a rejection stand, and lets the same bytes be ingested again afterwards".

### DI-8 Citation edge collisions failed the whole job — DATA-INTEGRITY BLOCKER, ACCEPT WITH CHANGES

- **File:** `pg-store.ts` citation loop.
- **Behaviour:** Two mentions of one authority in one passage violated the graph's unique edge and failed the job as `internal_error`. A document that named itself was linked to itself.
- **Change:** One edge per authority per passage (repeat mentions share it); a different spelling of the same authority stays an unlinked candidate rather than being merged by guesswork; self-references are candidates, never edges. Resolution stays source-scoped and only when unambiguous.
- **Proof:** `pipeline.integration.test.ts` "links a citation only to an authority this source has already identified".

### DI-9 Form feeds never advanced the page — DATA-INTEGRITY BLOCKER, ACCEPT WITH CHANGES

- **File:** `packages/legal/ingestion/src/domain/parser.ts`. A form feed is whitespace, and blank lines were skipped before it was tested; every locator said `page:1`.
- **Risk:** Wrong citation locators on any multi-page text.
- **Proof:** `parser.test.ts` "advances the page at a form feed"; mutation `form-feed-never-advances-page` killed.

### DI-10 A hold was terminal, and review had hidden side effects — DATA-INTEGRITY BLOCKER, REPLACE

- **File:** `0001_ingestion.sql` (`review_decisions PRIMARY KEY (task_id)`, `decide_review` trigger), `adapters/review.ts`.
- **Behaviour:** One decision per task, so "hold" closed the task for good. A decision performed the lifecycle change and wrote audit as an `AFTER INSERT` trigger side effect. Review had none of the role or production-safety checks the pipeline has.
- **Change:** Several decisions per task; the first approve or reject closes it (refused early with `input_invalid`, and again by trigger). Orchestration is explicit and transactional. `createIngestionReview` applies the same role and synthetic-fixture checks. Approval re-checks rights; rejection and hold never do, so refusing stays possible after a revocation.
- **Proof:** `boundaries.integration.test.ts` "review is a person deciding, recorded in the corpus and in ingestion"; mutation `approval-does-not-recheck-rights` killed.

## 4. Accepted

### Accept with changes

| ID   | Item                                                                                       | Change                                                                                                                                                           | Proof                                                                              |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A-01 | Durable job model: unique key per source with a request checksum; attempts; advisory lock  | Sound. Kept. Transient-fault classification, abandoned-job close-out, and tests for idempotency and concurrency added                                            | `pipeline.integration.test.ts` "idempotency, retry and concurrency"      |
| A-02 | Evidence tables, append-only triggers                                                      | Kept; NULL-safe (DI-3); each guarded by tests as superuser too                                                                                                  | "keeps every record append-only and a settled job settled, even against a superuser" |
| A-03 | Audit: per-stage events with rights decision ids                                           | Category recorded; a refusal is outcome `denied`; a refused request now leaves a trace; durations are per stage (they were cumulative, so each stage looked slowest) | end-to-end and "refuses a request when the source has ..." (nine ways to be refused)               |
| A-04 | Observability (logger, spans)                                                              | Counters and a duration histogram added; log fields are ids, counts, categories only; a test asserts no document text, connection detail or driver message is logged | "never logged document text, connection details or raw driver messages"            |
| A-05 | Composition guard (`assertSafe`)                                                           | Extended to review (data-ops role); both fail closed                                                                                                             | "refuses to run over a connection that is not the ingestion role"                  |
| A-06 | Duplicate handling: review candidates, never a merge                                       | Kept; ignores rejected versions (DI-7); cross-source and same-title candidates tested                                                                            | "duplicates go to a person, never to a silent merge"                     |
| A-07 | Extraction quality                                                                         | A minimum floor routes near-empty text to review; quality is a signal for the reviewer, not a claim of accuracy                                                  | `extractor.test.ts`                                                                |
| A-08 | `labelled-v1` parser                                                                       | Kept **for controlled and synthetic sources only**. It reads labelled lines; it is not a judgment or legislation parser (see D-02)                                | `parser.test.ts`                                                        |
| A-09 | Failure taxonomy                                                                           | Fixed message per category; `input_invalid` added; retry class per category; the retry rule in the database (`storage_failed`, `acquisition_failed`) is kept in step with the TypeScript class by the retry tests | `model.test.ts`                                                                    |

### Accept

| ID   | Item                                                                                                                | Proof                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Local storage and inbox adapters: flat keys from source and checksum, 0700 root, `O_NOFOLLOW`, atomic exclusive link, verify on read | `storage.test.ts` (traversal, symlinks, FIFOs, tampering, loose permissions, oversize, idempotence). Development adapter only.                                      |
| C-02 | Strict request schema (unknown keys refused; no tenant, path or URL)                                                | `model.test.ts` "request schema"; database refuses a job request carrying a tenant or a storage key                                                                |
| C-03 | Permission contribution (`ingestion:*`, `corpus:review`, `corpus:publish`; three staff roles)                       | `permissions.test.ts`: composes cleanly; no role holds both review and publish; none is available to an organisation role or an API key. ADR-0006 planned it.      |
| C-04 | Job lock: session advisory lock, no transaction held across IO                                                      | "produces one result when two workers run the same job at once". Requires a direct connection, not transaction pooling (runbook).                                   |

## 5. `SECURITY DEFINER` inventory after this stage

Six functions, all reviewed, all pinning `search_path = pg_catalog, public`, none executable by `PUBLIC`, none using dynamic SQL. **Ingestion defines none.** The list is enforced by `apps/migrate/test/all-sets.integration.test.ts`; adding a seventh fails the build until this table and that list are edited on purpose.

| Function                           | Owner package | Why it is definer                                                             | Reach and bounds                                                                                  |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `corpus.source_allows`             | corpus        | Callers may not read the rights ledger, only ask yes or no                    | Read-only; boolean; app, ingest, dataops. Stable per statement (right for read policies)          |
| `corpus.rights_decision_in_force`  | corpus        | Same reason, for processing                                                   | Read-only; returns a decision id or raises `corpus.rights_denied`; ingest and dataops only; reads the clock on every call; must name at least one use |
| `corpus.enforce_version_lifecycle` | corpus        | Trigger; consults the transition table and write-once columns                 | Trigger function; only the owner can execute it directly                                          |
| `iam.create_organization`          | iam           | Creates an organisation and its first membership before any tenant context exists | Tenancy bootstrap; app role                                                                       |
| `iam.provision_user`               | iam           | Creates a user record from a verified identity                                | Identity bootstrap; app role                                                                      |
| `iam.resolve_identity`             | iam           | Looks up a user across tenants at sign-in                                     | Identity bootstrap; app role                                                                      |

No definer function outside `iam` may touch a tenant table (guardrail `security-definer-reads-tenant-table`), so no definer function in the public corpus or in ingestion can become a way around row-level security.

## 6. Private organisation material and the public corpus

**Resolved explicitly: private tenant documents are never ingested by this pipeline, and there is no path from one to the public corpus.** The founder confirmed on 2026-09-19 that private tenant document ingestion is kept separate from the public legal corpus and is not part of Stage 5 or PR #2.

- The source kind that could have described private material no longer exists (SB-2).
- The ingestion request accepts no tenant, storage location, URL or path, at the schema and again in the database. A request made on behalf of a tenant, or by an API key, is refused.
- No table in `ingestion`, `corpus` or `graph` has an `organization_id` column, and none references a tenant table (they reference only each other and `iam.users`, for reviewers); the structural guardrail `non-tenant-references-tenant` polices the same rule for future migrations.
- The application role has no privilege on the `ingestion` schema at all.
- Cross-tenant leakage tests are therefore expressed as impossibility tests, because private ingestion was **not** introduced. If private tenant document ingestion is built later it must be a separate, tenant-scoped design (composite tenant foreign keys, restrictive row-level security, its own storage namespace) with the mandatory cross-tenant leakage tests, and it must never write to the corpus tables.

## 7. Mutation checks

Each mutation breaks one safety property; the named tests must fail. All were killed, and each file was restored and verified byte-identical afterwards (a full pre-run snapshot of the tree matched at the end). Nothing broken was committed.

| Mutation                                      | Property broken                                                          | Killed by                       |
| --------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------- |
| `rights-expiry-ignored`                       | An expired approval still permits work                                   | corpus, pipeline (2 tests)      |
| `rights-any-use-suffices`                     | One permitted use satisfies an operation needing two                     | corpus, pipeline (4 tests)      |
| `rights-future-decision-in-force`             | A decision not yet effective already applies                             | corpus parity                   |
| `ingestion-rights-wrapper-ignores-rights`     | The ingestion wrapper returns any decision, in force or not              | pipeline, boundaries            |
| `claim-does-not-close-rights-denied-job`      | A queued job with withdrawn rights stays queued                          | pipeline                        |
| `approval-does-not-recheck-rights`            | Approval proceeds after a revocation (both layers removed)               | boundaries                      |
| `approval-needs-no-decision`                  | Approval without a recorded decision                                     | corpus, boundaries (4 tests)    |
| `approval-accepts-anyone-s-decision`          | Approval on the strength of someone else's decision                      | corpus                          |
| `approval-ignores-later-decisions`            | A later hold or reject does not withdraw an approval                     | corpus                          |
| `passages-editable-in-place`                  | A passage can be edited while ingesting                                  | corpus                          |
| `user-supplied-source-allowed-again`          | Private material can be registered as a source                           | corpus, boundaries (3 tests)    |
| `machine-metadata-may-claim-review`           | Machine output marks itself reviewed                                     | boundaries                      |
| `missing-evidence-key-passes-as-null`         | A missing evidence key passes (DI-3)                                     | boundaries                      |
| `handoff-needs-no-evidence`                   | A job claims a reviewable result without evidence                        | boundaries                      |
| `html-hidden-text-extracted`                  | Hidden text is extracted                                                 | extractor                       |
| `html-any-style-attribute-drops-text`         | Visible text with a `style` attribute is dropped (the original DI-4 bug) | extractor                       |
| `form-feed-never-advances-page`               | Page locators stay at 1                                                  | parser                          |

Note on `ingestion-rights-wrapper-ignores-rights`: it fails 54 tests because the mutated function also cannot read the ledger as the invoking role, so it is a broad kill rather than a precise one. The precise rights mutations are the corpus-owned ones above.

## 8. Deferred

| ID   | Item                                                                                                                | Why deferred                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | PDF extraction and OCR                                                                                              | A PDF is refused as `unsupported_format` (reviewable, not a crash). Extracting one safely needs an isolated worker; OCR needs an explicit human decision. Ports exist, adapters do not. |
| D-02 | Real structural parsers for Ghanaian judgments and legislation; paragraph-level segmentation with structural locators | Needs representative lawful samples and confirmed source rights; no real Ghanaian judgment or legislation is used as a fixture until then (founder decision). Not invented. The adapter interface is in place. |
| D-03 | Pattern-based plain citation detection and a treatment-classification hook                                          | Waits for verified Ghanaian citation conventions and representative lawful samples; no format is invented (founder decision). The parser detects only explicit `Cites:` labels. Treatments are never asserted by ingestion. |
| D-04 | Human verification of metadata as an append-only decision                                                           | Machine and parser metadata stays `unreviewed`. The database refuses any other state at ingestion. Reviewers correct via Stage 4 data-ops metadata edits.                          |
| D-05 | A "proceed anyway" path for review-class failures                                                                   | Such a job ends in `needs_review` and can be rejected or held, not resumed; the remedy is a new job after the cause is fixed. For a low-quality extraction, the founder has decided an override may exist only as an explicit exception workflow (reviewer, reason, quality warning, affected version, timestamp) with a second person's approval before the material is publishable or searchable. Designed, not built. |
| D-06 | Audit events for publish, withdraw and rights changes                                                               | Known limit in ADR-0006. Approval and rejection through ingestion review are audited; the API layer owns the rest.                                                                 |
| D-07 | Streaming for artifacts above 4 MiB; a scheduler or worker process                                                  | `runReady` exists and is tested; no daemon is built.                                                                                                                               |
| D-08 | S3-compatible object storage adapter                                                                                | Port and a local development adapter only.                                                                                                                                         |
| D-09 | Retention and purge of raw artifacts when a source's rights are withdrawn                                           | Founder decision (section 9): no automatic purge yet. A revocation stops all further processing and hides published content at once; retained raw bytes are restricted provenance and evidence only. Deletion is a legal-policy decision not yet made; an audited purge workflow is designed, not built. |
| D-10 | Private tenant document ingestion                                                                                   | Deliberately not built; kept separate from the public corpus by founder decision (section 6).                                                                                      |
| D-11 | Ghanaian reference data                                                                                             | None is committed. Fixtures are labelled synthetic, no real Ghanaian judgment or legislation is used as a fixture until rights are confirmed, and production refuses to run while any synthetic authority exists. |

## 9. Founder decisions (recorded 2026-09-19)

The questions this review raised, and the instruction that was cut off mid-sentence, are decided. None adds code; the requirements and designs are in [ingestion-retention-and-exceptions.md](../architecture/ingestion-retention-and-exceptions.md) and the decisions are recorded in ADR-0007 (decisions 14 to 17).

1. **Private ingestion** stays separate from the public legal corpus and is not part of Stage 5 or PR #2. The Stage 5 interpretation (section 6) was correct.
2. **Rights revocation and raw bytes (D-09).** No automatic purge yet. On revocation the material must immediately become unusable for product display, search and indexing, AI processing, API redistribution and every other prohibited purpose. Retained raw bytes are restricted provenance and evidence only. Retention and deletion remain a legal-policy decision. An audited purge workflow is designed; destructive deletion is not implemented.
3. **Real Ghanaian fixtures (D-02, D-11).** None until source rights and licensing are confirmed. Fixtures stay clearly labelled synthetic.
4. **Ghanaian citation conventions (D-03).** Do not invent formats. Real citation-pattern support waits for verified conventions and representative lawful samples.
5. **Low-quality extraction override (D-05).** Only through an explicit exception workflow recording the reviewer, reason, quality warning, affected document and version, and timestamp, and requiring a second person's approval before the material becomes publishable or searchable. Not implemented; it is not needed to complete Stage 5.

**What the code does today about decision 2.** Revocation stops ingestion, publication and product display at once, and each is tested. Search, AI processing, API redistribution and export have no code path yet, so the requirement is met for them structurally; the requirements those stages must meet are recorded as entry criteria. The review packet still shows data-operations staff protected text after a revocation, so that a person can reject.

**Still open, for counsel:** the retention and deletion policy itself (whether a purge is mandatory, on what timetable, what must be kept as evidence, whether backups are in scope); and whether data-operations staff reading protected text of a revoked source in the review packet is itself a prohibited purpose.

## 10. Limits of this review

- The review covers the code and behaviour in this repository. It is not a penetration test, and no legal advice is implied.
- Storage safety claims are for the local development adapter on a POSIX filesystem. A production object store needs its own review.
- The database cannot know who the human is (ADR-0006): `approved_by` and `decided_by` are supplied by the application from the authenticated staff user. Ingestion review does so from the authorisation context and refuses a non-user principal.
- Remote CI was blocked by an account billing lock at the time of writing; every result quoted here comes from the local validation gate recorded in the pull request.
