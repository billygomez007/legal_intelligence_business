import type { AuditEvent } from '@legalintel/audit';
import type { AuthzContext } from '@legalintel/iam';
import { notFound } from '@legalintel/kernel';

export function knowledgeNotFound(code = 'knowledge.source_not_found') {
  return notFound(code, 'The Firm Knowledge source was not found.');
}

export function auditActor(context: AuthzContext): Pick<AuditEvent, 'actorKind' | 'actorId'> {
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
