-- Add a specific acquisition/storage use. Historical decisions gain no implicit permission.
ALTER TABLE corpus.source_rights_decisions
  DROP CONSTRAINT source_rights_decisions_allowed_uses_check;
ALTER TABLE corpus.source_rights_decisions
  ADD CONSTRAINT source_rights_decisions_allowed_uses_check CHECK (
    allowed_uses <@ ARRAY['acquire_store', 'display', 'index_search', 'ai_processing',
                          'derive_metadata', 'redistribute_api', 'bulk_export']::text[]
  );
