# Phase 9C — Real Task-Authorized Research Adapter

Phase 9C connects the Phase 9 task-first synthesis boundary to the accepted
Phase 8 and Phase 7 production authorization architecture.

## Production flow

The adapter accepts only:

- authenticated `AuthzContext`;
- AI Task ID;
- question;
- optional retrieval limit.

Inside one tenant PostgreSQL transaction it:

1. loads the current AI Task through `PgAiTaskStore`;
2. takes `currentScopeRevision` from the stored task;
3. calls `authorizeRetrievalScope`;
4. creates the accepted Phase 7 Work Product source reader;
5. creates the PostgreSQL corpus/private candidate stores;
6. derives the allowed source kinds from the server-resolved task scope mode;
7. excludes disallowed source kinds before candidate search;
8. performs Phase 8 retrieval;
9. reauthorizes every exact candidate through the Phase 7 source reader;
10. builds the grounded research packet.

## Source-mode matrix

`ghana_corpus`

- Ghana corpus

`ghana_corpus_and_firm_knowledge`

- Ghana corpus
- Firm Knowledge

`ghana_corpus_and_matter`

- Ghana corpus
- exact selected Matter Documents

`ghana_corpus_and_matter_and_firm_knowledge`

- Ghana corpus
- Firm Knowledge
- exact selected Matter Documents

Unknown modes fail closed.

Matter-enabled modes require a stored Matter ID.

Non-Matter modes reject an unexpected Matter ID.

## Client trust boundary

The client cannot submit:

- organization;
- jurisdiction;
- country code;
- task-scope revision;
- Matter scope;
- scope mode;
- source kinds;
- source IDs;
- source versions.

Those values are server resolved from the current authenticated AI Task.

## Still not added

Phase 9C does not add:

- a production model provider;
- provider API keys;
- prompt persistence;
- completion persistence;
- synthesis persistence;
- HTTP endpoints;
- autonomous legal actions.

Live PostgreSQL end-to-end synthesis acceptance remains a later Phase 9 slice.
