# Runbook: legal ingestion

For engineers and data-operations staff operating the Stage 5 ingestion pipeline. Design: [stage-5-ingestion.md](../architecture/stage-5-ingestion.md). Decisions: [ADR-0007](../adr/0007-legal-ingestion-boundaries.md).

## 0. What exists today

The pipeline is a library (`@legalintel/legal-ingestion`) with a tested `runReady` loop. **There is no HTTP endpoint, worker daemon or admin UI yet** (Stages 8 and 9). Everything below is done from code or SQL run by staff. It processes **public** legal material only, one bounded artifact per job. Nothing here publishes.

## 1. Prerequisites

| Need                          | Detail                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database roles                | The pipeline connects as `legalintel_ingest` (`INGEST_DATABASE_URL`). Review connects as `legalintel_dataops` (`DATAOPS_DATABASE_URL`). Each entry point refuses any other role, or a role that bypasses row-level security. |
| Direct connection             | The job lock is a session advisory lock. Do **not** put a transaction-pooling proxy (for example PgBouncer in transaction mode) between the pipeline and PostgreSQL. A crashed session releases its lock; a pooled one may not. |
| Storage directory             | Owned by the service account, mode `0700`, reached through no symlink (`realpath` must equal the path). Never serve it over HTTP. Development adapter only.                                                       |
| Inbox directory               | Public-corpus objects placed by a rights-authorised operator, named `<sourceId>-<inputReference>`, mode `0600`. Never a tenant upload, never an arbitrary path.                                                    |
| Rights                        | The source must have an approved rights decision with **both** `acquire_store` and `derive_metadata`, an evidence reference, and no expiry passed.                                                                |
| Staff permissions             | `ingestion:request` to start jobs (role `ingestion_operator`), `ingestion:inspect` to read packets and `corpus:review` to decide (role `data_reviewer`), `corpus:publish` to publish (role `data_publisher`). No role holds two of the three. |

## 2. Set up a source (data-operations)

1. Create the jurisdiction and register the source (`corpusStore.createJurisdiction`, `registerSource`). Kinds: `court_registry`, `government_gazette`, `legislature`, `publisher`, `institutional_repository`. There is no kind for private material, and there will not be.
2. Record a rights decision (`recordRightsDecision`) for exactly the uses the licence or counsel's sign-off grants. **Ingestion needs `acquire_store` and `derive_metadata`.** It does not need, and does not imply, `display` or `index_search`; publishing later needs both of those. Never record an approval without the evidence reference.
3. Rights are an append-only ledger: a later decision supersedes an earlier one. To stop all processing, record a `revoked` decision.

## 3. Run a job

```ts
const pipeline = createIngestionPipeline({
  pool: ingestPool, // legalintel_ingest
  environment: 'production' | 'development' | 'test',
  storage: new LocalArtifactStorage(storageRoot),
  acquirer: new LocalInboxAcquirer(inboxRoot),
  extractor: new BasicTextExtractor(),
  parsers: [labelledParser], // or a source-specific adapter
  logger,
});

const job = await pipeline.request(operatorContext, {
  sourceId, jurisdictionId, operation: 'structure',
  inputReference,            // opaque: names the inbox object
  expectedChecksum,          // SHA-256 of the bytes, hex
  mediaType: 'text/plain',   // text/plain | text/html | application/pdf (PDF is refused, see 6)
  parserId: 'labelled-v1', documentType: 'legislation',
  idempotencyKey,            // yours; the same key and request returns the same job
  actorId, correlationId,
});
await pipeline.run(job.id);  // or: await pipeline.runReady(10)
```

`actorId` must be the authenticated staff user; the request is refused otherwise, and refused for a tenant context or an API key. The result of a good run is a job in `pending_review`, a corpus version in `pending_review`, and a review task.

### Try it locally on synthetic documents

```sh
# with a local PostgreSQL and the variables from .env.example
pnpm db:setup                      # creates roles and a database, applies all migrations (APP_ENV must be set: see section 9)
INGEST_DATABASE_URL=... DATAOPS_DATABASE_URL=... DB_BOOTSTRAP_ADMIN_URL=... \
  pnpm --filter @legalintel/legal-ingestion demo
```

The demo ingests an Act, a case that cites it, the same Act again and a PDF, and stops with two versions awaiting review, a duplicate and an unsupported format waiting for a person, one unreviewed machine citation, and nothing approved or published. **It leaves synthetic authorities in the database. A production deploy refuses such a database.** Use a throwaway one and drop it.

## 4. Review (data-operations)

```ts
const review = createIngestionReview({ pool: dataopsPool, environment });
const open = await review.queue(reviewerContext);           // tasks with no approve/reject yet
const packet = await review.packet(reviewerContext, taskId); // protected content: never log it
await review.decide(reviewerContext, { taskId, decision: 'approve' | 'reject' | 'hold', reasonCode: 'checked_against_source' });
```

- Read the packet: source and rights evidence, the raw artifact reference and checksum, the extracted text, each metadata field with its quote and offsets, the passages, citation candidates and warnings. **Every field is unreviewed machine or parser output.** Check it against the source.
- **Verify the publish-critical metadata before approving.** The packet's `criticalMetadata` lists what matters for this kind of document (every document: title and jurisdiction; a case also a court and a decision date; a neutral citation, docket number or legislation identifier when one is recorded). For each field you have checked against the source, call `review.verifyMetadata(reviewerContext, { taskId, verifications: [{ field, status: 'verified' | 'rejected', valueSha256, evidenceReference }] })`, quoting the `valueSha256` shown and saying where you checked it (a page, a registry entry, a gazette reference). Use `rejected` if the value is wrong. A batch is all-or-nothing and is audited by field, never by value.
- **A case needs its court and date recorded first.** Extraction does not write them. From the source, call `review.recordCaseDetails(reviewerContext, { taskId, courtId, decisionDate: 'YYYY-MM-DD', neutralCitation?, docketNumber? })`, then verify them. Changing a value after it was verified invalidates that verification, so verify it again.
- **You cannot approve a job you requested**, even if you also hold the reviewer permission (`ingestion.requester_cannot_approve`). Ask another reviewer. You can still reject or hold your own request.
- `reasonCode` is a short machine-readable code (`^[a-z][a-z0-9_]{0,63}$`), never free text.
- **Approve** records your decision in the corpus and moves the version to `approved`. It re-checks the rights: if they were withdrawn it is refused with `rights_denied`, and you can still reject. It refuses with `validation_failed` while any required critical field is unverified (`corpus.metadata_unverified`) or if provenance was not attested (`corpus.provenance_required`; the pipeline attests every version it hands off, so this means the version did not come from the pipeline). It does not publish.
- **Hold** leaves the version awaiting review and the task open. **Reject** closes the task; the same bytes can be ingested again later as a new job.
- A task with no version (a duplicate, a failure) can be rejected or held, never approved.
- **Publishing** is a separate act by a person holding `corpus:publish`, who must not be the approver, and needs `display` and `index_search` rights.

## 5. What each outcome means, and what to do

| Job ends as                                | Category                 | Meaning                                                              | Action                                                                                                                                         |
| ------------------------------------------ | ------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pending_review`                           |                          | A version is ready for a person                                      | Review (section 4)                                                                                                                             |
| `failed`, will retry                       | `acquisition_failed`     | The source object is not in the inbox yet                            | Provision the file. The job is offered again after its backoff (5 s times the attempt number), up to three attempts                            |
| `failed`, will retry                       | `storage_failed`         | A transient database or storage fault                                | Usually none: retried automatically. If it exhausts its three attempts, fix the cause and request a new job                                    |
| `failed`                                   | `rights_denied`          | Rights are not in force for this operation                           | Not a fault. Record the correct rights decision if it is a mistake; otherwise leave it. Then request a new job                                 |
| `failed`                                   | `integrity_failed`       | The bytes do not match `expectedChecksum`, or stored bytes changed   | Investigate before anything else: a wrong checksum is a wrong request; changed stored bytes are an incident                                    |
| `failed`                                   | `extraction_failed`      | Not UTF-8, control characters, or a markup bomb                      | Obtain a clean copy of the source                                                                                                              |
| `failed`                                   | `validation_failed`      | Evidence does not match the text, or the hand-off was incomplete     | A defect. Do not retry blindly; keep the job and its ids for the engineer                                                                      |
| `failed`                                   | `input_invalid`          | The request was refused (unknown parser, wrong actor, tenant present) | Correct the request                                                                                                                            |
| `failed`                                   | `internal_error`         | Unrecognised fault, or a worker died on its last attempt             | An engineer looks at the logs by job id. Never re-run without understanding it                                                                 |
| `needs_review`                             | `unsupported_format`     | A PDF (there is no isolated extractor yet)                           | Reject or hold the task. The raw file is kept                                                                                                  |
| `needs_review`                             | `extraction_quality_low` | Too little real text                                                 | Obtain a text source, or hold until OCR exists. **There is no override**: accepting a low-quality extraction will need an explicit exception workflow with a second person's approval, which is designed but not built                                                                                                 |
| `needs_review`                             | `parse_failed`           | No passages, too many, or a line too long                            | Use a suitable parser, or a cleaner source; then a new job                                                                                     |
| `needs_review`                             | `metadata_invalid`       | No title, or a label given twice                                     | Fix the source or parser; then a new job                                                                                                       |
| `needs_review`                             | `duplicate_detected`     | The same content, identifier or title already exists                 | The task lists candidate documents. Reject if it is a duplicate. If it is a genuine new version, ingest it under its own identifier            |

A `needs_review` job is terminal: to try again after a fix, request a **new** job (a new idempotency key).

## 6. Situations

- **Rights withdrawn.** Record a `revoked` decision. Queued jobs close as `failed/rights_denied` on their next pass; running jobs stop at their next stage; approval is refused; rejection still works. Published content disappears from end users immediately (Stage 4). **Raw artifacts already stored are kept, as restricted provenance and evidence only** (founder decision, 2026-09-19): they must not be displayed, indexed, embedded, sent to a model, exported or redistributed, and nothing in the product reads them. Whether and when they must be deleted is a legal-policy decision that has not been made.
- **Deleting stored raw bytes or ingestion records.** Do not. There is no purge workflow yet (an audited, two-person one is designed in [ingestion-retention-and-exceptions.md](../architecture/ingestion-retention-and-exceptions.md)); the triggers refuse a hand edit, and an unaudited deletion is worse than retention. If counsel requires deletion, escalate: that is the trigger to build the workflow. Note that the review packet still shows data-operations staff protected text after a revocation so a person can reject; whether that is itself permitted is a question for counsel.
- **A job seems stuck in `running`.** A worker died. A job with attempts remaining resumes on the next pass. On its third attempt it is closed as `internal_error` by the next `run`. Do not edit the row.
- **A retry storm.** Each job has at most three attempts and a backoff. If a whole class fails, look at the category counts, not the individual jobs.
- **PDF.** Refused, by design, until an isolated extractor exists. Do not work around it.
- **Two workers.** Safe: the second skips a locked job.
- **A synthetic-fixture error in production.** The pipeline and review refuse to run in production while any synthetic jurisdiction exists. Find and remove the fixture through data-operations; never disable the check.

## 7. Read-only queries

Run as `legalintel_dataops` (or a superuser for diagnosis). These return identifiers and states, not content.

```sql
-- Jobs by state and failure category
SELECT status, coalesce(failure_category, '-') AS category, count(*) FROM ingestion.jobs GROUP BY 1, 2 ORDER BY 1, 2;

-- Work waiting for a person
SELECT t.id, t.reason, j.source_id, t.created_at
  FROM ingestion.review_tasks t JOIN ingestion.jobs j ON j.id = t.job_id
 WHERE NOT EXISTS (SELECT 1 FROM ingestion.review_decisions d WHERE d.task_id = t.id AND d.decision IN ('approve','reject'))
 ORDER BY t.created_at;

-- What happened to one job
SELECT stage, attempt, outcome, duration_ms, rights_decision_id FROM ingestion.stage_events WHERE job_id = $1 ORDER BY id;

-- Who decided what (corpus record)
SELECT version_id, decision, reason_code, decided_by, decided_at FROM corpus.version_review_decisions WHERE version_id = $1 ORDER BY sequence;
```

## 8. Never

- Edit an ingestion or corpus row by hand, or disable a trigger. Records are append-only on purpose; a superuser cannot rewrite them either.
- Point ingestion at private organisation material, or at a tenant's upload.
- Approve because a machine field looks right. Machine output is unreviewed until a person has checked it against the source.
- Verify a field you have not checked, or copy a fingerprint you did not read the value for. A verification says a named person checked that value against a stated source.
- Approve your own request, from a second account or otherwise. Separation of duties is between people, not accounts.
- Retry a `rights_denied`, `integrity_failed` or `internal_error` job without understanding why it stopped.
- Log a review packet, extracted text or a passage. Log identifiers only.
- Load synthetic fixtures into a production database.
- Delete raw artifacts or ingestion records by hand, or read retained raw bytes of a revoked source for any purpose other than provenance and evidence.
- Commit a real Ghanaian judgment or piece of legislation as a fixture. Fixtures are clearly labelled synthetic until source rights and licensing are confirmed.
- Invent a citation pattern. Real citation support waits for verified conventions and representative lawful samples.

## 9. Validating a change to ingestion

```sh
pnpm check                 # format, typecheck, lint, architecture rules, unit tests
pnpm test:integration      # real PostgreSQL; needs TEST_DATABASE_ADMIN_URL (see packages/platform/db/README.md)
pnpm audit --audit-level=high
```

**`APP_ENV` must be set explicitly** for every migration command (`db:setup`, `db:migrate`, `db:status`, `db:bootstrap`) and must be exactly `development`, `test`, `staging` or `production`. A missing, blank or invalid value is refused (exit code 2) before anything connects; there is no default here, because the value decides whether production safety checks run. (Copying `.env.example` to `.env` sets `development`.)

Migration checks: `pnpm db:setup` on an empty database with `APP_ENV=production` must succeed; `pnpm db:status` with `APP_ENV=production` must fail on a database holding synthetic data. After any change to database privileges, regenerate and review `docs/architecture/database-privileges.md` (`UPDATE_DOCS=1 pnpm exec vitest run --project integration apps/migrate`).
