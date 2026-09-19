# AI Risk Controls

## Key Risks
- Hallucinated authority
- Misstated holding
- Incorrect citation treatment
- Outdated law
- Missing amendment
- Private-data leakage
- Overreliance by users

## Controls
### Grounding
Only answer legal research questions after retrieval from the approved corpus.

### Citation Verification
Claims and citations should be aligned after generation.

### Authority Hierarchy
The system should understand court hierarchy and source type.

### Recency / Versioning
Responses should show document date/version where material.

### Uncertainty
Expose uncertainty instead of masking it.

### Human Review
Support lawyer review and internal content-review workflows.

### UI
Distinguish source text, extracted metadata, AI synthesis and user notes.

## Avoid as Core Product
Consumer-facing numerical case-win predictions.
