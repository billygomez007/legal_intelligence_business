import { describe, expect, it } from 'vitest';

import {
  aiEmployeeTypes,
  aiTaskScopeModes,
  aiTaskScopeUsesFirmKnowledge,
  aiTaskScopeUsesMatter,
  aiTaskStatuses,
  GHANA_JURISDICTION_CODE,
} from '../src/index.js';

describe('AI Tasks Phase 6A domain', () => {
  it('defines exactly the four Ghana-focused AI Employee types', () => {
    expect(aiEmployeeTypes).toEqual([
      'research_associate',
      'ai_paralegal',
      'matter_manager',
      'contract_analyst',
    ]);
  });

  it('defines only the pre-execution task lifecycle', () => {
    expect(aiTaskStatuses).toEqual(['draft', 'ready', 'cancelled']);
  });

  it('defines exactly the four supported Ghana knowledge scopes', () => {
    expect(GHANA_JURISDICTION_CODE).toBe('GH');

    expect(aiTaskScopeModes).toEqual([
      'ghana_corpus',
      'ghana_corpus_and_firm_knowledge',
      'ghana_corpus_and_matter',
      'ghana_corpus_and_matter_and_firm_knowledge',
    ]);
  });

  it('classifies selected-matter scopes explicitly', () => {
    expect(aiTaskScopeUsesMatter('ghana_corpus')).toBe(false);
    expect(aiTaskScopeUsesMatter('ghana_corpus_and_firm_knowledge')).toBe(false);
    expect(aiTaskScopeUsesMatter('ghana_corpus_and_matter')).toBe(true);
    expect(aiTaskScopeUsesMatter('ghana_corpus_and_matter_and_firm_knowledge')).toBe(true);
  });

  it('classifies Firm Knowledge scopes explicitly', () => {
    expect(aiTaskScopeUsesFirmKnowledge('ghana_corpus')).toBe(false);
    expect(aiTaskScopeUsesFirmKnowledge('ghana_corpus_and_firm_knowledge')).toBe(true);
    expect(aiTaskScopeUsesFirmKnowledge('ghana_corpus_and_matter')).toBe(false);
    expect(aiTaskScopeUsesFirmKnowledge('ghana_corpus_and_matter_and_firm_knowledge')).toBe(true);
  });
});
