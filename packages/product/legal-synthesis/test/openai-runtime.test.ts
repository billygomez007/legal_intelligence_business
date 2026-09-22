import { describe, expect, it } from 'vitest';

import {
  createOpenAiLegalSynthesisProviderFromRuntime,
  isOpenAiLiveAcceptanceEnabled,
  resolveOpenAiLegalSynthesisRuntimeConfig,
  type OpenAiFetch,
} from '../src/index.js';

describe('Phase 9N OpenAI runtime safety', () => {
  it('does not enable OpenAI merely because an API key exists', () => {
    const env = {
      OPENAI_API_KEY: 'sk-secret-present',
    };

    expect(isOpenAiLiveAcceptanceEnabled(env)).toBe(false);

    expect(() => resolveOpenAiLegalSynthesisRuntimeConfig(env)).toThrow(
      'legal_synthesis.runtime_provider_not_enabled',
    );
  });

  it('requires explicit provider selection', () => {
    expect(() =>
      resolveOpenAiLegalSynthesisRuntimeConfig({
        OPENAI_API_KEY: 'sk-secret-present',

        OPENAI_LEGAL_SYNTHESIS_MODEL: 'gpt-5.6-terra',
      }),
    ).toThrow('legal_synthesis.runtime_provider_not_enabled');
  });

  it('requires API key after provider activation', () => {
    expect(() =>
      resolveOpenAiLegalSynthesisRuntimeConfig({
        LEGAL_SYNTHESIS_PROVIDER: 'openai',

        OPENAI_LEGAL_SYNTHESIS_MODEL: 'gpt-5.6-terra',
      }),
    ).toThrow('legal_synthesis.runtime_openai_api_key_missing');
  });

  it('requires explicit model selection', () => {
    expect(() =>
      resolveOpenAiLegalSynthesisRuntimeConfig({
        LEGAL_SYNTHESIS_PROVIDER: 'openai',

        OPENAI_API_KEY: 'sk-secret-present',
      }),
    ).toThrow('legal_synthesis.runtime_openai_model_missing');
  });

  it('requires a second explicit flag for live acceptance', () => {
    const base = {
      LEGAL_SYNTHESIS_PROVIDER: 'openai',

      OPENAI_API_KEY: 'sk-secret-present',

      OPENAI_LEGAL_SYNTHESIS_MODEL: 'gpt-5.6-terra',
    };

    expect(isOpenAiLiveAcceptanceEnabled(base)).toBe(false);

    expect(
      isOpenAiLiveAcceptanceEnabled({
        ...base,

        LIVE_OPENAI_ACCEPTANCE: '1',
      }),
    ).toBe(true);
  });

  it('validates timeout bounds', () => {
    expect(() =>
      resolveOpenAiLegalSynthesisRuntimeConfig({
        LEGAL_SYNTHESIS_PROVIDER: 'openai',

        OPENAI_API_KEY: 'sk-secret-present',

        OPENAI_LEGAL_SYNTHESIS_MODEL: 'gpt-5.6-terra',

        OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS: '10',
      }),
    ).toThrow('legal_synthesis.runtime_timeout_invalid');

    expect(
      resolveOpenAiLegalSynthesisRuntimeConfig({
        LEGAL_SYNTHESIS_PROVIDER: 'openai',

        OPENAI_API_KEY: 'sk-secret-present',

        OPENAI_LEGAL_SYNTHESIS_MODEL: 'gpt-5.6-terra',

        OPENAI_LEGAL_SYNTHESIS_TIMEOUT_MS: '45000',
      }).timeoutMs,
    ).toBe(45_000);
  });

  it('can construct the runtime provider without making a network request', () => {
    let networkCalls = 0;

    const fetchImpl: OpenAiFetch = async () => {
      networkCalls += 1;

      throw new Error('must not run during construction');
    };

    const provider = createOpenAiLegalSynthesisProviderFromRuntime({
      env: {
        LEGAL_SYNTHESIS_PROVIDER: 'openai',

        OPENAI_API_KEY: 'sk-secret-present',

        OPENAI_LEGAL_SYNTHESIS_MODEL: 'gpt-5.6-terra',
      },

      fetchImpl,
    });

    expect(provider).toBeDefined();

    expect(networkCalls).toBe(0);
  });
});
