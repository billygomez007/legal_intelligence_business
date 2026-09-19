# ADR-0002: Toolchain and dependency version policy

- Status: Accepted
- Date: 2026-09-19
- Stage: 1

## Context

The toolchain was chosen against what was actually current on 2026-09-19, and two findings changed the obvious choices:

1. TypeScript's `latest` is 7.0.x, but `typescript-eslint` 8.70 declares support for `typescript <6.1.0`.
2. pnpm 11 enforces a minimum release age. The first install pinned three packages published less than 24 hours earlier, and pnpm responded by adding per-package exclusions to `pnpm-workspace.yaml`.

## Decision

- **TypeScript is pinned to 6.0.x.** Type-aware linting (`no-floating-promises`, `no-misused-promises`, no unsafe `any`) matters more for a platform handling legal data than a newer compiler. Revisit when `typescript-eslint` supports 7.
- **ESLint uses `strictTypeChecked` + `stylisticTypeChecked`**, plus project rules: no `console` (use the redacting logger), no `process.env` outside `@legalintel/config`, and purity restrictions on `domain/` and `ports/`.
- **All third-party versions are exact and live in one place** (the `catalog:` in `pnpm-workspace.yaml`). No ranges. Dependabot proposes upgrades with a three-day cooldown.
- **We do not bypass the minimum-release-age guard.** The auto-added exclusions were removed and the three packages were pinned to the newest versions that had already aged past the window (`eslint 10.10.0`, `turbo 2.10.13`, `@types/node 24.13.5`).
- **Vitest with two projects**: `unit` (pure, always runs) and `integration` (real PostgreSQL, never mocked).
- **GitHub Actions are pinned to full commit SHAs**, workflow permissions default to `contents: read`, checkout does not persist credentials, and the secret scan runs over full history.
- **Prettier does not touch authored prose** (`docs/`, top-level markdown, `.github` templates).

## Consequences

- We run a compiler one major version behind. Acceptable: nothing in this codebase depends on TypeScript 7 features.
- Upgrades are deliberate, reviewable pull requests instead of ambient drift.
- A newly published fix for a vulnerability is delayed by the cooldown. If an urgent security patch is needed, exclude that one version explicitly, in the PR that needs it, with the advisory linked.
- CodeQL and GitHub dependency review are **not** enabled: on a private repository they require GitHub Advanced Security. `pnpm audit` and gitleaks cover the gap. Enable both if the repository becomes public or the licence is added.

## Alternatives considered

- **TypeScript 7 with reduced linting.** Rejected: loses the lint rules that catch the most consequential bug classes.
- **Biome instead of ESLint + Prettier.** Faster, but its type-aware rule coverage is narrower than `typescript-eslint`.
- **Version ranges (`^`).** Rejected: a legal-data platform benefits from reproducible builds and reviewed upgrades.
