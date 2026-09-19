# apps

Deployable composition roots. An app wires packages together (configuration, database, authentication, routes or queue consumers) and contains as little logic as possible.

| App      | Purpose                                                                 | Stage   |
| -------- | ----------------------------------------------------------------------- | ------- |
| `api`    | HTTP API                                                                | 8       |
| `worker` | Job worker: ingestion, indexing, scheduled source checks                | 9       |
| `web`    | Product UI. Deliberately deferred until the platform layers are proven. | after 8 |

Rules (enforced by `pnpm depcruise`): apps import packages only through their public entry point; apps never import each other; packages never import apps.
