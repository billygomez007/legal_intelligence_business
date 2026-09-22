export interface OpenAiLegalSynthesisTransportConfig {
  readonly apiKey: string;

  readonly model: string;

  readonly endpoint?: string;

  readonly timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';

const DEFAULT_TIMEOUT_MS = 30_000;

function fail(code: string): never {
  throw new Error(`legal_synthesis.openai_${code}`);
}

function validateSecret(value: string): string {
  if (typeof value !== 'string' || value.trim().length < 8 || value.includes('\0')) {
    fail('api_key_invalid');
  }

  return value;
}

function validateModel(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:/-]+$/u.test(value)
  ) {
    fail('model_invalid');
  }

  return value;
}

function validateEndpoint(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    fail('endpoint_invalid');
  }

  if (url.protocol !== 'https:') {
    fail('endpoint_invalid');
  }

  return url.toString();
}

function validateTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 120_000) {
    fail('timeout_invalid');
  }

  return value;
}

export interface ValidatedOpenAiLegalSynthesisTransportConfig {
  readonly apiKey: string;

  readonly model: string;

  readonly endpoint: string;

  readonly timeoutMs: number;
}

export function validateOpenAiLegalSynthesisTransportConfig(
  input: OpenAiLegalSynthesisTransportConfig,
): ValidatedOpenAiLegalSynthesisTransportConfig {
  return Object.freeze({
    apiKey: validateSecret(input.apiKey),

    model: validateModel(input.model),

    endpoint: validateEndpoint(input.endpoint ?? DEFAULT_ENDPOINT),

    timeoutMs: validateTimeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}
