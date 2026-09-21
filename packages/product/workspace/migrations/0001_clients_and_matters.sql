-- Tenant-private client and matter foundations.
--
-- Matter access, private documents, Firm Knowledge, retrieval,
-- AI execution and work products are intentionally outside this migration.

CREATE SCHEMA IF NOT EXISTS workspace;

CREATE TABLE workspace.clients (
    organization_id uuid NOT NULL,
    id uuid NOT NULL,
    name text NOT NULL,
    reference text NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT clients_pk
        PRIMARY KEY (organization_id, id),

    CONSTRAINT clients_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES iam.organizations(id),

    CONSTRAINT clients_name_check
        CHECK (length(btrim(name)) BETWEEN 1 AND 300),

    CONSTRAINT clients_reference_check
        CHECK (
            reference IS NULL
            OR length(btrim(reference)) BETWEEN 1 AND 128
        ),

    CONSTRAINT clients_status_check
        CHECK (status IN ('active', 'archived'))
);

CREATE INDEX clients_org_status_idx
    ON workspace.clients (organization_id, status);

CREATE TABLE workspace.matters (
    organization_id uuid NOT NULL,
    id uuid NOT NULL,
    client_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    name text NOT NULL,
    reference text NULL,
    status text NOT NULL DEFAULT 'open',
    opened_at timestamptz NULL,
    closed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT matters_pk
        PRIMARY KEY (organization_id, id),

    CONSTRAINT matters_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES iam.organizations(id),

    CONSTRAINT matters_client_fk
        FOREIGN KEY (organization_id, client_id)
        REFERENCES workspace.clients(organization_id, id),

    CONSTRAINT matters_jurisdiction_fk
        FOREIGN KEY (jurisdiction_id)
        REFERENCES corpus.jurisdictions(id),

    CONSTRAINT matters_name_check
        CHECK (length(btrim(name)) BETWEEN 1 AND 300),

    CONSTRAINT matters_reference_check
        CHECK (
            reference IS NULL
            OR length(btrim(reference)) BETWEEN 1 AND 128
        ),

    CONSTRAINT matters_status_check
        CHECK (status IN ('open', 'closed', 'archived')),

    CONSTRAINT matters_closed_state_check
        CHECK (
            (status = 'closed' AND closed_at IS NOT NULL)
            OR
            (status <> 'closed' AND closed_at IS NULL)
        )
);

CREATE INDEX matters_org_client_idx
    ON workspace.matters (organization_id, client_id);

CREATE INDEX matters_org_jurisdiction_idx
    ON workspace.matters (organization_id, jurisdiction_id);

CREATE INDEX matters_org_status_idx
    ON workspace.matters (organization_id, status);

CALL app.enable_tenant_rls('workspace.clients');
CALL app.enable_tenant_rls('workspace.matters');

REVOKE ALL ON workspace.clients FROM PUBLIC;
REVOKE ALL ON workspace.matters FROM PUBLIC;

GRANT USAGE ON SCHEMA workspace TO legalintel_app;

GRANT SELECT, INSERT, UPDATE
    ON workspace.clients
    TO legalintel_app;

GRANT SELECT, INSERT, UPDATE
    ON workspace.matters
    TO legalintel_app;

COMMENT ON SCHEMA workspace IS
    'Tenant-private law-firm operational data.';

COMMENT ON TABLE workspace.clients IS
    'Organization-private clients protected by tenant RLS.';

COMMENT ON TABLE workspace.matters IS
    'Organization-private matters with tenant-safe client ownership.';
