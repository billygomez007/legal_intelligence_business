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
| 5b Tenant workspace | Not started (not part of the ingestion stage) |

Stage 5 ingests **synthetic and controlled-source text and HTML** into the corpus as versions awaiting human review, with rights checked at every step. It does not yet include PDF or OCR extraction, a Ghanaian judgment or legislation parser, pattern-based citation detection, a worker process, an API or any UI, and no real legal source or Ghanaian reference data has been acquired. Ingestion never approves or publishes. See [`docs/architecture/stage-5-ingestion.md`](docs/architecture/stage-5-ingestion.md), [`docs/runbooks/ingestion.md`](docs/runbooks/ingestion.md) and [`docs/reviews/stage-5-existing-implementation-review.md`](docs/reviews/stage-5-existing-implementation-review.md).
