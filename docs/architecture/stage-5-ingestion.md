# Stage 5 ingestion implementation plan

Status: implementation planned; acceptance results will be recorded separately.

## Scope reconciliation

The Stage 5 brief refines docs/25: tenant workspace moves to a later stage; indexing and embeddings in docs/14 remain Stage 6. The accepted Work/Version, source-rights ledger, corpus lifecycle, role separation and modular monolith remain authoritative. No baseline migration will be rewritten. No real legal source or Ghana reference data will be acquired.

## Boundaries and flow

`legal/ingestion` owns jobs, checkpoints, processing evidence and review tasks. `legal/corpus` remains owner of works, versions, passages and graph edges. Platform DB, audit, IAM and observability are reused. Domain types and ports contain no infrastructure. PostgreSQL and filesystem implementations live in adapters. A worker may later call the same orchestration service.

One job processes one bounded artifact. Request schema: source, jurisdiction, operation (`structure`), source-scoped opaque input reference, expected SHA-256, media type, parser id, actor, correlation id and caller idempotency key. Only the public corpus lane exists. There is no tenant ID, arbitrary URL, local pathname or private object key in this interface.

Flow: request/rights check → acquisition → integrity verification → private raw storage → extraction → structure/normalization → evidence-backed metadata → deterministic passages → citation candidates → concept hook (empty unless an adapter supplies evidence) → deduplication → validation → pending human review. No publication action exists in the pipeline.

## Rights

A forward corpus migration adds `acquire_store` to the existing allowed-use list; existing approvals do not gain it. Structure requires both `acquire_store` and `derive_metadata`; display, indexing, AI processing, redistribution and export remain independent. Check current rights at request, before each processing boundary, when checkpointing and before submission. Persist the effective rights decision on artifacts/checkpoints. Rights revocation/expiry halts resumption. Rights are separate from staff authorization and entitlements.

## Persistence, retries and transactions

Persist jobs, immutable raw artifacts, extraction results, stage events, derived metadata/citation evidence and review tasks. Job status: queued → running → pending_review, failed or needs_review. Retryable failures may resume with bounded attempts/backoff; human-review and terminal failures never auto-retry. Pending review is terminal for automated ingestion. Session advisory locks serialize a job without keeping a transaction open during IO; use a direct PostgreSQL connection, not transaction-pooling mode. A crashed session releases its lock; an acquired job resumes from durable checkpoints.

Request keys are unique per source and conflicting payload reuse fails. Raw storage keys are generated from source + checksum. Atomic immutable writes and verification make repeated acquisition safe. Extraction checkpoints allow retries without re-acquisition. Final corpus writes, evidence, review task and submission audit commit together. Stable passage keys derive from artifact/parser version/ordinal/locator/text; database UUIDs remain unchanged on replay. Writes are bounded and batched.

## Deduplication and uncertain identity

Use source-scoped external identifiers plus jurisdiction/type when present. Cross-source matching is a review candidate, never a silent merge based on a title or unverified parser metadata. Exact artifact matches avoid duplicate versions. Changed artifacts for a known source identifier become new versions. Cross-source copies and ambiguous identity stop in review with candidates; data-ops can explicitly select an existing work. Preserve alternate acquisition provenance even when no version is created.

## Extraction and parsing

Strict UTF-8 text and non-executing HTML extraction are first implementations. HTML is parsed as data, with executable/hidden elements discarded and structural boundaries retained; no resource fetching. PDF is a separate extractor port: a deployment without an isolated PDF extractor fails explicitly with `unsupported_format`; empty/scanned extraction requests OCR review. OCR has a port and explicit low-quality state, never an automatic default. File and extracted-text limits bound memory. All extractor/parser ids are versioned.

A conservative common line/heading parser supports judgment paragraphs/orders and legislative parts/sections/subsections/schedules. Source-specific adapters implement the same interface. It extracts only labelled values actually present, with offsets and origin (`parser`/`deterministic`), confidence and unreviewed state. Missing values remain missing. Human verification is a separate append-only decision. No inferred court, date, treatment or title becomes verified fact. A title is required before corpus creation; parsing ambiguity creates review work.

Citation candidates carry literal text, offsets and evidence passage. Only explicitly resolved targets produce Stage 4 `cites` machine edges; unresolved citations remain reviewable candidates. No legal-treatment inference. Concept hooks must carry evidence; no taxonomy or AI is introduced.

## Validation and security

Validate source/jurisdiction, required rights, bounded input, SHA-256, artifact/version identity, required title, passage ordering/hashes, and citation/metadata substrings in exact extraction/passages. Enforce artifact/version linkage, immutable processing evidence and review handoff in SQL. App has no ingestion schema access; ingest/dataops retain no tenant access. Protected objects have no public URLs. Local storage uses generated flat names, restrictive permissions, exclusive atomic writes and symlink refusal; filenames supplied by sources are never paths. Acquisition accepts only source-scoped opaque references from a separately provisioned public-corpus inbox.

Untrusted text is data, including any future prompt-like instructions. No evaluation, script execution, parser network access or content in logs. Production entry points run the synthetic-fixture guard; startup also checks the runtime database role. Errors are fixed safe categories, never raw driver/parser exceptions.

## Review, audit and observability

Review packet exposes source/rights evidence reference, artifact reference and checksum, extracted text, derived metadata, passages, candidates, warnings and failure categories to data-ops only. Decisions are append-only with authenticated actor context; acceptance controls corpus approval, never publication. Separate publisher permission and the existing two-person rule remain. Successful stage and review events commit with their records in `audit.platform_events`; failures are recorded in a separate transaction after rollback. Logs/traces use only job/correlation ids, stage, elapsed time, attempt and category.

## Validation strategy

Unit: schemas, extraction, segmentation determinism, citation evidence, failure classification, local storage/acquisition attacks. PostgreSQL: complete synthetic pipeline from a clean database; rights denied/revoked/expired/purpose separation; retry/concurrency/deduplication; immutable evidence and version linkage; role/tenant isolation; lifecycle/review; production guard. Disable selected protections temporarily and require targeted tests to fail, then restore. Run format, lint, typecheck, dependency rules, all unit/integration tests, audit, secret scan, migration history validation, fresh migrations and production guard. Record actual results and limits in the runbook/status; do not claim a PDF/OCR worker, network connector, search, AI or admin UI exists.
