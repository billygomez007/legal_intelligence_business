import { createObservedLegalSynthesisProvider } from '../adapters/observed-legal-synthesis-provider.js';

import {
  createOpenAiResponsesTransport,
  type OpenAiFetch,
} from '../adapters/openai/openai-responses-transport.js';

import { createTransportLegalSynthesisProvider } from '../adapters/transport-legal-synthesis-provider.js';

import type { LegalSynthesisProvider } from '../ports/legal-synthesis-provider.js';

import {
  noopLegalSynthesisObserver,
  type LegalSynthesisObserver,
} from '../ports/legal-synthesis-observer.js';

export type LegalSynthesisRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface OpenAiLegalSynthesisRuntimeConfig {
  readonly provider: 'openai';

  readonly apiKey: string;

  readonly model: string;

  readonly timeoutMs: number;
}

export interface CreateOpenAiLegalSynthesisRuntimeDependencies {
  readonly env: LegalSynthesisRuntimeEnvironment;

  readonly observer?: LegalSynthesisObserver;

  readonly fetchImpl?: OpenAiFetch;
}

function fail(code: string): never {
  throw new Error(`legal_synthesis.runtime_${code}`);
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    return 30_000;
  }

  if (!/^[0-9]+$/u.test(value)) {
    fail('timeout_invalid');
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    fail('timeout_invalid');
  }

  return parsed;
}

/**
 * Resolve runtime configuration.
 *
 * IMPORTANT:
 *
 * OPENAI_API_KEY existing by itself does NOT activate OpenAI.
 *
 * Law Afrique must explicitly set:
 *
 *   LEGAL_SYNTHESIS_PROVIDER=openai
 *
 * This prevents accidental external transmission simply because a developer
 * has an OpenAI API key in their shell or environment.
 */
export function resolveOpenAiLegalSynthesisRuntimeConfig(
  env: LegalSynthesisRuntimeEnvironment,
): OpenAiLegalSynthesisRuntimeConfig {
  if (env['LEGAL_SYNTHESIS_PROVIDER'] !== 'openai') {
    fail('provider_not_enabled');
  }

  const apiKey = env['OPENAI_API_KEY'];

  if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.includes('\0')) {
    fail('openai_api_key_missing');
  }

  const model = env['OPENAI_LEGAL_SYNTHESIS_MODEL'];

  if (typeof model !== 'string' || model.trim().length === 0) {
    fail('openai_model_missing');
  }

  return Object.freeze({
    provider: 'openai',

    apiKey,

    model,

    timeoutMs: parseTimeout(env['OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS']),
  });
}

/**
 * A separate flag gates live acceptance tests.
 *
 * Neither an API key nor provider selection is sufficient.
 */
export function isOpenAiLiveAcceptanceEnabled(env: LegalSynthesisRuntimeEnvironment): boolean {
  return env['LIVE_OPENAI_ACCEPTANCE'] === '1' && env['LEGAL_SYNTHESIS_PROVIDER'] === 'openai';
}

export function createOpenAiLegalSynthesisProviderFromRuntime(
  dependencies: CreateOpenAiLegalSynthesisRuntimeDependencies,
): LegalSynthesisProvider {
  const runtime = resolveOpenAiLegalSynthesisRuntimeConfig(dependencies.env);

  const transport = createOpenAiResponsesTransport({
    config: {
      apiKey: runtime.apiKey,
      model: runtime.model,
      timeoutMs: runtime.timeoutMs,
    },
    ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
  });

  const provider = createTransportLegalSynthesisProvider({
    transport,
  });

  return createObservedLegalSynthesisProvider({
    provider,

    metadata: {
      providerId: 'openai',

      modelId: runtime.model,
    },

    observer: dependencies.observer ?? noopLegalSynthesisObserver,
  });
}
