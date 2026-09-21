CREATE SCHEMA IF NOT EXISTS knowledge;

REVOKE ALL ON SCHEMA knowledge FROM PUBLIC;
GRANT USAGE ON SCHEMA knowledge TO legalintel_app;

CREATE TABLE knowledge.sources (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  name text NOT NULL,
  description text NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_sources_pk
    PRIMARY KEY (organization_id, id),

  CONSTRAINT knowledge_sources_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES iam.organizations(id),

  CONSTRAINT knowledge_sources_name_not_blank
    CHECK (btrim(name) <> ''),

  CONSTRAINT knowledge_sources_status_check
    CHECK (status IN ('active', 'archived'))
);

CREATE INDEX knowledge_sources_org_status_idx
  ON knowledge.sources (organization_id, status);

CREATE TABLE knowledge.source_versions (
  organization_id uuid NOT NULL,
  id uuid NOT NULL,
  source_id uuid NOT NULL,
  version_number integer NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  storage_key text NOT NULL,
  content_sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT knowledge_source_versions_pk
    PRIMARY KEY (organization_id, id),

  CONSTRAINT knowledge_source_versions_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES iam.organizations(id),

  CONSTRAINT knowledge_source_versions_source_fk
    FOREIGN KEY (organization_id, source_id)
    REFERENCES knowledge.sources(organization_id, id),

  CONSTRAINT knowledge_source_versions_number_unique
    UNIQUE (organization_id, source_id, version_number),

  CONSTRAINT knowledge_source_versions_storage_key_unique
    UNIQUE (organization_id, storage_key),

  CONSTRAINT knowledge_source_versions_version_positive
    CHECK (version_number > 0),

  CONSTRAINT knowledge_source_versions_filename_not_blank
    CHECK (btrim(original_filename) <> ''),

  CONSTRAINT knowledge_source_versions_mime_not_blank
    CHECK (btrim(mime_type) <> ''),

  CONSTRAINT knowledge_source_versions_storage_key_not_blank
    CHECK (btrim(storage_key) <> ''),

  CONSTRAINT knowledge_source_versions_sha256_format
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT knowledge_source_versions_size_nonnegative
    CHECK (size_bytes >= 0)
);

CREATE INDEX knowledge_source_versions_source_idx
  ON knowledge.source_versions (
    organization_id,
    source_id,
    version_number DESC
  );

CALL app.enable_tenant_rls('knowledge.sources'::regclass);
CALL app.enable_tenant_rls('knowledge.source_versions'::regclass);

REVOKE ALL ON knowledge.sources FROM PUBLIC;
REVOKE ALL ON knowledge.source_versions FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE
  ON knowledge.sources
  TO legalintel_app;

GRANT SELECT, INSERT
  ON knowledge.source_versions
  TO legalintel_app;
