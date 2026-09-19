# Platform permissions matrix

<!-- Generated from code. Do not edit by hand; run `pnpm docs:permissions`. A test fails if this file is stale. -->

Deny by default: a role can do only what is marked. `:own` applies to resources the caller owns; `:any` to all in the organization. "API key" marks permissions an API key may hold at all; a key is further limited to what its issuer can currently do.

| Permission | Product | owner | admin | member | viewer | API key |
| --- | --- | --- | --- | --- | --- | --- |
| `api_key:create` | platform | yes | yes |  |  |  |
| `api_key:read` | platform | yes | yes |  |  |  |
| `api_key:revoke` | platform | yes | yes |  |  |  |
| `audit:read` | platform | yes | yes |  |  |  |
| `billing:manage` | platform | yes |  |  |  |  |
| `member:assign_role` | platform | yes | yes |  |  |  |
| `member:invite` | platform | yes | yes |  |  |  |
| `member:read` | platform | yes | yes | yes | yes |  |
| `member:remove` | platform | yes | yes |  |  |  |
| `organization:read` | platform | yes | yes | yes | yes |  |
| `organization:update` | platform | yes | yes |  |  |  |
