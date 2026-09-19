import { validateAuditEvent, type AuditEvent } from './event';

/** Structurally the transaction handle from @legalintel/db (see StoreTx in @legalintel/iam). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors pg's row type for assignability
type Row = Record<string, any>;
export interface AuditTx {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors pg's signature
  query<R extends Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

const values = (event: AuditEvent) => [
  event.actorKind,
  event.actorId ?? null,
  event.action,
  event.outcome,
  event.resourceType ?? null,
  event.resourceId ?? null,
  event.requestId ?? null,
  JSON.stringify(event.metadata ?? {}),
];

/**
 * Records an event in the caller's tenant transaction, so the audit record and the action it
 * describes commit or roll back together: there is no "it happened but was not logged".
 */
export async function recordAuditEvent(tx: AuditTx, event: AuditEvent): Promise<void> {
  validateAuditEvent(event);
  await tx.query(
    `INSERT INTO audit.events
       (organization_id, actor_kind, actor_id, action, outcome, resource_type, resource_id, request_id, metadata)
     VALUES (app.current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    values(event),
  );
}

/** Records an operator or pipeline action on shared (non-tenant) data. */
export async function recordPlatformAuditEvent(tx: AuditTx, event: AuditEvent): Promise<void> {
  validateAuditEvent(event);
  await tx.query(
    `INSERT INTO audit.platform_events
       (actor_kind, actor_id, action, outcome, resource_type, resource_id, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    values(event),
  );
}
