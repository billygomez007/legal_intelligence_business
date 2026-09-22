# Legal Synthesis

Provider-neutral grounded legal synthesis for Law Afrique.

This package sits above authorized legal retrieval.

It does not perform retrieval itself.

## Core rule

A model provider never owns citation identity.

The provider receives only evidence already authorized and retrieved by Law
Afrique and may refer to that evidence only by ordinal.

Law Afrique then reconstructs citations from the exact immutable:

- source kind;
- source ID;
- version ID;
- passage ID;
- locator.

This prevents free-form model output from silently inventing legal authorities.

## Evidence boundary

No evidence means no provider call.

A provider cannot broaden:

- organization;
- task;
- task-scope revision;
- jurisdiction;
- matter;
- source scope.

Phase 9A is Ghana-only.

## Provider independence

No production model vendor is implemented in Phase 9A.

Future adapters may implement `LegalSynthesisProvider`, but the domain and
application layer must remain provider-neutral.

## Persistence

Phase 9A introduces no database table and persists no prompt, completion,
retrieved excerpt or generated synthesis.
