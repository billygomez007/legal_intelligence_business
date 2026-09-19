# Stage 5: legal ingestion architecture

Status: implemented on `stage-5/legal-ingestion`, awaiting review. Decision record: [ADR-0007](../adr/0007-legal-ingestion-boundaries.md). Operating guide: [runbook](../runbooks/ingestion.md). Review of the code this stage started from: [stage-5-existing-implementation-review.md](../reviews/stage-5-existing-implementation-review.md). Founder decisions on retention, purge, fixtures, citation formats and quality exceptions (2026-09-19), and the requirements that follow from them: [ingestion-retention-and-exceptions.md](ingestion-retention-and-exceptions.md).

## 1. What this is, and is not

A durable pipeline that takes one bounded, rights-cleared artifact of **public** legal material and produces a corpus version **awaiting human review**, with the evidence a reviewer needs. It optimises for correctness, provenance, reproducibility and rights enforcement, not volume.

It does not publish, search, embed, answer questions or show anything to end users. It does not ingest private organisation documents: the founder confirmed that private tenant ingestion stays separate from the public legal corpus and is not part of this stage (section 14). No real legal source or Ghanaian reference data is acquired or committed; every fixture is labelled synthetic, and no real Ghanaian judgment or legislation is used as a parser fixture until source rights and licensing are confirmed.

The stage refines docs/25: the tenant workspace moves to a later stage; indexing and embeddings (docs/14) remain Stage 6. It uses jobs (one per artifact) with stage events, not the `runs/items/stage_executions` sketch in docs/25, because one artifact per job keeps every retry, lock and audit record bounded.

## 2. Ownership

| Concern                                                                                | Owner                | Where                                    |
| -------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------- |
| Works, versions, passages, graph edges, lifecycle, rights ledger                       | `legal/corpus`       | `packages/legal/corpus`                  |
| Rights in force now; the review-decision gate on approval; passage immutability        | `legal/corpus`       | corpus migration `0003`                  |
| Jobs, artifacts, extractions, evidence, review tasks and decisions, stage events        | `legal/ingestion`    | `packages/legal/ingestion`               |
| Roles, row-level security, migrations, audit log, permissions catalogue, observability | platform packages    | `packages/platform/*`                    |

Ingestion depends on corpus and platform; nothing depends on ingestion (enforced by the architecture rules). **Ingestion installs no trigger on a corpus table and defines no `SECURITY DEFINER` function.** It reaches the corpus through `corpusStore` and reads rights through `corpus.rights_decision_in_force`.

## 3. Pipeline and job lifecycle

```
request ─► acquisition ─► storage ─► extraction ─► parsing ─► validation ─► review
 rights      bytes +       raw,        text +        passages,   evidence      version in
 checked     SHA-256       immutable   quality       metadata,   substring     pending_review
 (denied →   verified      SHA-256     warnings      citation    checks,       + review task
 nothing                   kept                      candidates  dedup
 written)
```

Job status: `queued → running → pending_review | needs_review | failed`. `pending_review` and `needs_review` are terminal for automation. Only `failed` jobs with a retryable category run again. Every transition is validated by a trigger on `ingestion.jobs`; identity columns (source, request, actor, pipeline version) are immutable and no job can be deleted.

The pipeline **never** approves or publishes. The ingestion role cannot (Stage 4 role separation, tested again here).

## 4. The rights gate

Rights are a third concept, distinct from user authorisation and subscription entitlements. The operation `structure` requires both `acquire_store` and `derive_metadata`; `display`, `index_search`, `ai_processing`, `redistribute_api` and `bulk_export` are independent and not implied.

- Checked **at request**, **at claim**, **before every stage transition**, **before each write of evidence**, **at hand-off** and **at approval**. It fails closed: no decision, denied, revoked, expired, not yet effective, or missing either use is a refusal.
- `corpus.rights_decision_in_force(source, uses[])` re-reads the clock on every call. The read-time gate (`corpus.source_allows`) is fixed for a statement, which is right for policies and wrong for work that runs for minutes.
- Each artifact and stage event records the decision id relied on.
- A revocation stops further processing: a queued job is closed as `failed/rights_denied` and leaves the queue; a running job stops at its next boundary. Rejecting or holding a review never asks for rights, so a person can still refuse after a revocation; approving does.
- Acquiring and structuring is not permission to show: publication additionally needs `display` and `index_search`, checked by Stage 4.
- **Raw bytes already stored are not deleted on revocation** (founder decision, 2026-09-19). They are retained as restricted provenance and evidence only: never displayed, indexed, embedded, sent to a model, exported or redistributed. Retention and deletion are a legal-policy decision that has not been made; an audited, two-person purge workflow is designed but not built. See [ingestion-retention-and-exceptions.md](ingestion-retention-and-exceptions.md), which also states, purpose by purpose, what is enforced today and what later stages must enforce.

## 5. Raw storage

`ArtifactStorage` is a port with `put` and `get` and **no URL method**: protected objects are never addressable from outside. The development adapter (`LocalArtifactStorage`) stores flat objects named `corpus-<sourceId>-<sha256>` under a `0700` root, opens with `O_NOFOLLOW`, writes a temporary file and links it into place (no overwrite), and re-verifies the checksum on every read. Source-supplied file names are never paths. `LocalInboxAcquirer` reads only `<sourceId>-<inputReference>` from a separately provisioned inbox; the request carries an opaque reference, never a path or URL.

The raw artifact is preserved exactly, SHA-256 verified on write and on each run, even when nothing can be made of it (a PDF, a corrupt file). Objects are immutable and idempotent: the same bytes under the same source are the same object.

## 6. Extraction

`TextExtractor` is a port. `BasicTextExtractor` handles:

- **Plain text:** strict UTF-8 (invalid bytes are refused, never guessed), line endings normalised, NFC, tabs and non-breaking spaces collapsed, control characters refused.
- **HTML:** parsed as data with `parse5`; scripts, styles, frames, embedded objects, templates and comments are never extracted; text a reader cannot see (`hidden`, `display:none`, `visibility:hidden`) is dropped **and reported** (`html_hidden_content_dropped`). An ordinary `style` attribute is not a reason to drop text. Traversal is iterative and node-bounded, so deep nesting and markup bombs end in a typed failure.
- **PDF:** refused as `unsupported_format` (a reviewable outcome). An isolated PDF worker and an `OcrExtractor` port are the extension points; OCR is never an automatic default.

Bidirectional overrides and zero-width characters are kept (removing them would alter the source) and reported. Output carries an extractor version, a quality score (share of letters and digits, a signal for the reviewer, not a claim of accuracy) and warnings. Limits: 4 MiB per artifact, 1,000,000 characters of text.

## 7. Parsing and passages

`DocumentParser` is a port keyed by a parser id; source-specific adapters implement it, so Ghana-specific logic never enters the generic pipeline. The one built parser, `labelled-v1`, is for **controlled and synthetic sources**: one passage per non-empty line, a locator of `page:N/<section>/paragraph:X` (form feeds advance the page), metadata only from explicit `Label: value` lines, citations only from explicit `Cites: <identifier>` labels. It guesses nothing; a missing value stays missing. It is not a judgment or legislation parser.

Passages are deterministic (same input, same output), bounded (4,000 per document, 8,000 characters per line) and hashed by the database. All offsets count Unicode code points, matching PostgreSQL. There are no embeddings.

## 8. Provenance and evidence

Every derived field is evidence: value, exact quote, start and end offsets into the extracted text, origin (`parser`, `deterministic` or `machine`), confidence and review state. **The database refuses any review state but `unreviewed`** at ingestion, so machine output can never present itself as verified. Each check is written as "provably true or fail", so a missing key cannot pass as NULL.

The database verifies that: the stored text is the text that was hashed; a version's source, jurisdiction, checksum, storage key, acquisition time and pipeline version equal the artifact's; every quote is the text at its offsets; every passage is the extracted text at its offsets; every citation quote is the text inside its passage. Evidence tables are append-only, even against a superuser.

## 9. Citations

Ingestion produces plain citation **candidates** with literal text, offsets and the passage that contains them. A candidate resolves to an existing work only when the identifier is known to the same source and unambiguous, never to the citing document itself; the edge is a machine `cites` edge marked `unreviewed`, pointing at a passage in the citing version (Stage 4 enforces that). Anything else stays an unresolved candidate. Treatment (overruled, distinguished, followed) is never inferred; treatments stay hidden until a person has reviewed them.

## 10. Deduplication

Prefers a person's decision to a merge. A job stops in review with candidate ids when: the same content (SHA-256) exists in the jurisdiction in a version that was not rejected; another source has already identified the same identifier; or another work has the same normalised title. The same source and identifier with new content becomes a **new version** of the known work. A rejected version does not block ingesting the same bytes again.

## 11. Failure taxonomy

Every failure ends in one fixed category, with a fixed message (`Ingestion stopped: <category>.`). Raw exception text never reaches a user, a job row, an audit record or a log.

| Category                 | Class     | Typical cause                                                        |
| ------------------------ | --------- | -------------------------------------------------------------------- |
| `rights_denied`          | terminal  | rights not in force for this operation                               |
| `acquisition_failed`     | retryable | the source object is not there yet                                   |
| `storage_failed`         | retryable | a transient database or storage fault (connection, rollback, resources, shutdown) |
| `integrity_failed`       | terminal  | bytes do not match the expected SHA-256, or stored bytes changed     |
| `unsupported_format`     | review    | PDF (until an isolated extractor exists)                             |
| `extraction_failed`      | terminal  | not UTF-8, control characters, markup bomb                           |
| `extraction_quality_low` | review    | too little real text                                                 |
| `parse_failed`           | review    | no passages, too many, a line that is not a passage                  |
| `metadata_invalid`       | review    | no title, or a label given twice                                     |
| `duplicate_detected`     | review    | candidates exist; a person decides                                   |
| `validation_failed`      | terminal  | evidence does not match the text; hand-off incomplete                |
| `input_invalid`          | terminal  | request refused (unknown parser, wrong actor, tenant present)        |
| `internal_error`         | terminal  | anything unrecognised. Visible, never retried blindly                |

## 12. Retry, idempotency and concurrency

- A request has a caller idempotency key, unique per source, with a checksum of its content: the same key and request returns the same job; the same key with different content is refused.
- At most three attempts, with linear backoff. Only `acquisition_failed` and `storage_failed` run again. A job abandoned by a worker that died on its last attempt is closed as `internal_error` instead of staying `running` for good.
- A job is serialised by a session advisory lock (no transaction is held across IO); a second worker skips it. Identity decisions are serialised per jurisdiction and document type, so two documents claiming the same identity produce one work with two versions.
- A retry resumes from durable checkpoints: the artifact and the extraction are never redone.
- **Requires a direct PostgreSQL connection**, not transaction-pooling mode (session locks).

## 13. Review workflow

A review task is created for every job that stops for a person: `validation_complete` (a version is ready) or a review-class failure (no version). A reviewer with `ingestion:inspect` reads a packet (source, rights evidence, artifact, extraction, metadata, passages, candidates, warnings, current-rights flag). A reviewer with `corpus:review` decides `approve`, `reject` or `hold`, with a machine-readable reason code and no free text.

`IngestionReview.decide` runs in one transaction: it records the decision in the corpus (`corpus.version_review_decisions`, append-only), performs the transition, records the ingestion disposition referencing the corpus decision, and audits by id. The corpus refuses approval unless the latest decision is an approval by the approver. A hold keeps the task open; the first approve or reject closes it; a task with no version (a failure or a duplicate) can be rejected or held, never approved. Approving is a separate act from publishing, held by a different role (`corpus:publish`) and a different person (the Stage 4 two-person rule).

## 14. Security boundaries

- **Public and private are separate.** The corpus, ingestion and graph schemas have no tenant column and no reference to a tenant table; the corpus source kinds cannot describe private material; the ingestion request carries no tenant, path, URL or storage key; the application role has no access to `ingestion`. Private tenant document ingestion is not built and is kept separate from the public legal corpus by founder decision; if it ever is built, it is a separate tenant-scoped design that never writes to the corpus.
- **Least privilege.** The ingestion role writes evidence and drafts, cannot record a review decision, approve, publish, edit rights or read the operator audit trail. Data-ops decides but cannot run or alter jobs. See [database-privileges.md](database-privileges.md).
- **Untrusted input.** Bounded size; strict UTF-8; no evaluation; no network access from a parser; no path from source-supplied names; hidden text dropped and reported (a known route for smuggling instructions to a machine reader); log fields are ids, counts and categories only. Extracted text is data. Nothing in this stage passes it to a model; when one does (Stage 7) it must treat the text as data and keep instructions out of it.
- **Entry points fail closed.** Both the pipeline and review check the runtime role and refuse to run in production while any synthetic authority exists.
- **`SECURITY DEFINER`** is inventoried, enforced by guardrails and listed in the review document. Ingestion has none.

## 15. Observability and audit

Structured logs carry job id, correlation id, stage, attempt, duration, category and a SQLSTATE or code, never content. Spans wrap each run; a counter and a duration histogram record outcomes by category (OpenTelemetry API; they are exported when the host application configures an SDK). `ingestion.stage_events` keeps one record per stage per attempt, with the rights decision it relied on. `audit.platform_events` records request, each stage, review decisions, and refusals (outcome `denied`), with identifiers and safe metadata only. Audit for publication, withdrawal and rights changes belongs to the API layer (ADR-0006).

## 16. Adapters and extension points

| Port                                        | Built                                             | To add                                                       |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `ArtifactStorage`                           | local development adapter                         | S3-compatible object store                                   |
| `SourceAcquirer`                            | local inbox                                       | connectors per source, after rights are settled              |
| `TextExtractor`                             | plain text, HTML                                  | isolated PDF worker                                          |
| `OcrExtractor`                              | port only                                         | isolated OCR worker, invoked after an explicit human decision |
| `DocumentParser`                            | `labelled-v1` (controlled and synthetic sources)  | Ghanaian judgment and legislation parsers, from representative lawful samples, once source rights are confirmed |
| `IngestionStore`                            | PostgreSQL                                        |                                                              |
| Concept hooks (`ParsedDocument.concepts`)   | always empty                                      | evidence-carrying adapters                                   |

## 17. Known limits

PDF and OCR are not implemented. There is no Ghanaian parser and no pattern-based citation detection: they wait for representative lawful samples and verified citation conventions, and no format is invented. A review-class failure cannot be resumed by a person, and there is no override for a low-quality extraction; accepting one will need an explicit exception workflow with a second person's approval before the material becomes publishable or searchable (designed, not built). Artifacts above 4 MiB are refused. There is no worker daemon, only `runReady`. Raw artifacts of a revoked source are retained as restricted evidence; there is no purge (designed, not built) and no audit of reads of raw storage. Full details, and what was deferred and why, are in the [review document](../reviews/stage-5-existing-implementation-review.md).
