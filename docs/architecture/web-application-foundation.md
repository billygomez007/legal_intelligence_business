# Web application foundation

## Scope and isolation

`apps/web` is a presentation application based on `stage-5/legal-ingestion`, built independently from the Stages 0–5 integrity hardening work. The explicit assignment authorizes a mock frontend foundation despite the older Stage 6 sequencing note in `PROJECT_STATUS.md`. It does not start backend Stage 6 search/RAG work and does not change those sequencing gates.

No IAM, configuration, database, migration runner, legal corpus, ingestion, SQL migration, backend test or GitHub Actions file is changed. The web app does not import backend packages. An explicit dependency-cruiser rule enforces that boundary.

## Composition and dependency direction

```text
Next.js routes
  → application-facing client interfaces
    → read-only synthetic adapters
  → reusable legal components (typed props)
    → semantic HTML / Tailwind / Radix Dialog
```

The browser is an untrusted presentation surface. It must never acquire direct database access, infer permissions from role labels or treat visible verification badges as proof of server authorization. Backend/domain packages stay framework-independent. A later API layer can adapt domain entities into small presentation contracts without exposing storage records, secrets or internal permission models.

The public mock binding is in `apps/web/src/data/mock-clients.ts`. Interfaces cover authority lookup and sources, legal search, research projects and the example answer, alert listing and workspace overview. There are no production API routes or mutation interfaces. Notes and alert statuses change only in the mounted view.

## Source and trust UX

| Category | Presentation | Meaning in this foundation |
| --- | --- | --- |
| Primary source | White document surface, serif passage text, version/locator | Clearly marked synthetic source fixture |
| Structured metadata | Labeled metadata panel and definition lists | Synthetic extracted/reviewed states |
| AI synthesis | Pale blue answer panel and explicit provenance/audit fields | Fixed example, no model run, unrelated to submitted questions |
| User note | Warm paper surface, editable labeled field | Temporary user-authored text, lost on navigation |

Verification and rights are separate presentation states. The demonstration adapter suppresses passages for restricted/unavailable records. Citation and provision links resolve to `/sources/[id]#passage-id`, making source inspection real even though the content is synthetic. This is not a substitute for server-side rights enforcement or tenant isolation.

The demonstration banner is unconditional, including in a production Next.js build. Neither a screenshot nor a deployed preview should imply genuine Ghanaian authority. Fixture titles, sources and identifiers also retain their own synthetic labels.

## Integration requirements, not implemented

1. Real authentication and server-authorized tenant/session context.
2. Runtime validation of API payloads and structured error mapping.
3. Approved-source search, rights-aware passage retrieval and document/version resolution.
4. AI retrieval, citation alignment, audit metadata, abstention and evaluation suites.
5. Tenant-isolated research persistence, private-document storage and permissions tests.
6. Alert configuration/delivery, report generation/export and organization administration.
7. Real source formats and citation conventions only after verified lawful samples exist.
8. Deployment security policy, production observability and operational API monitoring.

Do not send confidential documents or real client questions into this demonstration. The mock app has no identity or storage boundary to exercise; no tenant-isolation assurance is claimed.

## Tooling and validation

Root additions are limited to web commands, a frontend Vitest project, frontend dependencies in the existing pnpm catalog/lockfile, generated-output ignores, TSX dependency resolution and a web/backend import prohibition. Existing backend checks remain intact. `pnpm dev` starts the web workspace at <http://127.0.0.1:3000> without Docker.

Vitest covers navigation, dashboard, filters, source provenance, persistent demonstration labels, source/synthesis separation, keyboard dialog behavior, temporary interactions, synthetic-only records, filter combinations, inspectable citation targets and source withholding. Playwright runs the production app, visits ten core routes at desktop/mobile sizes, captures screenshots, checks browser errors and tests citation navigation, empty results, unknown/restricted records and keyboard navigation. PostgreSQL integration tests remain separate and are not required for this web-only shell.

See [web README](../../apps/web/README.md) for routing, component inventory and exact commands. See [validation record](../../apps/web/VALIDATION.md) for actual command results and browser evidence.

## Rebase plan

Finish and review this isolated branch before rebasing. Do not rebase or modify the concurrent hardening branch. After Stages 0–5 merges and parallel work is complete, the web branch can be rebased by agreement. Likely conflict surfaces are the pnpm catalog/lockfile, root scripts, lint/format ignores, Vitest config and dependency-cruiser rules. Preserve all hardening rules and regenerate the lockfile with the pinned pnpm version if necessary. Re-run the full frontend validation after reconciliation. No backend source conflict is expected from this branch's scope.
