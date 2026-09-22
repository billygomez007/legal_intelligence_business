# @legalintel/legal-retrieval

Law Afrique Phase 8 rights-aware legal retrieval foundation.

Core rules:

- Ghana only.
- Retrieval begins from an already authorized AI Task scope.
- Organization, jurisdiction and matter scope cannot be broadened by the query.
- Corpus AI use requires current `ai_processing` rights.
- Firm Knowledge remains organization-scoped.
- Matter Documents remain matter-scoped.
- Authorization filters candidates before ranking.
- Every evidence item retains exact immutable source/version provenance.
- Ranking is deterministic.
- Retrieval is bounded.
- A real LLM, embedding provider or external vector database is not required.
- Work Product persistence must revalidate sources after retrieval.
