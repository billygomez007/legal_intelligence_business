# Legal Data Ingestion Pipeline

## Stages
1. Source approval / rights status
2. Acquisition
3. File integrity/checksum
4. Text extraction
5. OCR only where necessary
6. Structural parsing
7. Metadata extraction
8. Citation extraction
9. Provision/case linking
10. Deduplication
11. Embedding/indexing
12. Automated validation
13. Human review based on risk/confidence
14. Publish to approved corpus
15. Re-index dependent relationships

## Provenance
Every document records source, acquisition date, rights status, version, checksum and processing history.

## Quality Signals
- extraction confidence
- OCR confidence
- metadata confidence
- citation-link confidence
- human-review status

## Reprocessing
Pipeline must be idempotent and versioned. Corrections should not destroy audit history.

## Rights Gate
No source should enter the commercial corpus merely because it is technically accessible. Source approval is a distinct gate.
