# Legal Intelligence web foundation

A Ghana-first professional legal research **demonstration**, built with Next.js App Router, React, TypeScript and Tailwind CSS. It runs without a database, Docker, credentials, an API or an AI provider. The workspace-shaped shell is not authenticated and must not be treated as an access-control boundary.

## Run

Use Node 24+ and the repository-pinned pnpm version. From the worktree root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:3000>. Equivalent workspace command: `pnpm --filter @legalintel/web dev`. To use another port: `pnpm --filter @legalintel/web dev --port 3001`.

```sh
pnpm build:web
pnpm --filter @legalintel/web start
pnpm typecheck
pnpm lint
pnpm depcruise
pnpm test
pnpm test:web
pnpm format:check
pnpm --filter @legalintel/web exec playwright install chromium
pnpm --filter @legalintel/web test:browser
```

Browser tests use the production build on port 3100. Stop any service on that port before running them. They save desktop/mobile screenshots under `apps/web/test-results/`, which is gitignored. `pnpm test` runs the existing unit project and the frontend project; database integration tests remain a separate command.

## Architecture

- `src/app`: server-rendered route composition, shared shell layout, loading/error/not-found boundaries.
- `src/components`: reusable legal presentation and small client interaction islands.
- `src/components/ui`: buttons, headings, loading, empty, error and unavailable-source primitives.
- `src/views`: shared case/legislation detail composition.
- `src/data/types.ts`: application-facing presentation contracts, not database entities.
- `src/data/contracts.ts`: `LegalSearchClient`, `AuthorityClient`, `ResearchClient`, `AlertsClient`, `WorkspaceClient`.
- `src/data/mock-clients.ts`: asynchronous read-only implementation and the composition point for future adapters.
- `src/data/fixtures.ts`: the only source of synthetic legal records, passages, answer examples, projects, organization members and updates.
- `test`: Vitest/Testing Library behavior and contract tests, plus production-browser Playwright checks.

Pages obtain data through the adapter interfaces. Components receive typed props and never import fixtures or database packages. Dependency-cruiser rejects all imports from the web workspace into backend packages.

## Routes

| Route               | Purpose                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `/`                 | Dashboard, research box, shortcuts, recent matters, saved authorities, example updates           |
| `/ask`              | Question form, honest disconnected state, optional fixed answer example and distinct source rail |
| `/search`           | Local fixture text filtering plus jurisdiction, court, kind, year, practice area and concept     |
| `/cases/[id]`       | Overview, full synthetic source, citation links, related authorities and temporary notes         |
| `/legislation/[id]` | Instrument metadata, collapsible provision tree, amendment preview and citing cases              |
| `/sources/[id]`     | Source provenance, document version and anchor-addressable passages                              |
| `/research`         | Demonstration research matters                                                                   |
| `/research/[id]`    | Question, saved authorities/passages, temporary notes, report placeholder and history            |
| `/library`          | Saved authority filters, sorting, passage links and report empty state                           |
| `/alerts`           | Four alert types with temporary status toggles                                                   |
| `/organization`     | Members, roles, workspace, private-knowledge, billing and security placeholders                  |
| `/settings`         | Temporary profile/preferences controls and security placeholder                                  |

Example IDs: `sample-contract`, `sample-land`, `sample-employment`, `example-companies`; example matter: `sample-contract-research`. Unknown records use the not-found boundary. Sections use ordinary URL links with `?view=…`, preserving browser back/forward behavior.

## Components and visual system

Reusable legal components include `AuthorityCard`, `CaseCard`, `LegislationCard`, `SourceCard`, `SourcePassage`, `PassageViewer`, `CitationChip`, `LegalCitation`, `CourtBadge`, `VerificationBadge`, `RightsBadge`, `LegalAnswer`, `ResearchProjectCard`, `SearchFilters`, `CommandSearch`, `DemoBadge`, `EmptyState`, `ErrorState`, `LoadingSkeleton` and `Unavailable`.

Navy navigation (`#13293d`), restrained blue actions (`#285b8b`), neutral canvas and white document surfaces. Helvetica/Arial UI typography and Georgia source text use local fonts; there is no font CDN. The shared stylesheet is the visual token and component-style source. Tailwind handles composition utilities. Native semantic controls cover simple interactions; Radix Dialog provides modal focus trapping, Escape handling and focus restoration. No shadcn registry component was copied. The 21st inspiration request returned HTTP 401; its local review ran and reported informational color-token suggestions.

Desktop favors persistent navigation and adjacent source inspection. Tablet collapses the source rail below content; mobile offers a keyboard-accessible navigation dialog. Visible focus, skip navigation, form labels, table captions, current-page indicators and reduced-motion support are included.

## Mock-data and trust safety

- Every authority is explicitly named Sample/Example and uses a `DEMO-*` identifier. No real-looking citations or invented Ghanaian decisions are present.
- The demonstration banner stays visible in **all builds**, including production, because the entire app remains synthetic.
- Verification badges always say `· demo`; they do not attest to backend review.
- Primary source fixtures, structured metadata, fixed synthesis examples and user notes have distinct labels and surfaces.
- Source links open actual local fixture documents and passage anchors. Unavailable/restricted examples return no source passages or search passage IDs.
- Questions do not trigger AI. Submission reports that no answer was generated. A separate button opens a fixed illustrative answer explicitly unrelated to the question.
- Mock clients clone data on return. Notes, alert toggles and preferences are local React state only; there is no local storage, cookie, session, mutation API or persistence.
- All data has public-demo scope. There are no private records or authorization claims. Tests of mock source withholding are **not** evidence of production tenant isolation.
- Loading/error boundaries and empty/restricted states are reusable. The mock adapter normally succeeds; production API failure mapping is an integration task.

## Future API integration

Replace the adapter binding while preserving presentation contracts. Validate all HTTP responses at the adapter boundary with runtime schemas. Supply server-authorized tenant context through real identity/session services; never accept a browser-provided tenant ID as authorization. Disable shared caching for tenant data and keep public corpus and private knowledge contracts separate.

Preserve source IDs, versions, passage locators, citations, verification and rights states. Enforce source rights on the server before serialization; badge visibility is not access control. Legal answers must preserve answer text, document/passage IDs, citation metadata, model/version, retrieval IDs, creation time and verification state. The current fixed answer already has these fields and explicitly records no model or retrieval run.

Replace demonstration branding only when genuine approved sources, citation validation, API error handling, source-rights enforcement, tenant-isolation tests and AI evaluations exist. Do not expose an operational legal product merely by removing the banner.
