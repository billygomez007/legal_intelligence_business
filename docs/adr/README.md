# Architecture Decision Records

An ADR records one significant decision: the context, the decision, and the consequences, including the ones we do not like. ADRs are written when the decision is implemented, so each one describes code that exists.

**Rules**

- One decision per file, numbered, never renumbered.
- Do not edit an accepted ADR to change its meaning. Write a new ADR that supersedes it and mark the old one `Superseded by ADR-XXXX`.
- Changes touching tenancy, authentication, legal-data provenance or AI grounding need an ADR or an explicit statement in the PR that none is needed.

**Template**

```markdown
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD
- Stage: N

## Context
## Decision
## Consequences
## Alternatives considered
```

## Index

| ADR                                                     | Title                                                                  | Status   |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| [0001](0001-modular-monolith-and-layering.md)           | Modular monolith in a monorepo, with a product-agnostic platform layer | Accepted |
| [0002](0002-toolchain-and-version-policy.md)            | Toolchain and dependency version policy                                | Accepted |
| [0003](0003-postgresql-migrations-and-roles.md)         | PostgreSQL, SQL-first forward-only migrations, four database roles    | Accepted |
| [0004](0004-tenancy-and-row-level-security.md)          | Tenant isolation with restrictive row-level security                   | Accepted |
| [0005](0005-authentication-authorization-and-audit.md)  | Authentication, authorization and audit                                | Accepted |
| [0006](0006-legal-corpus-provenance-rights-and-publication.md) | Legal corpus: provenance, rights and publication | Accepted |
