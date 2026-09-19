# Implementation Plan — Engineering Foundation

**Status:** Stage 0 (plan) · **Owner:** Technical lead · **Scope:** the implementation layer that sits *around* docs 01–24, which remain the product and architecture source of truth.

This plan is deliberately short. Decisions are recorded in [`adr/`](adr/README.md) as they are implemented, so the ADRs describe code that exists rather than code that is hoped for.

## 0. Inputs, assumptions and open decisions

**Inputs.** Docs 06, 07, 10–20 and `AGENTS.md` (its non-negotiable product rules are treated as acceptance criteria, not guidance).

**Assumption to reconcile.** The kickoff brief refers to a previously provided *foundation specification*. It was not available when this plan was written. Requirements here come from the brief and the docs. If the specification differs, the specification wins and this plan gets amended.

**Not engineering's decision (the foundation is built so none of these block Stages 1–5):**

| Open decision | Why it is not blocked |
|---|---|
| Final product/company name | Package scope `@legalintel/*` is a placeholder; renaming is mechanical. |
| Source licensing / rights | Rights are modelled as data and enforced by the platform (§5). No real legal content is committed. |
| Hosting provider | Containers + PostgreSQL + S3-compatible storage only; no cloud SDKs in domain code. |
| Identity provider | Sits behind a port (§4). |
| LLM / embedding provider | Sits behind a port (§6). Tests use a deterministic fake. |

**Deliberately not built:** any UI or dashboard, real legal content, consumer case-win prediction, a lawyer-referral marketplace (`AGENTS.md`).

## 1. Monorepo structure

pnpm workspaces + Turborepo. TypeScript strict. Internal packages export TypeScript source (no per-package build); apps are bundled for deployment.

```
apps/
  api/            HTTP API (composition root)                    Stage 8
  worker/         job worker: ingestion, indexing, alerts        Stage 9
  web/            deferred until the platform layers are proven
packages/
  platform/       PRODUCT-AGNOSTIC foundation, reusable by any future business line
    kernel/         branded IDs, Result, typed errors, clock
    config/         zod-validated environment
    observability/  logging (with redaction), tracing, metrics
    db/             migration runner, role bootstrap, tenant transactions, test harness
    iam/            organizations, memberships, roles/permissions, API keys, tenant context
    audit/          append-only audit events
  legal/          LEGAL-INTELLIGENCE product domain
    corpus/         jurisdictions, courts, sources, rights, documents, versions, passages, citations
    ingestion/      pipeline state machine, rights gate, review queue
    search/         retrieval ports, Postgres hybrid implementation, evaluation harness
    research/       AI/RAG contracts, citation verifier, abstention, audit contract
    workspace/      projects, saved authorities, notes (tenant-private)
infra/            docker-compose and local-infrastructure config
docs/             existing planning docs + this plan + adr/
```

Shared tooling configuration (`tsconfig.base.json`, `eslint.config.js`, `.dependency-cruiser.cjs`, the dependency `catalog:` in `pnpm-workspace.yaml`) lives at the repository root.

**Layering rules (enforced in CI by dependency-cruiser, not by convention):**

1. `platform/*` never imports `legal/*` — this is what keeps the foundation reusable for other products.
2. `apps/*` may import packages; packages never import apps.
3. Inside a package, `domain/` and `ports/` are pure: no database, network or filesystem imports. Only `adapters/` touch infrastructure.
4. No import cycles.

## 2. Major packages and services

Two deployables from one codebase — **a modular monolith**. The ten logical services in doc 10 are module boundaries, not network boundaries; a team this size should not pay the operational cost of microservices before a boundary is proven. Any module can be extracted later because it already talks to others only through ports.

| Doc 10 service | Package | Stage |
|---|---|---|
| Identity & Organizations | `platform/iam` | 3 |
| Legal Corpus | `legal/corpus` | 4 |
| Ingestion | `legal/ingestion` | 5 |
| Search/Retrieval | `legal/search` | 6 |
| AI Research | `legal/research` | 7 |
| Knowledge Graph | `legal/corpus` (edges) → own package if it outgrows it | 4 |
| Research Workspace | `legal/workspace` | 5–6 |
| Alerts, Billing | ports + schema stubs only until Phase 2 | later |
| Admin/Data Ops | permissions + DB role now, UI later | 4 |

Python is permitted by doc 10 for OCR/ML workers. It is not needed before Stage 5; the worker contract will be language-neutral JSON Schema so a Python worker can be added without touching TypeScript code.

## 3. Database and tenancy

**PostgreSQL 16+** is the system of record. **SQL-first, forward-only migrations** with recorded checksums (an edited historical migration fails the run). Row-level security, triggers, roles and generated columns are first-class here, and an ORM schema DSL would hide exactly the parts that matter. Typed queries via Kysely, with types generated from the migrated database and checked for drift in CI.

**Three classes of data, separated by schema and by privilege:**

| Class | Schemas | Rule |
|---|---|---|
| Public legal corpus | `corpus`, `graph` | Shared, read-only to end-user paths. Visible only when *published* **and** rights-cleared. |
| Tenant-private | `workspace`, `research`, `private_kb`, tenant rows in `iam` | Every row has `organization_id`; RLS is enforced. |
| System operational | `ingestion`, `audit`, `ops` | Never exposed to end-user paths directly. |

**Tenant isolation is enforced by the database, not by application discipline:**

- `organization_id NOT NULL` + `ENABLE` and `FORCE ROW LEVEL SECURITY` on every tenant table.
- Tenant context is set per transaction with `set_config('app.org_id', …, true)`, so it is safe under connection pooling. **Fail closed:** no context means zero rows.
- Foreign keys between tenant tables are *composite* `(organization_id, id)`. Plain foreign keys bypass RLS and would let one tenant reference (and probe the existence of) another tenant's row.
- Uniqueness is per tenant, so unique-constraint errors cannot leak existence across tenants.
- Separate login roles: `app` (end-user API, RLS applies), `ingest` (writes drafts to the corpus, no tenant access, cannot publish), `dataops` (reviews and publishes, no tenant access), and `migrator` (owns objects, unused at runtime).
- **Guardrail tests read the catalog** and fail if a table with `organization_id` lacks forced RLS, a tenant-to-tenant FK is not composite, a view lacks `security_invoker`, a `SECURITY DEFINER` function lacks a pinned `search_path`, or the runtime role can bypass RLS. Adding a tenant table without isolation cannot pass CI.

**Growth path:** a tenant can later be moved to a dedicated database (silo model) without schema change, because all access goes through the tenant transaction helper.

## 4. Authentication and permissions

**Authentication.** No home-grown credentials. The API verifies OIDC-issued JWTs (`jose`, JWKS) from whichever identity provider is chosen, and separately supports first-party **API keys** (prefix-identified, secret stored hashed, scoped, revocable). Both resolve to a `Principal`.

**Authorization is three independent checks.** Conflating them is the most common way these systems become insecure or unmaintainable.

| Axis | Question | Mechanism |
|---|---|---|
| Permissions (RBAC) | *May this principal do this?* | Deny-by-default role→permission matrix, `resource:action[:own\|any]`, no wildcards |
| Entitlements | *Has this organization paid for this?* | Plan/feature/quota, keyed by product so future products reuse it |
| Rights | *May the platform do this with this content?* | Source-rights register (§5), checked at read time |

**Request flow:** authenticate → resolve organization (must be an active member) → load roles → build `AuthzContext` → open tenant transaction → `authorize()` → act → audit. The permission matrix is generated from code into `docs/architecture/permissions-matrix.md`, and a test fails if the two drift, so changes to it are reviewed.

## 5. Legal-domain boundaries

- **Jurisdiction is a first-class, mandatory field** on every corpus row, with hierarchy, so a second country is data plus a connector, not a schema change.
- **Work / Version.** A `legal_document` is the stable identity; a `document_version` is an immutable acquisition with its checksum, source, acquisition time and lifecycle. Passages and provisions belong to a *version*, so corrections and amendments never destroy history. (This normalizes doc 12's single `LegalDocument`; it is the same data, split so versioning is possible. Compatible with Akoma Ntoso/FRBR if we adopt them for interchange.)
- **Source-rights register.** Every source has append-only rights decisions (status, allowed uses, evidence reference, reviewer). Uses are distinct: `display`, `index_search`, `ai_processing`, `derive_metadata`, `redistribute_api`, `bulk_export`. Doc 15's rule — *API rights never exceed content rights* — becomes a query filter, not a policy document.
- **Rights are enforced at read time, not only at publish time.** Revoking a source's rights immediately hides its content from end-user roles.
- **Separation of duties.** The ingestion role can produce drafts but cannot publish; publishing requires the `dataops` role and an approved rights decision.
- **Graph edges require evidence.** A citation or treatment edge must point to the passage that supports it, with confidence and review status (doc 13: the graph must never imply a relationship it cannot trace).
- **Synthetic data is labelled.** Test fixtures live under a flagged synthetic jurisdiction; API and worker refuse to start in production if any synthetic row exists. Fabricated authority cannot silently reach users.

## 6. AI/RAG boundaries

`legal/research` owns the doc 11 pipeline behind ports: `LlmProvider`, `EmbeddingProvider`, `Reranker`, `RetrievalService`. **No provider SDK appears outside `adapters/`.**

- **The citation verifier is deterministic code, not a prompt.** Every claim in a draft answer must cite a passage ID that was actually retrieved for that run, and every quotation must appear verbatim (normalized) in that passage. Anything else is dropped or downgraded to *unverified*; if too little survives, the run **abstains**. "Never fabricate authority" is enforced by a function with tests.
- **Tenant scope before ranking.** Retrieval takes an already-scoped context; private and public indexes are separate tables and separate code paths (doc 11, doc 17).
- **Untrusted input.** Retrieved and uploaded text is fenced as data in prompts; injection fixtures are part of the evaluation set.
- **Audit contract** (`AGENTS.md`): answer, document and passage IDs, citation metadata, retrieval IDs and scores, model + version, prompt-template version, timestamp, verification state. Logs carry IDs, not document text.
- **Evaluation** runs offline against fixed golden sets (retrieval, citation correctness, abstention, injection, cross-tenant). Live-model evals are manual/nightly, never a PR gate, because they are non-deterministic and cost money.

## 7. Ingestion architecture

Doc 14's fifteen stages become a **persisted, idempotent, versioned state machine** (`ingestion.runs` → `items` → `stage_executions`), not a chain of function calls.

- **Rights gate first.** A run cannot start for a source without an approved rights decision, enforced in the domain and by a database constraint. "Technically accessible" never implies "approved".
- **Idempotency key** = content checksum + stage + stage version. Re-running yields the same result; corrections create new versions.
- **Workers only talk to the queue and database.** A `JobQueue` port with a Postgres-backed adapter first (transactional enqueue, no extra infrastructure); SQS or similar can replace it without touching stage code.
- **Risk-based human review:** thresholds on extraction/OCR/metadata/citation confidence create `review_tasks`; nothing is published while one is open.
- **Publishing** is the single transition into the visible corpus and enqueues re-indexing in the same transaction.

## 8. Search architecture

Postgres full-text (`tsvector`, GIN) plus pgvector behind a `SearchIndex` port, fused with reciprocal-rank fusion. This avoids operating a second datastore while the corpus is small (doc 07: *a smaller trusted corpus with excellent retrieval*), and the port allows OpenSearch/Vespa/Qdrant later.

- Filters: jurisdiction, court, date, practice area, source type. Court hierarchy and recency are ranking signals.
- Every query declares a **purpose** (`search`, `ai`, `api`); the purpose maps to a required rights use, so restricted content never reaches RAG or API export.
- Embeddings are versioned by model in their own table, so changing model is a re-index, not a migration of documents.
- **An evaluation harness ships with the first search implementation** (recall@k, MRR, nDCG), so retrieval changes are measured. The real judgement set comes from the Phase 0 legal team; a synthetic set proves the harness.
- *pgvector is not yet installed on the current dev machine; the vector schema is therefore scheduled with Stage 6 rather than the foundation.*

## 9. Observability

Structured JSON logs (pino) with **redaction by default** (auth headers, cookies, query text, document text). Request context (request ID, organization, principal, trace ID) propagates via `AsyncLocalStorage`. OpenTelemetry API in libraries and SDK only in apps, with OTLP export configured by environment. Error reporting behind a port. AI runs are logged by ID and version, never by content. Health, readiness and migration-version endpoints; ingestion and retrieval emit domain metrics (stage duration, review-queue depth, retrieval latency, abstention rate, unsupported-claim rate — doc 21's trust metrics).

## 10. Testing strategy

| Layer | Runs against | Examples |
|---|---|---|
| Unit | pure code | permission matrix, lifecycle transitions, rights policy, citation verifier |
| Integration | **real PostgreSQL** (never a mock, never SQLite) | migrations from empty, RLS, composite FKs, rights kill-switch, role separation |
| Guardrail | the database catalog | every tenant table has forced RLS; FK/view/function rules (§3) |
| Parity | code vs database | TypeScript enums equal the SQL `CHECK` lists; `.env.example` equals the config schema |
| Contract | API schemas | zod → OpenAPI; breaking-change detection |
| AI evaluation | fixed golden sets | citation correctness, abstention, injection, cross-tenant |

CI (GitHub Actions, actions pinned by SHA): typecheck, lint, dependency rules, unit, integration on a Postgres service container, secret scan, dependency audit, CodeQL. Definition of Done follows `AGENTS.md` and the PR template.

## 11. Implementation stages

Each stage ends with the repository green (typecheck, lint, tests) and a commit.

| # | Stage | Exit criteria |
|---|---|---|
| 0 | Plan | This document. |
| 1 | **Tooling and shared kernel** | Workspace, TS/ESLint/Prettier/Vitest, dependency rules, CI, compose, `kernel`/`config`/`observability` tested. |
| 2 | **Database foundation** | Migration runner (checksums, locking), role bootstrap, tenant transaction helper, integration harness, guardrail tests. |
| 3 | **Identity, tenancy, permissions, audit** | IAM schema with RLS, permission matrix + generated docs, tenant context, API-key primitives, **cross-tenant isolation tests pass**. |
| 4 | **Legal-data foundation** | Jurisdictions, courts, source-rights register, documents/versions/passages/provisions/citations, lifecycle + rights gate in code *and* database, role separation, synthetic fixtures, parity tests. |
| 5 | Ingestion core + tenant workspace | Pipeline state machine, review queue, job-queue port; projects/notes with RLS. |
| 6 | Search | Ports, Postgres hybrid, pgvector, evaluation harness. |
| 7 | AI research core | Provider ports, deterministic citation verifier, abstention, audit contract, injection fixtures. |
| 8 | API app | Auth, tenancy, errors, OpenAPI, health, audit wiring. |
| 9 | Worker app | Queue consumers, scheduled source checks. |
| 10 | Deploy | IaC after the hosting decision; backup/restore drill; staging. |

**Web/dashboard work starts only after Stage 8.**

## 12. Principal risks

| Risk | Mitigation |
|---|---|
| Rights status is unresolved for every real source | Rights enforcement is built and tested against synthetic sources; nothing real is loaded until counsel signs off. |
| RLS regressions from future migrations | Catalog guardrail tests in CI. |
| Toolchain drift (TypeScript 7 is current but typescript-eslint supports `<6.1`) | TypeScript pinned to 6.0.x; revisit when lint support lands. |
| pgvector version and index choices can change recall | Embeddings versioned by model; evaluation harness gates changes. |
| Solo/small-team bus factor | ADRs, generated docs, one-command setup, tests as specification. |
