# Phase 8B — task authorization and exact source authorization

Implemented:

- Retrieval scope is derived from the current Phase 7 AI Task authorization path.
- Organization, jurisdiction, matter and scope revision are not independently
  selected by retrieval callers.
- Ghana-only boundary is enforced.
- Search adapters are source-specific.
- Candidate stores receive the already-authorized retrieval scope.
- Every candidate exact source/version is re-authorized through the accepted
  Phase 7 Work Product source reader before evidence is exposed.
- Candidate excerpts are not returned when authorization fails.
- Invalid scores and source-kind mismatches fail closed.

This creates defense in depth:

1. Search candidate generation is scope-constrained.
2. Exact source/version authorization runs again before evidence exposure.
3. Phase 7 will still re-authorize again before Work Product persistence.

Still pending:

- PostgreSQL candidate search implementation
- corpus passage query
- Firm Knowledge text/chunk search
- Matter Document text/chunk search
- retrieval session persistence
- retrieval audit
- Work Product retrieval bridge acceptance
- rights-revocation-after-retrieval live test
