# Phase 7G — Ghana corpus provenance authorization

Corpus provenance now requires:

- stable legal-document ID,
- exact immutable document-version ID,
- current authorized Ghana AI Task scope,
- lifecycle state `published`,
- current `ai_processing` source right.

The database-owned `corpus.source_allows(uuid, text)` function evaluates
effective dates, expiry, denial and revocation internally using database time.

Display/search rights are not treated as AI-processing rights.

The reader returns identifiers only. It does not load legal text, passages,
OCR output, embeddings, or generated model content.

Still pending:

- Work Product database schema,
- immutable stored revisions,
- stored provenance,
- RLS,
- review persistence,
- transactional audit,
- migration registration,
- live PostgreSQL integration tests.
