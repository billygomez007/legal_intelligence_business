# Phase 7E - task-scope alignment and access reader

Task scopes use (organizationId, taskId, revision), not independent scope IDs.
Work Products now uses taskScopeRevision: number, validated as a positive safe
integer. Fixtures are updated to that representation without dropping tests.
The revision fingerprint format is v2; content hashes are unchanged. No stored
work-product rows exist in the implementation built so far; no data migration
is introduced by this contract alignment.

readAuthorizedWorkProductTaskScope uses existing PostgreSQL task/entitlement/
workspace stores by default. It requires a human, Work Products read permission,
AI Tasks read permission, matching database transaction user and organization,
a current ready Ghana scope, and the existing scope-specific permissions. Matter
ownership and jurisdiction are rechecked. Exceptions are not converted to grants.
Historical-scope retrieval is not introduced. Callers must resolve fresh IAM.

The access interface is a server-only test seam. Unit tests use recording
transactions and store fixtures. They do not establish real RLS or live database
acceptance. This reader does not lock rows or authorize individual source versions.

Pending: source-version reader, Work Products tables, transactional persistence,
row locking, audit writes, permission composition in the running app, migrations,
and real database integration tests. No production endpoint is enabled here.
