import { randomUUID } from 'node:crypto';

import type { IncomingMessage, ServerResponse } from 'node:http';

import { withTenantTransaction, withUserTransaction, type DbPool, type Tx } from '@legalintel/db';

import type { AuthzContext, IamDeps } from '@legalintel/iam';

import type { UserId } from '@legalintel/kernel';

import {
  MatterDocumentId,
  archiveMatterDocument,
  createMatterDocument,
  listMatterDocumentVersions,
  PgMatterDocumentStore,
  updateMatterDocument,
} from '@legalintel/matter-documents';

import {
  ClientId,
  createClient,
  createMatter,
  listClients,
  listMatters,
  pgWorkspaceStore,
  updateClient,
} from '@legalintel/workspace';

import type { HumanSessionIdentityResolver } from '../auth/iam-request-auth.js';

import type { RequestAuthResolver } from '../auth/request-auth.js';

import { sendJson } from './http-utils.js';

const matterDocumentStore = new PgMatterDocumentStore();

const MAX_BODY_BYTES = 64 * 1024;

export interface WorkspaceRouteDependencies {
  readonly pool: DbPool;

  readonly iam: IamDeps;

  readonly auth: RequestAuthResolver;

  readonly humanSessions: HumanSessionIdentityResolver;
}

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined) {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/u.exec(authorization);

  return match?.[1] ?? null;
}

async function authenticatedUser(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,
): Promise<UserId | null> {
  const token = bearerToken(request.headers.authorization);

  if (token === null) {
    return null;
  }

  return dependencies.humanSessions.resolveBearer(token);
}

async function tenantContext(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,
): Promise<AuthzContext | null> {
  return dependencies.auth.resolve({
    authorization: request.headers.authorization ?? null,

    organizationHint:
      typeof request.headers['x-organization-id'] === 'string'
        ? request.headers['x-organization-id']
        : null,
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];

  let size = 0;

  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    size += value.length;

    if (size > MAX_BODY_BYTES) {
      return null;
    }

    chunks.push(value);
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function userIdFromContext(context: AuthzContext): UserId | undefined {
  if (context.principal.kind === 'user') {
    return context.principal.userId;
  }

  return undefined;
}

async function withContextTransaction<T>(
  dependencies: WorkspaceRouteDependencies,

  context: AuthzContext,

  work: (tx: Tx) => Promise<T>,

  readOnly = false,
): Promise<T> {
  const organizationId = context.organizationId;

  if (organizationId === null || organizationId === undefined) {
    throw new Error('workspace.organization_required');
  }

  const userId = userIdFromContext(context);

  return withTenantTransaction(
    dependencies.pool,

    {
      organizationId,

      ...(userId === undefined
        ? {}
        : {
            userId,
          }),
    },

    work,

    readOnly
      ? {
          readOnly: true,
        }
      : undefined,
  );
}

function deny(response: ServerResponse): void {
  sendJson(response, 403, {
    error: {
      code: 'authorization_denied',
    },
  });
}

async function organizations(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  const userId = await authenticatedUser(dependencies, request);

  if (userId === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_required',
      },
    });

    return;
  }

  if (request.method === 'GET') {
    const values = await withUserTransaction(
      dependencies.iam.pool,

      userId,

      (tx) => dependencies.iam.store.listMyOrganizations(tx),

      {
        readOnly: true,
      },
    );

    sendJson(response, 200, {
      data: values.map((organization) => ({
        id: String(organization.id),

        name: organization.name,

        slug: organization.slug,

        kind: organization.kind,

        status: organization.status,
      })),
    });

    return;
  }

  if (request.method === 'POST') {
    const body = await readJson(request);

    if (body === null) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const rawName = body['name'];

    const rawKind = body['kind'];

    const name = typeof rawName === 'string' ? rawName.trim() : '';

    const kind = typeof rawKind === 'string' ? rawKind : 'firm';

    const allowedKinds = new Set(['individual', 'firm', 'corporate', 'institution']);

    if (name.length < 2 || name.length > 200 || !allowedKinds.has(kind)) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const baseSlug =
      name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '')
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 48) || 'workspace';

    const suffix = randomUUID().replaceAll('-', '').slice(0, 8);

    const slug = `${baseSlug}-${suffix}`;

    const organizationId = await withUserTransaction(
      dependencies.iam.pool,

      userId,

      (tx) =>
        dependencies.iam.store.createOrganization(
          tx,

          {
            name,
            slug,
            kind: kind as 'individual' | 'firm' | 'corporate' | 'institution',
          },
        ),
    );

    sendJson(response, 201, {
      data: {
        id: String(organizationId),

        name,
        slug,
        kind,

        role: 'owner',
      },
    });

    return;
  }

  sendJson(response, 405, {
    error: {
      code: 'method_not_allowed',
    },
  });
}

async function clients(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  const context = await tenantContext(dependencies, request);

  if (context === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_required',
      },
    });

    return;
  }

  if (request.method === 'GET') {
    const values = await withContextTransaction(
      dependencies,
      context,

      (tx) =>
        listClients(
          {
            workspaceStore: pgWorkspaceStore,
          },

          tx,
          context,
        ),

      true,
    );

    sendJson(response, 200, {
      data: values,
    });

    return;
  }

  if (request.method === 'POST') {
    const body = await readJson(request);

    if (body === null) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const rawName = body['name'];

    const rawReference = body['reference'];

    const name = typeof rawName === 'string' ? rawName.trim() : '';

    const reference = typeof rawReference === 'string' ? rawReference.trim() : null;

    if (name.length < 2 || name.length > 200) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const created = await withContextTransaction(
      dependencies,
      context,

      (tx) =>
        createClient(
          {
            workspaceStore: pgWorkspaceStore,
          },

          tx,
          context,

          {
            name,

            ...(reference === null || reference.length === 0
              ? {}
              : {
                  reference,
                }),
          },
        ),
    );

    sendJson(response, 201, {
      data: created,
    });

    return;
  }

  if (request.method === 'PATCH') {
    const body = await readJson(request);

    if (body === null) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const rawClientId = body['clientId'];

    if (typeof rawClientId !== 'string') {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    let clientId: ReturnType<typeof ClientId.parse>;

    try {
      clientId = ClientId.parse(rawClientId);
    } catch {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const rawName = body['name'];

    const rawReference = body['reference'];

    const rawStatus = body['status'];

    if (rawStatus !== undefined && rawStatus !== 'active' && rawStatus !== 'archived') {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const update: {
      name?: string;
      reference?: string | null;
      status?: 'active' | 'archived';
    } = {};

    if (typeof rawName === 'string') {
      const value = rawName.trim();

      if (value.length < 2 || value.length > 200) {
        sendJson(response, 400, {
          error: {
            code: 'request_invalid',
          },
        });

        return;
      }

      update.name = value;
    }

    if (rawReference === null) {
      update.reference = null;
    } else if (typeof rawReference === 'string') {
      const value = rawReference.trim();

      update.reference = value.length === 0 ? null : value;
    }

    if (rawStatus === 'active' || rawStatus === 'archived') {
      update.status = rawStatus;
    }

    if (Object.keys(update).length === 0) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const updated = await withContextTransaction(
      dependencies,
      context,

      (tx) =>
        updateClient(
          {
            workspaceStore: pgWorkspaceStore,
          },

          tx,
          context,
          clientId,
          update,
        ),
    );

    sendJson(response, 200, {
      data: updated,
    });

    return;
  }

  sendJson(response, 405, {
    error: {
      code: 'method_not_allowed',
    },
  });
}

async function matters(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  const context = await tenantContext(dependencies, request);

  if (context === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_required',
      },
    });

    return;
  }

  if (request.method === 'GET') {
    const [clients, matterList] = await withContextTransaction(
      dependencies,
      context,

      (tx) =>
        Promise.all([
          listClients(
            {
              workspaceStore: pgWorkspaceStore,
            },

            tx,
            context,
          ),

          listMatters(
            {
              workspaceStore: pgWorkspaceStore,
            },

            tx,
            context,
          ),
        ]),

      true,
    );

    sendJson(response, 200, {
      data: {
        clients,
        matters: matterList,
      },
    });

    return;
  }

  if (request.method === 'POST') {
    const body = await readJson(request);

    if (body === null) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const rawName = body['name'];

    const rawClientName = body['clientName'];

    const rawReference = body['reference'];

    const name = typeof rawName === 'string' ? rawName.trim() : '';

    const clientName = typeof rawClientName === 'string' ? rawClientName.trim() : '';

    const reference = typeof rawReference === 'string' ? rawReference.trim() : null;

    if (name.length === 0 || clientName.length === 0) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const created = await withContextTransaction(
      dependencies,
      context,

      async (tx) => {
        const client = await createClient(
          {
            workspaceStore: pgWorkspaceStore,
          },

          tx,
          context,

          {
            name: clientName,
          },
        );

        return createMatter(
          {
            workspaceStore: pgWorkspaceStore,
          },

          tx,
          context,

          {
            clientId: client.id,

            name,

            reference: reference === '' ? null : reference,

            jurisdiction: 'GH',
          },
        );
      },
    );

    sendJson(response, 201, {
      data: created,
    });

    return;
  }

  sendJson(response, 405, {
    error: {
      code: 'method_not_allowed',
    },
  });
}

interface DocumentRow {
  readonly id: string;

  readonly matterId: string;

  readonly name: string;

  readonly description: string | null;

  readonly status: string;

  readonly createdAt: Date;

  readonly updatedAt: Date;

  readonly versionCount: number;

  readonly latestVersionNumber: number | null;
}

async function documents(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  const context = await tenantContext(dependencies, request);

  if (context === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_required',
      },
    });

    return;
  }

  const url = new URL(request.url ?? '/v1/workspace/documents', 'http://127.0.0.1');

  if (request.method === 'GET') {
    const documentId = url.searchParams.get('documentId');

    if (documentId !== null) {
      let parsedDocumentId: ReturnType<typeof MatterDocumentId.parse>;

      try {
        parsedDocumentId = MatterDocumentId.parse(documentId);
      } catch {
        sendJson(response, 400, {
          error: {
            code: 'request_invalid',
          },
        });

        return;
      }

      const versions = await withContextTransaction(
        dependencies,
        context,

        (tx) => listMatterDocumentVersions(matterDocumentStore, tx, context, parsedDocumentId),

        true,
      );

      sendJson(response, 200, {
        data: versions,
      });

      return;
    }

    if (!context.permissions.has('matter-document:read')) {
      deny(response);

      return;
    }

    const data = await withContextTransaction(
      dependencies,
      context,

      async (tx) => {
        const [documentsResult, matterList] = await Promise.all([
          tx.query<DocumentRow>(
            `
                  SELECT
                    d.id::text
                      AS "id",
                    d.matter_id::text
                      AS "matterId",
                    d.name
                      AS "name",
                    d.description
                      AS "description",
                    d.status
                      AS "status",
                    d.created_at
                      AS "createdAt",
                    d.updated_at
                      AS "updatedAt",
                    COUNT(v.id)::int
                      AS "versionCount",
                    MAX(v.version_number)::int
                      AS "latestVersionNumber"
                  FROM matter_documents.documents d
                  LEFT JOIN matter_documents.document_versions v
                    ON v.organization_id =
                       d.organization_id
                   AND v.document_id =
                       d.id
                  GROUP BY
                    d.id,
                    d.matter_id,
                    d.name,
                    d.description,
                    d.status,
                    d.created_at,
                    d.updated_at
                  ORDER BY
                    d.updated_at DESC,
                    d.id DESC
                  LIMIT 250
                `,
          ),

          listMatters(
            {
              workspaceStore: pgWorkspaceStore,
            },

            tx,
            context,
          ),
        ]);

        return {
          documents: documentsResult.rows,

          matters: matterList,
        };
      },

      true,
    );

    sendJson(response, 200, {
      data,
    });

    return;
  }

  if (request.method === 'POST') {
    const body = await readJson(request);

    if (body === null) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const matterId = typeof body['matterId'] === 'string' ? body['matterId'].trim() : '';

    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';

    const description = typeof body['description'] === 'string' ? body['description'].trim() : null;

    if (matterId.length === 0 || name.length < 2 || name.length > 240) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const created = await withContextTransaction(
      dependencies,
      context,

      (tx) =>
        createMatterDocument(
          matterDocumentStore,
          tx,
          context,

          {
            matterId,
            name,

            ...(description === null || description.length === 0
              ? {}
              : {
                  description,
                }),
          },
        ),
    );

    sendJson(response, 201, {
      data: created,
    });

    return;
  }

  if (request.method === 'PATCH') {
    const body = await readJson(request);

    if (body === null) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const rawId = body['documentId'];

    if (typeof rawId !== 'string') {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    let documentId: ReturnType<typeof MatterDocumentId.parse>;

    try {
      documentId = MatterDocumentId.parse(rawId);
    } catch {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const action = body['action'];

    if (action === 'archive') {
      const archived = await withContextTransaction(
        dependencies,
        context,

        (tx) => archiveMatterDocument(matterDocumentStore, tx, context, documentId),
      );

      sendJson(response, 200, {
        data: archived,
      });

      return;
    }

    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';

    const rawDescription = body['description'];

    const description =
      rawDescription === null
        ? null
        : typeof rawDescription === 'string'
          ? rawDescription.trim()
          : undefined;

    if (name.length < 2 || name.length > 240) {
      sendJson(response, 400, {
        error: {
          code: 'request_invalid',
        },
      });

      return;
    }

    const updated = await withContextTransaction(
      dependencies,
      context,

      (tx) =>
        updateMatterDocument(
          matterDocumentStore,
          tx,
          context,

          {
            id: documentId,

            name,

            ...(description === undefined
              ? {}
              : {
                  description: description === '' ? null : description,
                }),
          },
        ),
    );

    sendJson(response, 200, {
      data: updated,
    });

    return;
  }

  sendJson(response, 405, {
    error: {
      code: 'method_not_allowed',
    },
  });
}

interface WorkProductRow {
  readonly id: string;

  readonly aiTaskId: string;

  readonly matterId: string | null;

  readonly title: string;

  readonly kind: string;

  readonly status: string;

  readonly currentRevisionNumber: number | null;

  readonly createdAt: Date;

  readonly updatedAt: Date;
}

async function workProducts(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: {
        code: 'method_not_allowed',
      },
    });

    return;
  }

  const context = await tenantContext(dependencies, request);

  if (context === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_required',
      },
    });

    return;
  }

  if (!context.permissions.has('work_product:read')) {
    deny(response);

    return;
  }

  const values = await withContextTransaction(
    dependencies,
    context,

    async (tx) => {
      const result = await tx.query<WorkProductRow>(
        `
              SELECT
                wp.id::text AS "id",
                wp.ai_task_id::text AS "aiTaskId",
                wp.matter_id::text AS "matterId",
                wp.title AS "title",
                wp.kind AS "kind",
                wp.status AS "status",
                r.revision_number AS "currentRevisionNumber",
                wp.created_at AS "createdAt",
                wp.updated_at AS "updatedAt"
              FROM work_products.work_products wp
              LEFT JOIN work_products.revisions r
                ON r.organization_id =
                   wp.organization_id
               AND r.id =
                   wp.current_revision_id
              ORDER BY
                wp.updated_at DESC,
                wp.id DESC
              LIMIT 250
            `,
      );

      return result.rows;
    },

    true,
  );

  sendJson(response, 200, {
    data: values,
  });
}

interface ApprovalRow {
  readonly work_product_id: string;

  readonly title: string;

  readonly status: string;

  readonly current_revision_number: number | null;

  readonly updated_at: Date;
}

async function approvals(
  dependencies: WorkspaceRouteDependencies,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: {
        code: 'method_not_allowed',
      },
    });

    return;
  }

  const context = await tenantContext(dependencies, request);

  if (context === null) {
    sendJson(response, 401, {
      error: {
        code: 'authentication_required',
      },
    });

    return;
  }

  if (!context.permissions.has('work_product:read')) {
    deny(response);

    return;
  }

  const values = await withContextTransaction(
    dependencies,
    context,

    async (tx) => {
      const result = await tx.query<ApprovalRow>(
        `
              SELECT
                wp.id::text
                  AS work_product_id,
                wp.title
                  AS title,
                wp.status
                  AS status,
                r.revision_number
                  AS current_revision_number,
                wp.updated_at
                  AS updated_at
              FROM work_products.work_products wp
              LEFT JOIN work_products.revisions r
                ON r.organization_id =
                   wp.organization_id
               AND r.id =
                   wp.current_revision_id
              WHERE
                wp.status =
                  'submitted'
              ORDER BY
                wp.updated_at DESC,
                wp.id DESC
              LIMIT 100
            `,
      );

      return result.rows;
    },

    true,
  );

  sendJson(response, 200, {
    data: values,
  });
}

export async function handleWorkspaceRoute(
  dependencies: WorkspaceRouteDependencies,

  pathname: string,

  request: IncomingMessage,

  response: ServerResponse,
): Promise<boolean> {
  if (pathname === '/v1/me/organizations') {
    await organizations(dependencies, request, response);

    return true;
  }

  if (pathname === '/v1/workspace/clients') {
    await clients(dependencies, request, response);

    return true;
  }

  if (pathname === '/v1/workspace/matters') {
    await matters(dependencies, request, response);

    return true;
  }

  if (pathname === '/v1/workspace/documents') {
    await documents(dependencies, request, response);

    return true;
  }

  if (pathname === '/v1/workspace/work-products') {
    await workProducts(dependencies, request, response);

    return true;
  }

  if (pathname === '/v1/workspace/approvals') {
    await approvals(dependencies, request, response);

    return true;
  }

  return false;
}
