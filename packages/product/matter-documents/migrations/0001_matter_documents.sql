CREATE SCHEMA IF NOT EXISTS matter_documents;

REVOKE ALL ON SCHEMA matter_documents FROM PUBLIC;
GRANT USAGE ON SCHEMA matter_documents TO legalintel_app;

CREATE TABLE matter_documents.documents (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  matter_id uuid NOT NULL,
  name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT matter_documents_documents_pkey
    PRIMARY KEY (organization_id, id),

  CONSTRAINT matter_documents_documents_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES iam.organizations(id),

  CONSTRAINT matter_documents_documents_matter_fkey
    FOREIGN KEY (organization_id, matter_id)
    REFERENCES workspace.matters(organization_id, id),

  CONSTRAINT matter_documents_documents_name_nonblank
    CHECK (btrim(name) <> ''),

  CONSTRAINT matter_documents_documents_status_check
    CHECK (status IN ('active', 'archived')),

  CONSTRAINT matter_documents_documents_org_matter_id_unique
    UNIQUE (organization_id, matter_id, id)
);

CREATE INDEX matter_documents_documents_matter_idx
  ON matter_documents.documents (organization_id, matter_id, created_at DESC);

CREATE INDEX matter_documents_documents_status_idx
  ON matter_documents.documents (organization_id, matter_id, status);

CREATE TABLE matter_documents.document_versions (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  matter_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version_number integer NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  storage_key text NOT NULL,
  content_sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT matter_documents_document_versions_pkey
    PRIMARY KEY (organization_id, id),

  CONSTRAINT matter_documents_document_versions_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES iam.organizations(id),

  CONSTRAINT matter_documents_document_versions_matter_fkey
    FOREIGN KEY (organization_id, matter_id)
    REFERENCES workspace.matters(organization_id, id),

  CONSTRAINT matter_documents_document_versions_document_fkey
    FOREIGN KEY (organization_id, matter_id, document_id)
    REFERENCES matter_documents.documents(organization_id, matter_id, id),

  CONSTRAINT matter_documents_document_versions_number_positive
    CHECK (version_number > 0),

  CONSTRAINT matter_documents_document_versions_filename_nonblank
    CHECK (btrim(original_filename) <> ''),

  CONSTRAINT matter_documents_document_versions_mime_nonblank
    CHECK (btrim(mime_type) <> ''),

  CONSTRAINT matter_documents_document_versions_storage_nonblank
    CHECK (btrim(storage_key) <> ''),

  CONSTRAINT matter_documents_document_versions_sha256_check
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT matter_documents_document_versions_size_nonnegative
    CHECK (size_bytes >= 0),

  CONSTRAINT matter_documents_document_versions_version_unique
    UNIQUE (organization_id, document_id, version_number),

  CONSTRAINT matter_documents_document_versions_storage_unique
    UNIQUE (organization_id, storage_key)
);

CREATE INDEX matter_documents_document_versions_document_idx
  ON matter_documents.document_versions (
    organization_id,
    matter_id,
    document_id,
    version_number DESC
  );

CALL app.enable_tenant_rls('matter_documents.documents'::regclass);
CALL app.enable_tenant_rls('matter_documents.document_versions'::regclass);

GRANT SELECT, INSERT, UPDATE
  ON matter_documents.documents
  TO legalintel_app;

GRANT SELECT, INSERT
  ON matter_documents.document_versions
  TO legalintel_app;
