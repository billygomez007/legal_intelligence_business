# System Architecture

## Principles
- Ghana-first, multi-jurisdiction-ready.
- Public corpus separated from private tenant data.
- Source provenance preserved end-to-end.
- Search and AI are independently testable.
- AI outputs are auditable.

## Suggested Application Stack
- Web: Next.js + React + TypeScript
- API/services: TypeScript-first; Python permitted for specialized ingestion/ML services
- Relational DB: PostgreSQL
- Object storage: S3-compatible
- Search: full-text engine plus vector capability
- Queue: managed job queue
- Cache: Redis-compatible
- Observability: logs, traces, metrics and error monitoring

## Logical Services
1. Identity & Organizations
2. Legal Corpus
3. Ingestion
4. Search/Retrieval
5. AI Research
6. Knowledge Graph
7. Research Workspace
8. Alerts
9. Billing
10. Admin/Data Ops

## Data Separation
Public legal corpus, customer-private documents and system operational data must be logically separated. Every private record must carry tenant ownership and authorization checks.

## Environments
Development, staging and production must have separate secrets and data. Production legal/customer documents must not be copied casually into development.
