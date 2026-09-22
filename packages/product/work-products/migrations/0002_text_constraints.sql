-- PostgreSQL text cannot contain a zero byte. chr(0) itself raises 54000,
-- so testing position(chr(0) IN text) rejects valid writes as well.
-- Keep the application input checks and let PostgreSQL's text input enforce
-- its native null-byte restriction. Replace only the broken CHECK expressions;
-- no content, history, privileges, RLS policies or triggers are changed.

ALTER TABLE work_products.revisions
  DROP CONSTRAINT work_product_revision_content_nonempty,
  ADD CONSTRAINT work_product_revision_content_nonempty
    CHECK (length(content) > 0 AND octet_length(content) <= 1048576);

ALTER TABLE work_products.revision_provenance
  DROP CONSTRAINT work_product_provenance_locator_valid,
  ADD CONSTRAINT work_product_provenance_locator_valid
    CHECK (
      locator IS NULL
      OR (length(locator) BETWEEN 1 AND 512 AND locator = btrim(locator))
    );

ALTER TABLE work_products.reviews
  DROP CONSTRAINT work_product_review_reason_valid,
  ADD CONSTRAINT work_product_review_reason_valid
    CHECK (reason IS NULL OR length(reason) <= 2000);
