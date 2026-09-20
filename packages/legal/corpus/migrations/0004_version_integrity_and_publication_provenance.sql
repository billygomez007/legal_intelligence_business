-- Version integrity and publication provenance. Forward migration: corpus 0001-0003 are untouched.
-- Design: docs/adr/0008-integrity-hardening-stages-0-5.md.
--
-- Ownership: everything here is a property of the corpus and depends only on corpus (and iam)
-- objects. Nothing in this file reads an ingestion table; ingestion (a later migration set)
-- consumes what this file defines.

-- ---------------------------------------------------------------------------------------
-- 1. Succession of versions is within ONE document.
--
--    `supersedes_version_id` was a plain reference to any version in the corpus, so a version of
--    document B could claim to supersede a version of document A. That corrupts the version
--    chain a reader follows to find "the current text of this law". Version succession is a fact
--    about one work; how DIFFERENT documents relate (amends, repeals, supersedes, distinguishes,
--    cites) is a legal relationship and belongs in the citation graph, with evidence.
--
--    A composite foreign key makes the same-document rule structural. It also covers "the
--    version must exist", so the single-column key it replaces is dropped (keeping both would
--    make the reported constraint depend on which one PostgreSQL checked first).
-- ---------------------------------------------------------------------------------------
ALTER TABLE corpus.document_versions
  ADD CONSTRAINT document_versions_id_document_key UNIQUE (id, document_id);

ALTER TABLE corpus.document_versions
  DROP CONSTRAINT document_versions_supersedes_version_id_fkey;

ALTER TABLE corpus.document_versions
  ADD CONSTRAINT document_versions_supersedes_same_document
  FOREIGN KEY (supersedes_version_id, document_id)
  REFERENCES corpus.document_versions (id, document_id);

ALTER TABLE corpus.document_versions
  ADD CONSTRAINT document_versions_not_self_superseding
  CHECK (supersedes_version_id IS DISTINCT FROM id);
