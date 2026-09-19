# Product Requirements Document (PRD)

## Product
AI-powered legal intelligence platform, Ghana-first.

## Objective
Reduce the time required to discover, verify, understand and organize legal authorities while preserving source traceability.

## Primary User
Practicing lawyer conducting Ghanaian legal research.

## Core Jobs
- Find relevant authorities.
- Understand a judgment quickly.
- Determine how an authority has been treated.
- Find similar factual/legal cases.
- Research a legal proposition.
- Save and organize research.
- Generate a source-grounded research report.
- Monitor new legal developments.

## MVP Requirements

### Search
Hybrid keyword + semantic search with filters for jurisdiction, court, date, practice area and source type.

### Ask the Law
Natural-language question → retrieved approved sources → synthesized answer → citations/source passages.

### Case Page
Metadata, facts, issues, holding, ratio/important reasoning, statutes/cases cited, related authorities, source text.

### Similar Cases
Return semantically and legally related authorities and explain the similarity.

### Citation Intelligence
Show citations between cases and, where verified, treatment such as followed/applied/distinguished/overruled/mentioned.

### Research Workspace
Projects/folders, saved authorities, notes and research history.

### Reports
Generate editable/exportable research reports with authorities.

### Alerts
Follow topics/authorities and notify users of relevant additions or changes.

### Admin / Data Ops
Review ingestion, metadata, duplicates, provenance, extraction confidence and correction history.

## Non-Functional Requirements
- Source provenance for every corpus document.
- Tenant isolation.
- Auditability of AI outputs.
- Secure document processing.
- Responsive professional UI.
- Graceful abstention when sources are insufficient.
- Jurisdiction is a first-class field.

## Out of Scope for Initial MVP
- Lawyer referral marketplace
- Consumer case-win probability
- Full billing/accounting practice management
- Automated legal representation
- Multi-country launch on day one

## Success Criteria
Lawyers can complete representative research tasks materially faster while retaining confidence in the authorities and passages used.
