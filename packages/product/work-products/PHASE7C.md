# Phase 7C - content revisions and provenance preparation

This increment prepares immutable content snapshots and the next review state.
It requires a ready, authorized Ghana task scope, exact source/version identities,
same-organization private knowledge, same-matter documents, and Ghana corpus rights.

The server-only source-reader port has no production adapter or permissive default.
Its adapter must load real records and enforce current membership, task-scope
selection, source access, entitlements, and corpus rights inside the caller's
transaction. Client-provided authorization flags are never valid evidence.
Unit tests use reader fixtures; they do not prove real database access or RLS.

The preparation function copies input before awaiting readers, preserves content
exactly, bounds UTF-8 content to 1 MiB and references to 100, rejects duplicate
references, and fingerprints content plus revision metadata. Fingerprints are
integrity values, not signatures or proof that legal content is correct.
Every new revision gets a new ID and resets current approval while preserving
historical decisions. A scope/reference-only change is also a new revision.

Pending: source-reader database implementation, durable revisions, transaction
locking, audit persistence, forward migrations, package/application registration,
RLS, live entitlement revalidation, and end-to-end integration tests. No API route,
model execution, database write, or generated legal output is added here.
