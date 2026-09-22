# Phase 9B — Task-Authorized Synthesis Orchestration

Phase 9B introduces the task-first orchestration boundary.

The synthesis request surface accepts:

- authenticated IAM context;
- AI Task ID;
- question;
- optional result limit.

It deliberately does **not** accept:

- organization ID;
- jurisdiction ID or country code;
- Matter ID;
- task-scope revision;
- retrieval scope mode;
- source IDs;
- source version IDs.

Those values must be resolved by a trusted Phase 8 task-authorized research
implementation.

The orchestration flow is:

1. validate task ID and question;
2. call trusted task-authorized research;
3. receive a grounded Phase 8 research packet;
4. verify tenant, task, Ghana jurisdiction and scope revision again;
5. fail closed on a packet/request mismatch;
6. invoke grounded synthesis only after those checks;
7. skip model execution entirely when evidence is insufficient.

Phase 9B still adds no production model provider, database table, HTTP route,
prompt persistence or completion persistence.
