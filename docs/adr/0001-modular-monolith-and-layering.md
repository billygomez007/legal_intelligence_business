# ADR-0001: Modular monolith in a monorepo, with a product-agnostic platform layer

- Status: Accepted
- Date: 2026-09-19
- Stage: 1

## Context

The business intends to run more than one product over time (additional jurisdictions, enterprise modules, an external API, other business lines). Doc 10 lists ten logical services, but the team is small and the boundaries between them are not yet proven by real load or real team ownership. Two failure modes are both expensive: microservices adopted too early (operational cost, distributed transactions across what is really one data model) and a tangled monolith that cannot be split later.

## Decision

1. **One repository, pnpm workspaces + Turborepo, TypeScript strict.**
2. **A modular monolith with two deployables** (`apps/api`, `apps/worker`) sharing packages. Doc 10's services are *module boundaries*, not network boundaries.
3. **Two layers of packages, with a one-way dependency:**
   - `packages/platform/*` — product-agnostic (kernel, config, observability, db, iam, audit). Reusable by any future product.
   - `packages/legal/*` — the legal-intelligence domain. May use `platform`; `platform` may never use it.
4. **Inside a package**, `domain/` and `ports/` are pure; only `adapters/` touch infrastructure.
5. **These rules are enforced by tooling, not convention**: `dependency-cruiser` runs in CI with rules for platform→legal, packages→apps, app→app, deep imports across packages, domain→adapters, domain→db, production→test, and cycles. Each rule was verified to fire against a deliberate violation when it was introduced. ESLint additionally forbids infrastructure imports inside `domain/` and `ports/`, and forbids `process.env` outside `@legalintel/config`.
6. Packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`); apps are bundled at build time. There is no per-package build step.

## Consequences

- A second product reuses `platform/*` unchanged and adds its own `packages/<product>/*`. Nothing in `platform` needs to be renamed or untangled.
- Any module can be extracted into its own service later, because modules already interact only through ports and public entry points.
- We accept a single deployable's shared fate (one bad deploy affects the whole API) in exchange for simple transactions and operations. Revisit if a module needs an independent scaling or release profile.
- Because packages export source, they cannot be published to a registry as-is. Not a goal.
- `@legalintel/*` is a placeholder scope until the product name is decided (PROJECT_STATUS, Next Decision 1).

## Alternatives considered

- **Microservices now.** Rejected: cost without proven boundaries; the ingestion, corpus and search data are tightly related.
- **Single package with folders.** Rejected: the platform/legal separation cannot be enforced, and reuse for a second product would require untangling.
- **Nx.** Capable, but heavier than needed; Turborepo plus dependency-cruiser covers current needs with less to learn.
