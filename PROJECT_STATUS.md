# Project Status

## Current Stage
**Business definition / pre-build planning**

## Completed
- Business model defined
- Product positioning defined
- Target-user segments defined
- MVP scope defined
- PRD drafted
- System architecture drafted
- AI/RAG architecture drafted
- Core data model drafted
- Knowledge graph design drafted
- Ingestion pipeline drafted
- Trust/source-verification rules drafted
- Security/privacy requirements drafted
- Legal/compliance review checklist drafted
- Go-to-market plan drafted
- Roadmap and metrics drafted

## Next Decisions
1. Final product/company name
2. Confirm source-access and licensing strategy with Ghanaian counsel
3. Recruit lawyer design partners
4. Select initial legal corpus
5. Select final technical stack and hosting
6. Build ingestion proof of concept
7. Build search evaluation dataset
8. Build Ask the Law prototype
9. Validate willingness to pay
10. Define launch pricing

## Current Build Priority
**Phase 0: source rights + corpus + legal taxonomy + design partners**

Then:
**Phase 1: ingestion + search + source-grounded AI research**

## Engineering Foundation (parallel track)
The technical foundation is being built in stages around the planning docs, without waiting on Phase 0 business decisions. It contains no real legal content and no UI. See [`docs/25_IMPLEMENTATION_PLAN.md`](docs/25_IMPLEMENTATION_PLAN.md) for stages and exit criteria.

| Stage | Status |
|---|---|
| 0 Plan | Done |
| 1 Tooling and shared kernel | Done |
| 2 Database foundation | Done |
| 3 Identity, tenancy, permissions, audit | Done |
| 4 Legal-data foundation | Done |
| 5 Ingestion core (public corpus) | Built on `stage-5/legal-ingestion`; in review, not merged |
| 5b Tenant workspace | Not started. Private tenant ingestion stays separate from the public legal corpus |

Stage 5 ingests **synthetic and controlled-source text and HTML** into the corpus as versions awaiting human review, with rights checked at every step. It does not yet include PDF or OCR extraction, a Ghanaian judgment or legislation parser, pattern-based citation detection, a worker process, an API or any UI, and no real legal source or Ghanaian reference data has been acquired. Ingestion never approves or publishes. See [`docs/architecture/stage-5-ingestion.md`](docs/architecture/stage-5-ingestion.md), [`docs/runbooks/ingestion.md`](docs/runbooks/ingestion.md) and [`docs/reviews/stage-5-existing-implementation-review.md`](docs/reviews/stage-5-existing-implementation-review.md).

### Integrity hardening of Stages 0–5 (2026-09-20, branch `hardening/stages-0-5-integrity`)
Before the stack is merged, an independent review's remaining integrity gaps were closed with three forward migrations (`iam/0002`, `corpus/0004`, `ingestion/0002`), each enforced by the database and tested against direct SQL. Recorded in [ADR-0008](docs/adr/0008-integrity-hardening-stages-0-5.md).

- Deployment tooling requires an explicit `APP_ENV`; the synthetic-data guards fail closed.
- The role-assignment hierarchy is enforced by the database as well as by the application.
- A version may supersede only a version of the same document.
- The requester of an ingestion cannot approve it (ingestion; approval only).
- Publish-critical metadata must be verified by a person, field by field, before approval; machine evidence is never edited or marked verified.
- Approval and publication require a corpus-owned provenance attestation, written only by ingestion's checked function after its evidence checks pass.

Not claimed: there is no reviewer-facing entry path for a legislation identifier or for correcting reviewed metadata, no protection against one person holding two accounts, and requester-is-not-approver is enforced at the ingestion mirror of a decision rather than in the corpus. See the known limits in ADR-0008. Remote CI has not run for these commits (the account restriction is unresolved); the evidence is the local gate recorded in the pull request.

### Founder decisions on Stage 5 (2026-09-19)
- Revoked rights do not purge stored raw bytes automatically. The material becomes unusable at once for display, search, AI processing and redistribution; the bytes are restricted provenance and evidence only. Retention and deletion are a legal-policy decision not yet made. An audited purge workflow is designed, not built.
- No real Ghanaian judgment or legislation is used as a fixture until source rights and licensing are confirmed. Fixtures stay clearly labelled synthetic.
- No citation formats are invented. Real citation support waits for verified conventions and representative lawful samples.
- A low-quality extraction may be accepted only through a future exception workflow with a second person's approval before it becomes publishable or searchable. Not built.

Details: [`docs/architecture/ingestion-retention-and-exceptions.md`](docs/architecture/ingestion-retention-and-exceptions.md) and ADR-0007.

### Sequencing gate for Stage 6
Stage 6 (search, embeddings, pgvector, hybrid retrieval, reranking, RAG, "Ask the Law", AI summaries and dashboard UI) does not start until: remote CI is available and green for PR #1; PR #1 is approved by the founder and merged with a merge commit; PR #2 is retargeted to `main` and its diff is confirmed to be Stage 5 only; CI is green for PR #2; PR #2 is approved and merged with a merge commit. Only then is the Stage 6 branch created. Neither PR is merged without explicit founder approval.
