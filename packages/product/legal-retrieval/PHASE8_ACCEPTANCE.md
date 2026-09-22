# Phase 8 Acceptance — Grounded Legal Retrieval

Phase 8 establishes Ghana-only, tenant-aware, rights-aware legal retrieval for Law Afrique.

## Accepted capabilities

### Authorized retrieval scope

Retrieval is bound to the current authorized AI Task scope.

The client cannot broaden:

- organization;
- Ghana jurisdiction;
- task-scope revision;
- matter;
- private source scope.

### Ghana public corpus

Corpus retrieval:

- searches only published Ghana document versions;
- requires current `ai_processing` rights;
- does not treat display, index-search, or redistribution rights as AI-processing permission;
- returns exact document/version/passage provenance;
- fails closed when AI-processing rights are removed or revoked;
- excludes unpublished versions.

### Firm Knowledge

Firm Knowledge retrieval:

- is tenant scoped;
- uses PostgreSQL RLS;
- requires active sources;
- returns exact immutable source versions and passages;
- disappears from new retrieval after archival.

### Matter Documents

Matter Document retrieval:

- is tenant scoped;
- is restricted to the exact current task matter;
- requires active documents;
- returns exact immutable document versions and passages;
- disappears from new retrieval after archival.

### Ranking

Authorization and eligibility occur before ranking.

Phase 8 uses deterministic PostgreSQL lexical retrieval and deterministic cross-source ranking.

No external vector vendor or required LLM provider is part of the retrieval foundation.

### Query safety

Retrieval queries:

- are normalized deterministically;
- reject empty input;
- reject null bytes;
- enforce an 8 KiB maximum;
- use bounded result limits;
- generate a SHA-256 query fingerprint.

### Work Product provenance bridge

Retrieval evidence can be converted to exact Work Product provenance containing only:

- source kind;
- exact source ID;
- exact version ID;
- locator.

The bridge does not make retrieval authorization permanent.

Immediately before a Work Product revision is persisted, Phase 7 revalidates:

- current task scope;
- current matter boundary;
- exact private source availability;
- exact corpus version lifecycle;
- current corpus AI-processing rights.

Therefore stale retrieval evidence fails closed.

### Retrieval sessions

Phase 8 retrieval sessions persist only privacy-safe operational provenance:

- organization ID;
- AI Task ID;
- task-scope revision;
- Ghana jurisdiction ID;
- optional matter ID;
- scope mode;
- SHA-256 query fingerprint;
- requested limit;
- result count;
- authenticated user ID;
- exact evidence source/version/passage identifiers;
- optional locator;
- optional passage content hash.

They do not persist:

- raw query text;
- normalized query text;
- evidence excerpts;
- private document content;
- Work Product content.

Session and evidence history are immutable.

Both tables use tenant FORCE RLS.

### Audit

`legal_retrieval.session_recorded` is written in the same tenant transaction as the retrieval session.

Audit metadata contains identifiers, counts, versions and the query fingerprint only.

It does not contain raw query text, excerpts or private content.

### Database security

The `legal_retrieval` migration set is ordered after Work Products and before ingestion.

The full migration chain:

- applies cleanly to a fresh empty database;
- passes migration integrity;
- passes structural guardrails;
- regenerates the database privilege inventory;
- grants the application role only the required retrieval-session privileges;
- grants no dangerous runtime privileges.

## Acceptance evidence

Phase 8 unit suite:

- 53 tests passing.

Live private retrieval:

- Firm Knowledge tenant isolation;
- Matter exact-matter isolation;
- archived knowledge removal;
- archived matter-document removal.

Live corpus retrieval:

- current AI-processing right required;
- rights revocation removes retrieval;
- unpublished versions excluded.

Live retrieval sessions:

- query fingerprint and exact provenance persisted;
- raw query not persisted;
- excerpt not persisted;
- FORCE RLS isolation;
- immutable sessions;
- immutable evidence history.

Phase 7 Work Products live acceptance:

- 38 tests passing;
- exact-version persistence;
- tenant isolation;
- stale private evidence rejection;
- stale task-scope rejection;
- Matter boundary enforcement;
- corpus rights revalidation;
- audit rollback;
- immutable provenance/review history.

Phase 7 unit regression:

- 346 tests passing.

## Safety boundary

Phase 8 does not add:

- another jurisdiction;
- generic public-web search;
- autonomous legal filing;
- autonomous email or messaging;
- payment execution;
- automatic legal approval;
- automatic Work Product approval;
- cross-matter retrieval;
- latest-version substitution;
- fabricated citations;
- permanent authorization from stale retrieval results.

## Status

Phase 8 grounded legal retrieval foundation: **ACCEPTED**.

No production database was modified during acceptance.

No commit, push or merge is performed by the acceptance workflow.
