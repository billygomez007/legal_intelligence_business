# Phase 9 — Grounded Legal Synthesis Acceptance

## Status

Phase 9 application architecture is accepted for grounded legal synthesis.

The only deferred acceptance item is the optional live OpenAI generation
test. The live provider test is currently blocked by an external OpenAI API
credit balance condition and is not considered a Law Afrique application
failure.

No production database migration or production-data mutation is required by
Phase 9.

---

## Purpose

Phase 9 adds provider-neutral, authorization-preserving legal synthesis on top
of the Phase 8 evidence retrieval layer.

The system must never allow a language model to:

- choose its own tenant;
- choose its own matter;
- broaden an AI Task scope;
- inject unauthorized evidence;
- invent authoritative source identity;
- persist stale evidence;
- bypass corpus AI-processing rights;
- bypass private-source availability checks;
- approve its own Work Product;
- leak provider payloads, credentials, prompts, evidence or completions into
  ordinary logs or audit metadata.

Application code remains authoritative for authorization, evidence identity,
provenance, persistence and human approval.

---

## Trust Model

The synthesis provider is an external trust boundary.

Provider output is treated as untrusted runtime data even when the TypeScript
interface describes a valid result.

A provider may only return:

- a bounded summary;
- bounded propositions;
- evidence ordinals;
- bounded unresolved issues;
- an insufficient-evidence decision.

A provider does not own:

- organization identity;
- user identity;
- task identity;
- task scope revision;
- matter identity;
- source identity;
- source version identity;
- passage identity;
- locator identity;
- citation authority;
- persistence authorization;
- approval authority.

Exact citation identity is reconstructed by Law Afrique from previously
authorized evidence.

---

## Phase 9 Acceptance Matrix

| Area | Acceptance requirement | Status |
| --- | --- | --- |
| Provider abstraction | Provider-neutral synthesis contract exists | PASS |
| Zero evidence | Provider is not called when authorized evidence is absent | PASS |
| Grounding | Substantive propositions require evidence references | PASS |
| Citation authority | Provider references evidence only by ordinal | PASS |
| Exact provenance | Application reconstructs exact source/version/passage identity | PASS |
| Fake citation | Invalid evidence ordinal is rejected | PASS |
| Uncited proposition | Unsupported proposition is rejected | PASS |
| Client scope injection | Caller cannot supply organization, matter, task revision or source IDs to trusted research | PASS |
| Task authority | Current AI Task is loaded server-side | PASS |
| Task revision | Current scope revision is derived server-side | PASS |
| Task cancellation | Persistence reauthorization rejects unavailable/cancelled task scope | PASS |
| Corpus rights | Current `ai_processing` right is required during retrieval | PASS |
| Corpus stale rights | Rights are rechecked before durable persistence | PASS |
| Knowledge availability | Archived/stale Firm Knowledge is rejected before persistence | PASS |
| Matter Document availability | Archived/stale Matter Document is rejected before persistence | PASS |
| Matter boundary | Matter evidence is authorized only inside the exact matter | PASS |
| Tenant isolation | Private evidence cannot cross tenant boundary | PASS |
| Retrieval query | Natural-language question is deterministically reduced to bounded retrieval query | PASS |
| Original question | Original legal question remains unchanged for synthesis | PASS |
| Prompt injection | Evidence text cannot alter application-owned citation identity | PASS |
| Provider exception | Raw provider exception is sanitized to stable application error | PASS |
| Provider result runtime shape | Null/array/wrong-type provider results are rejected before unsafe property access | PASS |
| Runtime error stability | Malformed provider result cannot escape as raw JavaScript `TypeError` | PASS |
| Transport contract | Versioned vendor-neutral transport request exists | PASS |
| Transport bounds | Request and response size bounds are enforced | PASS |
| Unknown fields | Unknown provider response fields are rejected | PASS |
| Model citation invention | Model-provided source/version/passage fields are rejected | PASS |
| Structured output | OpenAI adapter uses strict application-owned JSON Schema | PASS |
| Secret placement | API key is carried only at transport edge | PASS |
| Secret body leakage | API key is not included in request body | PASS |
| Provider error-body leakage | Non-2xx raw provider response bodies are not exposed through production application path | PASS |
| Observability | Provider observer emits safe allowlisted metadata only | PASS |
| Observer failure | Observer failure cannot break synthesis or replace provider error | PASS |
| Ordinary logging | No prompts, questions, evidence, completions or credentials in ordinary provider/runtime logging | PASS |
| Runtime provider selection | OpenAI must be explicitly selected | PASS |
| API-key-only activation | API key alone cannot activate provider | PASS |
| Live acceptance gate | Live test requires a second explicit opt-in flag | PASS |
| Provider construction | Constructing provider does not make network request | PASS |
| Human approval | AI cannot approve/reject Work Products | PASS |
| API-key approval | API-key actors remain ineligible for approval/rejection | PASS |
| Persistence | Exact authorized evidence provenance is stored with revision | PASS |
| Audit privacy | Audit metadata excludes Work Product content and evidence content | PASS |
| Transactionality | Work Product state and audit remain transactional | PASS |
| Dependency architecture | Domain boundaries remain clean | PASS |

---

## Phase 9A — Provider-Neutral Grounded Synthesis

Established the provider-neutral synthesis boundary.

Key guarantees:

- no real AI vendor dependency in the domain;
- no provider persistence;
- no provider-owned citations;
- no evidence means no provider call;
- invalid evidence references fail closed;
- uncited propositions fail closed.

---

## Phase 9B — Task-Authorized Research Port

Established the trusted research port:

`TaskAuthorizedResearch`

Callers provide only:

- authenticated authorization context;
- task ID;
- question;
- optional retrieval limit.

Callers cannot supply:

- organization ID;
- jurisdiction;
- matter ID;
- task scope revision;
- allowed source kinds;
- source IDs.

Those values are derived from server-owned state.

---

## Phase 9C — PostgreSQL Task-Authorized Research Adapter

The PostgreSQL adapter:

- loads the current AI Task;
- derives current task scope revision;
- derives allowed source types;
- executes tenant-scoped reads;
- performs Phase 8 authorization before retrieval;
- builds the grounded packet;
- does not invoke a model;
- does not persist model output.

---

## Phase 9D — Live Database Synthesis Acceptance

Validated the complete internal path:

current AI Task
→ authorized corpus retrieval
→ grounded packet
→ provider abstraction
→ application-owned exact citations.

This test uses a disposable PostgreSQL database.

---

## Phase 9E — Rights Removed After Synthesis

Validated that corpus AI-processing rights can be removed after an earlier
successful synthesis.

Subsequent retrieval then produces insufficient evidence and does not invoke
the provider.

---

## Phase 9F — Task Reauthorization Before Persistence

Validated that a task becoming unavailable or cancelled after synthesis cannot
be used to persist a Work Product revision.

No revision and no false success audit is created.

---

## Phase 9G — Corpus Rights Reauthorization Before Persistence

Validated that corpus evidence that was valid during synthesis is rejected if
its AI-processing right disappears before Work Product persistence.

Failure is closed with:

`work_product.source_unavailable`

---

## Phase 9H — Private Evidence Staleness

Validated stale private evidence behavior for:

- Firm Knowledge;
- Matter Documents.

Previously valid evidence is rejected if its source is archived before
persistence.

---

## Phase 9I — Natural-Language Retrieval Query Derivation

Added deterministic bounded query derivation.

Properties include:

- NFKC normalization;
- whitespace normalization;
- bounded bytes;
- bounded terms;
- common legal filler removal;
- Ghana/Ghanaian filler removal;
- deterministic fallback;
- original question preserved separately for synthesis.

---

## Phase 9J — Provider / Prompt-Injection Hardening

Validated:

- provider exception sanitization;
- prompt injection resistance;
- fake ordinal rejection;
- uncited proposition rejection;
- summary bounds;
- proposition bounds;
- unresolved-issue bounds;
- context bounds;
- provider not called without evidence.

Provider raw errors, credentials, prompts, evidence and completions are not
surfaced through the application boundary.

---

## Phase 9K — Safe Provider Observability

Added provider-neutral observability.

Permitted metadata is limited to:

- operation;
- provider ID;
- model ID;
- outcome;
- duration;
- evidence count;
- proposition count;
- unresolved issue count;
- insufficient-evidence flag;
- stable failure code.

Disallowed observability data includes:

- tenant/user/task/matter identifiers;
- question;
- retrieval query;
- source identity;
- version identity;
- passage identity;
- locator;
- evidence excerpt;
- prompt;
- completion;
- API keys;
- raw provider request;
- raw provider response;
- raw provider error.

---

## Phase 9L — Strict Provider Transport Contract

Added versioned vendor-neutral transport.

The provider transport response permits only:

- schema version;
- summary;
- propositions;
- evidence ordinals;
- unresolved issues;
- insufficient-evidence flag.

Unknown response fields are rejected.

This prevents a model from supplying authoritative citation metadata.

---

## Phase 9M — OpenAI Responses API Adapter

Added the first real provider adapter at the infrastructure edge.

The adapter:

- uses the Responses API;
- uses strict JSON Schema structured output;
- keeps evidence as user data;
- carries credentials only in authorization headers;
- does not log provider payloads;
- does not persist raw provider responses;
- keeps citation authority inside Law Afrique.

The adapter remains behind the vendor-neutral transport and provider ports.

---

## Phase 9N — Runtime Activation Safety

OpenAI runtime activation requires explicit configuration.

An API key by itself cannot enable the provider.

Live acceptance additionally requires a separate explicit flag:

`LIVE_OPENAI_ACCEPTANCE=1`

Provider construction does not make a network request.

---

## Phase 9O — Live Provider Acceptance

Status:

**DEFERRED — EXTERNAL API CREDIT BALANCE**

Confirmed:

- the supplied API key can authenticate;
- the configured model can be accessed;
- live acceptance uses synthetic evidence only;
- no tenant/client/matter data is used;
- secrets are removed after the test.

The generation request could not complete because the OpenAI API returned:

- HTTP 429;
- `insufficient_quota`;
- `credit_balance_exhausted`.

This is an external billing condition.

Phase 9O should be rerun after API credits are restored.

No production design decision depends on treating this external quota failure
as an application acceptance failure.

---

## Phase 9P — Runtime Provider Result Hardening

All provider results are runtime-validated before normal synthesis validation.

Malformed values rejected include:

- null result;
- array result;
- non-string summary;
- non-array propositions;
- null proposition;
- non-string proposition text;
- malformed evidence ordinals;
- non-array unresolved issues;
- non-boolean insufficient-evidence value.

Malformed provider output maps to:

`legal_synthesis.provider_result_invalid`

Raw runtime `TypeError` escapes are prevented.

---

## Final Security Invariants

1. Authorization happens before evidence retrieval.
2. Tenant boundaries are enforced before model access.
3. The model receives only authorized evidence.
4. The model cannot broaden task scope.
5. The model cannot choose source identity.
6. The model cannot create authoritative citation identity.
7. Exact citation identity comes from application-owned evidence.
8. Evidence rights and availability are rechecked before persistence.
9. AI-generated output is not treated as authoritative legal source material.
10. Human approval remains required for approval/rejection workflows.
11. Provider secrets remain at infrastructure edges.
12. Provider raw errors are sanitized.
13. Provider runtime outputs are treated as untrusted input.
14. Prompt/evidence/completion content is excluded from ordinary logs.
15. Work Product audit metadata remains content-free.
16. Live vendor tests are explicit and opt-in.
17. No provider is activated merely because an API key exists.

---

## Deferred Acceptance Item

Only one item remains external:

> Rerun the synthetic OpenAI live generation acceptance after API credits are
> restored.

That rerun must continue to use synthetic evidence before any real legal data
is sent to an external provider.

---

## Exit Criteria

Phase 9 may proceed to the next development phase when:

- all non-live Phase 9 tests pass;
- disposable PostgreSQL Work Product tests pass;
- Phase 8 retrieval regression passes;
- Phase 7 Work Product regression passes;
- dependency architecture passes;
- diff check passes;
- no production database is changed;
- no secret is persisted;
- the live-provider quota limitation is recorded as an external deferred item.

