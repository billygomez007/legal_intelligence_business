# AI Coding Agent Instructions

## Mission
Build a source-grounded legal intelligence platform for Ghana first, with architecture that can support additional African jurisdictions later.

## Read Before Coding
At minimum, read:
1. `README.md`
2. `docs/06_PRD.md`
3. `docs/07_MVP_SCOPE.md`
4. `docs/10_SYSTEM_ARCHITECTURE.md`
5. `docs/11_AI_RAG_ARCHITECTURE.md`
6. `docs/12_DATA_MODEL.md`
7. `docs/16_SOURCE_VERIFICATION.md`
8. `docs/17_SECURITY_PRIVACY.md`
9. `docs/18_LEGAL_COMPLIANCE_CHECKLIST.md`

## Non-Negotiable Product Rules
- Never fabricate cases, citations, statutes, or source passages.
- AI legal answers must be grounded in retrieved approved sources.
- Private tenant documents must never leak across tenants.
- Public corpus and private knowledge must be logically separated.
- Preserve source provenance and document version information.
- Do not implement consumer-facing numerical case-win predictions as a default feature.
- Do not implement a lawyer-referral marketplace without explicit legal/product approval.
- Do not treat AI output as authoritative source text.

## Engineering Rules
- TypeScript-first for web application code unless a service has a clear reason to use Python.
- Use schema validation on API boundaries.
- Add migrations for database changes.
- Add automated tests for critical retrieval, permissions, and citation paths.
- Never commit secrets.
- Use environment variables for credentials.
- Log AI model/version and retrieval IDs needed for auditability without logging unnecessary sensitive document contents.

## AI Output Contract
For legal research answers, preserve:
- answer text
- source document IDs
- source passage IDs
- citation metadata
- model/version
- retrieval trace or retrieval IDs
- creation time
- verification state

## Definition of Done
A feature is not done if:
- source citations cannot be opened
- private data isolation is untested
- legal-data provenance is missing
- AI evaluation was skipped for an AI behavior change
- error/empty states are missing
