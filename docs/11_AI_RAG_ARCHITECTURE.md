# AI / RAG Architecture

## Core Flow
User question
→ intent classification
→ query expansion
→ hybrid retrieval
→ authority ranking/reranking
→ passage selection
→ context construction
→ grounded generation
→ citation alignment/verification
→ response with sources
→ audit trace

## Retrieval
Combine:
- lexical/full-text matching
- semantic embeddings
- legal metadata filters
- court/source authority signals
- recency/version signals where appropriate

## Answer Contract
Store:
- answer text
- source document IDs
- passage IDs
- citation metadata
- retrieval IDs/scores
- model/version
- prompt/template version
- timestamp
- verification state

## Guardrails
- No authority in the answer unless retrieved/verified.
- Never manufacture citations.
- If evidence is insufficient, abstain or qualify.
- Separate source quotations from AI synthesis.
- Uploaded documents are untrusted input; defend against prompt injection.
- Private retrieval must be tenant-scoped before ranking/generation.

## Evaluation
Maintain test sets for:
- authority retrieval
- citation correctness
- holding accuracy
- source passage alignment
- abstention
- cross-tenant isolation
- adversarial uploaded documents
