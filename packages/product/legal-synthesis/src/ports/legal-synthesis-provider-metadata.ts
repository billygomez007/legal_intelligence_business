export interface LegalSynthesisProviderMetadata {
  /**
   * Stable application configuration identifier.
   *
   * Examples:
   * - openai
   * - anthropic
   * - google
   * - internal
   *
   * This is not a credential and must not contain secrets.
   */
  readonly providerId: string;

  /**
   * Configured model identifier where exposing it in operational telemetry is
   * acceptable.
   *
   * This value must never contain credentials or request-specific data.
   */
  readonly modelId: string | null;
}

function validIdentifier(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    !value.includes('\0') &&
    /^[A-Za-z0-9._:/-]+$/u.test(value)
  );
}

export function validateLegalSynthesisProviderMetadata(
  metadata: LegalSynthesisProviderMetadata,
): LegalSynthesisProviderMetadata {
  if (!validIdentifier(metadata.providerId)) {
    throw new Error('legal_synthesis.provider_id_invalid');
  }

  if (metadata.modelId !== null && !validIdentifier(metadata.modelId)) {
    throw new Error('legal_synthesis.model_id_invalid');
  }

  return Object.freeze({
    providerId: metadata.providerId,

    modelId: metadata.modelId,
  });
}
