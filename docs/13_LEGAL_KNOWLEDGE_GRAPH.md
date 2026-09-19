# Legal Knowledge Graph

## Purpose
Represent legal relationships rather than treating authorities as isolated documents.

## Node Types
- Case
- Legislation
- Provision
- Court
- Judge
- Legal concept
- Remedy
- Procedure
- Topic
- Organization (where appropriate)

## Edge Types
- cites
- followed
- applied
- distinguished
- questioned
- overruled
- mentions
- interprets
- applies_provision
- amends
- repeals
- supersedes
- concerns_concept

## Confidence
Every machine-generated edge should store confidence and review status. High-impact treatment classifications should be reviewable against source passages.

## Uses
- Cited-by views
- Authority treatment
- Related cases
- Current-law synthesis
- Legal-principle timelines
- Research recommendations

## Principle
The graph must never imply a legal relationship that cannot be traced to evidence.
