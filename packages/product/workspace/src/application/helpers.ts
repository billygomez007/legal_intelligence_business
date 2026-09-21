import type { AuditEvent } from '@legalintel/audit';
import type { AuthzContext } from '@legalintel/iam';

export function workspaceActor(context: AuthzContext): Pick<AuditEvent, 'actorKind' | 'actorId'> {
  const actorId =
    context.principal.kind === 'user'
      ? context.principal.userId
      : context.principal.kind === 'api_key'
        ? context.principal.createdBy
        : undefined;

  return {
    actorKind: context.principal.kind,
    ...(actorId === undefined ? {} : { actorId }),
  };
}

export function workspaceNotFound(code: string): Error {
  const error = new Error(code);
  error.name = code;
  return error;
}
