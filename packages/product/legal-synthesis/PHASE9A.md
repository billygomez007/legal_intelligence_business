# Phase 9A — Grounded Legal Synthesis Foundation

Phase 9A creates the provider-neutral synthesis boundary for the future
**Ask the Law** runtime.

Implemented:

- `LegalSynthesisProvider`;
- bounded provider request;
- provider result validation;
- Ghana-only synthesis boundary;
- no-provider-call behavior when evidence is absent;
- proposition-level grounding;
- evidence-ordinal citation references;
- application-owned reconstruction of exact source/version/passages;
- explicit insufficient-evidence result;
- bounded context and output sizes.

Not implemented:

- OpenAI;
- Anthropic;
- Gemini;
- any other model vendor;
- model credentials;
- model selection;
- streaming;
- HTTP endpoints;
- database persistence;
- prompt/completion logging;
- autonomous external actions;
- Work Product persistence.

The model provider cannot supply arbitrary legal citation IDs. It can reference
only evidence ordinals already supplied by the trusted retrieval layer.
