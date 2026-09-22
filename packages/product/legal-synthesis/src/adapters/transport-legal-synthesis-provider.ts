import type { LegalSynthesisProviderRequest } from '../domain/synthesis.js';

import type { LegalSynthesisProvider } from '../ports/legal-synthesis-provider.js';

import type { LegalSynthesisTransport } from '../ports/legal-synthesis-transport.js';

import {
  parseLegalSynthesisTransportResponse,
  serializeLegalSynthesisTransportRequest,
} from '../transport/provider-transport.js';

export interface TransportLegalSynthesisProviderDependencies {
  readonly transport: LegalSynthesisTransport;
}

/**
 * Provider adapter that converts the internal, provider-neutral synthesis
 * contract to a strict JSON transport schema and parses the response back.
 *
 * It still contains no vendor SDK, endpoint, credential, retry policy,
 * networking library or model name.
 */
export function createTransportLegalSynthesisProvider(
  dependencies: TransportLegalSynthesisProviderDependencies,
): LegalSynthesisProvider {
  return Object.freeze({
    async synthesize(request: LegalSynthesisProviderRequest) {
      const body = serializeLegalSynthesisTransportRequest(request);

      const response = await dependencies.transport.execute({
        body,
      });

      return parseLegalSynthesisTransportResponse(response);
    },
  });
}
