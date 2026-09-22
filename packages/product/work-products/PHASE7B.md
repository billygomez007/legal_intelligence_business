# Phase 7B - work-product authorization

Owner/admin: create, read, revise, submit, approve, reject, archive.
Member: create, read, revise, submit. Viewer: read only.
No platform-staff grants or API-key eligibility are contributed.

The guard consumes the existing IAM AuthzContext and its resolved permissions.
Every action in this increment requires a human user and matching organization.
Review identity is derived from that context, never from the request body.

The catalogue is tested with the real IAM composeCatalog function, without mocks.
It is NOT yet registered in the application's permission composition root.
Database persistence, source/provenance checks, Ghana entitlement revalidation,
row-level security, atomic audit, and concurrent transactions remain pending.
No HTTP route or production review endpoint is added in this increment.

The application must resolve fresh membership/permissions using existing IAM.
The resource organization and state must come from server-side storage, not client
claims. The domain transition is not a replacement for authentication or RLS.
