# Ingestion: rights revocation, retained raw bytes and quality exceptions

Status: **requirements, recorded 2026-09-19 from founder decisions. Nothing in sections 3 to 5 is implemented.** No code path deletes a raw artifact or an ingestion record, and no exception workflow exists. Context: [ADR-0007](../adr/0007-legal-ingestion-boundaries.md), [architecture](stage-5-ingestion.md), [runbook](../runbooks/ingestion.md).

## 1. Decisions this records

1. **Private ingestion stays separate.** Private tenant document ingestion is kept separate from the public legal corpus and is not part of Stage 5 or PR #2.
2. **No automatic purge yet.** When rights are revoked, raw bytes already acquired are **not** deleted automatically. The material must immediately become unusable for product display, search and indexing, AI processing, API redistribution and every other prohibited purpose. Retained raw bytes are **restricted provenance and evidence only**. Whether and when they must be deleted is a **legal-policy decision that has not been made**. A future audited purge workflow is designed here; destructive deletion is not implemented.
3. **No real Ghanaian fixtures.** No real Ghanaian judgment or legislation is committed as a parser fixture until source rights and licensing are confirmed. Fixtures stay clearly labelled synthetic.
4. **No invented citation formats.** Real citation-pattern support waits for verified conventions and representative lawful samples.
5. **Low-quality extraction override.** A reviewer may eventually accept a low-quality extraction only through an explicit exception workflow, and a second person must approve before the material becomes publishable or searchable. It is not implemented (section 5).

## 2. What "unusable after revocation" means, and where it is enforced

A revocation is a `revoked` (or `denied`, or an expired) rights decision in the append-only ledger. The ledger is the single source of truth; every check below reads it at the moment of use.

| Purpose                                       | Enforced by                                                                                                                                                                                       | Status                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Acquire, store, structure (ingestion)         | `corpus.rights_decision_in_force` at request, claim, every stage, every evidence write, hand-off and approval. Queued jobs close as `rights_denied`; running jobs stop at the next stage            | **Enforced and tested**                                                       |
| Publication                                   | A Stage 4 trigger requires `display` and `index_search` at the moment of publishing                                                                                                                | **Enforced and tested**                                                       |
| Product display                               | Stage 4 row-level policies show a version to the application role only while `corpus.source_allows(source, 'display')` is true now. Passages, documents and citation edges of the source disappear at once | **Enforced and tested** (Stage 4)                                             |
| Search and indexing (`index_search`)          | Nothing yet: no search exists                                                                                                                                                                     | **Requirement for the search stage** (below)                                  |
| AI processing (`ai_processing`)               | Nothing yet: no AI path exists                                                                                                                                                                    | **Requirement for the AI stage** (below)                                      |
| API redistribution, bulk export               | Nothing yet: no API or export exists                                                                                                                                                              | **Requirement for the API stage** (below)                                     |
| Staff review of unpublished material          | The review packet is a data-operations tool. It still shows extracted text and passages after a revocation, flagged `currentProcessingAllowed: false`, so that a person can reject                    | **Open question for counsel** (section 3.3)                                   |
| Raw bytes and derived ingestion records       | Retained; restricted provenance and evidence only (section 3)                                                                                                                                     | Retained by decision                                                          |

### Requirements carried to later stages

These are written down now so no later stage can build a path that outlives a revocation. They are entry criteria for the work, not work done.

1. **Check the specific use at read time.** Any code that reads corpus content for search, retrieval, model input, an API response or an export must check the matching use (`index_search`, `ai_processing`, `redistribute_api`, `bulk_export`) against the rights in force **when it reads**, not only when the content was indexed or published. `display` alone never authorises another purpose.
2. **Derived stores must not outlive the rights.** Indexes, embeddings, caches, summaries and exports are keyed by source, filtered by the rights in force at query time, and can be removed for a source on revocation. Each must have a test that revokes rights and proves the content stops being served, and a test that proves a rebuild does not resurrect it.
3. **No copy without a rights link.** Nothing may copy raw or extracted content into another store without recording which source and which decision it depends on.
4. **A new reader of raw storage goes through a rights-aware path and is audited** (section 3.2).

## 3. Retained raw bytes: restricted provenance and evidence only

### 3.1 What is retained

The raw object in storage (`corpus-<sourceId>-<sha256>`), and the ingestion records derived from it: `ingestion.artifacts`, `extractions` (the extracted text), `version_evidence`, `passage_evidence`, `citation_candidates`, the stage events, and the passages of any version that was never published.

### 3.2 What they may and may not be used for

- **May:** prove what was acquired, when, from which source and under which rights decision; verify a checksum; support an audit or a legal defence; be produced to counsel.
- **May not:** be displayed, indexed, embedded, summarised, sent to a model, exported, redistributed, served through an API, or used to rebuild any product surface.

Today this holds structurally rather than by a purge:

- Only the ingestion pipeline reads raw bytes, and only after a rights check for the same job. The storage port has **no URL method and no delete method**, so nothing can address or remove an object through it.
- The application role has no privilege on the `ingestion` schema and sees only published, rights-cleared versions.
- Ingestion and evidence records are append-only; a superuser cannot rewrite them either.
- **Not yet true:** there is no audit of a read of raw storage, because nothing but the pipeline reads it. Any future reader must be added with a rights check and an audit event, and must not be reachable from a product path.
- Backups, replicas, object-store versioning and logs are outside this repository. Counsel's retention policy must say whether they are in scope.

### 3.3 Open question for counsel

The review packet lets data-operations staff read protected extracted text of a source whose rights were revoked, so they can reject the version. If counsel decides that staff viewing is itself a prohibited purpose, the packet should show identifiers and checksums only once rights are revoked (a small change to the packet query). This is not done because it is a policy question, not an engineering one.

### 3.4 Retention and deletion: a legal-policy decision

Whether raw bytes must be deleted on revocation, when, and what must be kept as evidence, is a legal-policy decision that is **not** made here. The same decision covers data-protection erasure (ADR-0006 notes that no explicit, audited erasure path exists). Until it is made, bytes are retained and restricted. Nobody deletes them by hand: the triggers refuse it, and an unaudited deletion is worse than retention.

## 4. Future audited purge workflow (design only, not implemented)

To be built when counsel requires deletion. It is a workflow, never a side effect of a rights decision.

1. **Authority.** A purge needs a recorded legal-basis reference, a scope (a source, or a set of artifacts) and a reason code. It is requested with a dedicated permission that is **not** `corpus:review` and **not** `corpus:publish`.
2. **Two people.** The approver is not the requester. Decisions are append-only. A legal-hold flag blocks a purge.
3. **Dry run first.** A report lists what would be purged, by id, size and checksum only, never content.
4. **Scope.** The raw object, the extracted text, and the passages, evidence and candidates of versions that were never published. A published version must first be withdrawn through the lifecycle. Withdrawal leaves passages frozen, so a purge has to be a deliberate, narrow exception to immutability. It is either a dedicated `SECURITY DEFINER` function or a dedicated role; either enters the reviewed definer inventory on purpose, and the immutability triggers stay in force for everyone else.
5. **A tombstone replaces the content.** It keeps artifact, source and job ids, checksum, byte size, media type, acquisition time, the rights decision ids relied on, the purge decision id, actors, timestamps, reason code and legal-basis reference. That is enough to prove what was acquired and that it was purged, and to refuse re-acquiring identical bytes if policy says so. It holds no content.
6. **Crash-safe and visible.** Record intent, delete the object and verify it is absent, purge the database rows, record completion. Idempotent and resumable; a failure leaves a visible incomplete state, never a silent partial purge.
7. **Audited.** `purge_requested`, `purge_approved`, `purge_executed` and refusals, by identifier only.
8. **Precondition.** Counsel's retention rules: whether purge is mandatory, on what timetable, what evidence must be kept, and what backups are in scope.

## 5. Future exception workflow for low-quality extraction (not implemented)

**Today:** an extraction below the quality floor ends as `needs_review` / `extraction_quality_low`. A reviewer can reject or hold it. There is **no override**. The remedy is a better source, or OCR when it exists, and a new job. Other review-class failures (`unsupported_format`, `parse_failed`, `metadata_invalid`, `duplicate_detected`) are not covered by this workflow.

**Requirement, if it is ever built.** Accepting a low-quality extraction happens only through an explicit exception, recorded append-only, with:

- the reviewer;
- the reason (a reason code, not free text alone);
- the quality warning: the score, the threshold, the extractor version and the warnings at that moment;
- the affected document, version, artifact and checksum;
- the timestamp.

Further conditions:

- A dedicated permission, distinct from `corpus:review` and `corpus:publish`.
- **A second person must approve before the material becomes publishable or searchable.** The second person is not the reviewer who raised the exception.
- The exception stays visible: in the review packet, and as a flag that later stages can use to exclude the version from search until the second approval is recorded.
- Audit events by identifier. A re-extraction (for example after OCR) supersedes the exception.

It is not needed to complete Stage 5, so it is not built.

## 6. Fixtures and citation patterns

- Only clearly labelled **synthetic** fixtures are committed. No real Ghanaian judgment or legislation is used as a parser fixture until source rights and licensing are confirmed, and any real fixture then needs the same rights record as any other use.
- Building a real parser needs **representative lawful samples**. Building citation-pattern detection needs **verified conventions** from counsel or an authoritative source. Neither is guessed. Until then the only citations ingestion detects are explicit `Cites:` labels in controlled and synthetic documents.
