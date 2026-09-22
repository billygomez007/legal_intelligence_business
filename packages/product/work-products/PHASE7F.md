# Phase 7F - exact private source-version authorization

The source reader composes existing Knowledge and Matter Document store ports.
Pass real store instances and a tenant transaction from server application code.
The reader reauthorizes the current ready Ghana task scope for every source read.
The task-scope adapter now returns its stored scopeMode to enforce source selection.

Private sources must be active and belong to the current organization. Documents
and their versions must belong to the selected matter. Versions are selected by
exact ID; a newer version is never silently substituted. Missing, duplicate, or
mismatched version records are denied. Source access errors propagate. Only minimal
reference metadata is returned, not storage keys or document contents.

Corpus references are deliberately denied. No corpus-rights implementation is
invented. Locator text is descriptive, not proof of a page/passage match. Archived
sources are blocked for new references; this does not delete historical provenance.

Tests use recording transactions and metadata fixtures, not a running PostgreSQL
database. The existing stores are explicit dependencies; application composition,
corpus-rights integration, live RLS/entitlement tests, row locks, audit persistence,
and Work Products tables/migrations still need implementation or verification.
