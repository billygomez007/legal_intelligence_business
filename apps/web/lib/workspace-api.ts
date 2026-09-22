import { readLawAfriqueSession } from './server-session';

const API_BASE = process.env.LAW_AFRIQUE_API_URL ?? 'http://127.0.0.1:8080';

export interface WorkspaceOrganization {
  readonly id: string;

  readonly name: string;

  readonly slug: string;

  readonly kind: string;

  readonly status: string;
}

async function sessionToken(): Promise<string | null> {
  const session = await readLawAfriqueSession();

  return session?.token ?? null;
}

async function requestApi(
  path: string,

  init?: RequestInit,

  organizationId?: string,
): Promise<Response> {
  const token = await sessionToken();

  if (token === null) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'authentication_required',
        },
      }),

      {
        status: 401,

        headers: {
          'content-type': 'application/json',
        },
      },
    );
  }

  const headers = new Headers(init?.headers);

  headers.set('authorization', `Bearer ${token}`);

  if (organizationId !== undefined) {
    headers.set('x-organization-id', organizationId);
  }

  return fetch(
    `${API_BASE}${path}`,

    {
      ...init,
      headers,
      cache: 'no-store',
    },
  );
}

export async function listOrganizations(): Promise<readonly WorkspaceOrganization[]> {
  const response = await requestApi('/v1/me/organizations');

  if (!response.ok) {
    return [];
  }

  const body = (await response.json()) as {
    readonly data?: readonly WorkspaceOrganization[];
  };

  return Array.isArray(body.data) ? body.data : [];
}

export async function activeOrganization(): Promise<WorkspaceOrganization | null> {
  const organizations = await listOrganizations();

  return (
    organizations.find((organization) => organization.status === 'active') ??
    organizations[0] ??
    null
  );
}

export async function workspaceGet<T>(path: string): Promise<T | null> {
  const organization = await activeOrganization();

  if (organization === null) {
    return null;
  }

  const response = await requestApi(
    path,
    {
      method: 'GET',
    },
    organization.id,
  );

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    readonly data?: T;
  };

  return body.data ?? null;
}

export async function workspacePost<T>(
  path: string,

  body: Record<string, unknown>,
): Promise<{
  readonly ok: boolean;

  readonly status: number;

  readonly data?: T;

  readonly errorCode?: string;
}> {
  const organization = await activeOrganization();

  if (organization === null) {
    return {
      ok: false,

      status: 409,

      errorCode: 'organization_required',
    };
  }

  const response = await requestApi(
    path,

    {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify(body),
    },

    organization.id,
  );

  const payload = (await response.json().catch(() => ({}))) as {
    readonly data?: T;

    readonly error?: {
      readonly code?: string;
    };
  };

  return {
    ok: response.ok,

    status: response.status,

    ...(payload.data === undefined
      ? {}
      : {
          data: payload.data,
        }),

    ...(payload.error?.code === undefined
      ? {}
      : {
          errorCode: payload.error.code,
        }),
  };
}

export async function researchPost(body: Record<string, unknown>) {
  const organization = await activeOrganization();

  if (organization === null) {
    return {
      ok: false,

      status: 409,

      errorCode: 'organization_required',
    };
  }

  const response = await requestApi(
    '/v1/legal-research',

    {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify(body),
    },

    organization.id,
  );

  const payload = await response.json().catch(() => ({}));

  return {
    ok: response.ok,

    status: response.status,

    payload,
  };
}

export interface CreateOrganizationInput {
  readonly name: string;

  readonly kind: 'individual' | 'firm' | 'corporate' | 'institution';
}

export interface CreatedOrganization {
  readonly id: string;

  readonly name: string;

  readonly slug: string;

  readonly kind: string;

  readonly role: string;
}

export async function createOrganization(input: CreateOrganizationInput): Promise<{
  readonly ok: boolean;

  readonly status: number;

  readonly data?: CreatedOrganization;

  readonly errorCode?: string;
}> {
  const response = await requestApi(
    '/v1/me/organizations',

    {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify(input),
    },
  );

  const payload = (await response.json().catch(() => ({}))) as {
    readonly data?: CreatedOrganization;

    readonly error?: {
      readonly code?: string;
    };
  };

  return {
    ok: response.ok,

    status: response.status,

    ...(payload.data === undefined
      ? {}
      : {
          data: payload.data,
        }),

    ...(payload.error?.code === undefined
      ? {}
      : {
          errorCode: payload.error.code,
        }),
  };
}
