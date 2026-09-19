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

| ADR | Title | Status |
|---|---|---|
| — | none yet; the first ADRs land with Stage 1 | — |
