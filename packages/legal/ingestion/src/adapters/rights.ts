import type { Tx } from '@legalintel/db';

import { failureCategory, IngestionFailure } from '../domain/model';

/**
 * Advisory-lock namespaces (the second argument of hashtextextended). Distinct so that locks
 * taken for different purposes on the same text can never collide with each other.
 */
export const LOCK_NAMESPACE = { job: 5, identity: 6, review: 7 } as const;

/**
 * The rights decision in force NOW for what the `structure` operation needs, as evidence.
 * Fail closed: a denial is a typed `rights_denied`; anything else (the database being
 * unreachable, a bug) is rethrown untouched so it is classified as what it is and never
 * mistaken for a legal decision.
 */
export async function currentRights(tx: Tx, sourceId: string): Promise<string> {
  try {
    const result = await tx.query<{ id: string }>('SELECT ingestion.current_rights($1) AS id', [
      sourceId,
    ]);
    const id = result.rows[0]?.id;
    if (id === undefined) throw new IngestionFailure('internal_error');
    return id;
  } catch (error) {
    if (failureCategory(error) === 'rights_denied') throw new IngestionFailure('rights_denied');
    throw error;
  }
}
