-- Phase 2A: organization authorization for canonical legal jurisdictions.
--
-- This migration is owned by the entitlements migration set. The set runs
-- after IAM and the legal corpus because this policy references both
-- iam.organizations/users and the canonical corpus.jurisdictions registry.
-- Tenant-owned policy state MUST NOT live in the public corpus schema.
-- Public corpus tables remain tenant-free.
--
-- This migration does not implement retrieval, Matters, Firm Knowledge,
-- private-document ingestion, HTTP APIs, or jurisdiction reference-data
-- bootstrap.

CREATE SCHEMA IF NOT EXISTS policy;

CREATE TABLE policy.organization_jurisdictions (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,

    status text NOT NULL DEFAULT 'active',

    granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    granted_by uuid NULL,

    revoked_at timestamptz NULL,
    revoked_by uuid NULL,

    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT organization_jurisdictions_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES iam.organizations(id),

    CONSTRAINT organization_jurisdictions_jurisdiction_fk
        FOREIGN KEY (jurisdiction_id)
        REFERENCES corpus.jurisdictions(id),

    CONSTRAINT organization_jurisdictions_granted_by_fk
        FOREIGN KEY (granted_by)
        REFERENCES iam.users(id),

    CONSTRAINT organization_jurisdictions_revoked_by_fk
        FOREIGN KEY (revoked_by)
        REFERENCES iam.users(id),

    CONSTRAINT organization_jurisdictions_status_check
        CHECK (status IN ('active', 'revoked')),

    CONSTRAINT organization_jurisdictions_revocation_state_check
        CHECK (
            (
                status = 'active'
                AND revoked_at IS NULL
                AND revoked_by IS NULL
            )
            OR
            (
                status = 'revoked'
                AND revoked_at IS NOT NULL
            )
        ),

    CONSTRAINT organization_jurisdictions_org_id_unique
        UNIQUE (organization_id, id),

    CONSTRAINT organization_jurisdictions_org_jurisdiction_unique
        UNIQUE (organization_id, jurisdiction_id)
);

CREATE INDEX organization_jurisdictions_jurisdiction_idx
    ON policy.organization_jurisdictions (jurisdiction_id);

CREATE INDEX organization_jurisdictions_active_org_idx
    ON policy.organization_jurisdictions (organization_id, jurisdiction_id)
    WHERE status = 'active';

CALL app.enable_tenant_rls('policy.organization_jurisdictions');

REVOKE ALL
    ON policy.organization_jurisdictions
    FROM PUBLIC;

GRANT USAGE
    ON SCHEMA policy
    TO legalintel_app;

GRANT SELECT
    ON policy.organization_jurisdictions
    TO legalintel_app;

COMMENT ON TABLE policy.organization_jurisdictions IS
    'Tenant-owned authorization policy linking an organization to canonical legal jurisdictions. This table is not part of the public legal corpus.';
