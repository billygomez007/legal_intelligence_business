export interface LegalSynthesisTransportExecution {
  readonly body: string;
}

/**
 * Raw transport boundary only.
 *
 * Future adapters may implement this with HTTPS/fetch/provider SDKs.
 *
 * This port deliberately knows nothing about:
 *
 * - authentication/tenant scope;
 * - legal retrieval;
 * - source authorization;
 * - citation ownership;
 * - Work Product persistence.
 */
export interface LegalSynthesisTransport {
  execute(request: LegalSynthesisTransportExecution): Promise<string>;
}
