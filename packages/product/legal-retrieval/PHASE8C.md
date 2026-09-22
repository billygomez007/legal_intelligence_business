# Phase 8C — PostgreSQL Ghana corpus retrieval

Implemented:

- Real PostgreSQL lexical candidate retrieval over `corpus.passages`.
- `websearch_to_tsquery('simple', ...)` query parsing.
- `to_tsvector('simple', passage.text)` matching.
- deterministic PostgreSQL relevance score.
- exact passage ID.
- exact immutable corpus document-version ID.
- stable legal-document ID used as the retrieval/provenance source ID.
- Ghana jurisdiction constrained before ranking.
- document version must be `published`.
- current acquisition-source rights must allow `ai_processing`.
- candidate count is bounded by the validated retrieval limit.
- non-corpus source kinds never hit corpus SQL.
- non-Ghana scope fails closed.

Security model:

1. SQL candidate eligibility enforces jurisdiction, lifecycle and rights.
2. Phase 8 authorized-source adapter re-authorizes each exact source/version.
3. Phase 7 re-authorizes source/version again before Work Product persistence.

No LLM, embedding provider, semantic model or external vector database is required.
