import { authenticateApiKey, type AuthzContext, type IamDeps } from '@legalintel/iam';

/**
 * Machine authentication helper.
 *
 * Deliberately NOT wired into /v1/legal-research because grounded research
 * currently requires a human user principal.
 */
export async function authenticateLawAfriqueApiKey(
  iam: IamDeps,

  presented: string,
): Promise<AuthzContext> {
  return authenticateApiKey(iam, presented);
}
