import type { AiTaskId } from './task.js';

export const GHANA_JURISDICTION_CODE = 'GH' as const;

export const aiTaskScopeModes = [
  'ghana_corpus',
  'ghana_corpus_and_firm_knowledge',
  'ghana_corpus_and_matter',
  'ghana_corpus_and_matter_and_firm_knowledge',
] as const;

export type AiTaskScopeMode = (typeof aiTaskScopeModes)[number];

export interface AiTaskScopeRevision {
  readonly organizationId: string;
  readonly taskId: AiTaskId;
  readonly revision: number;
  readonly jurisdictionId: string;
  readonly jurisdictionCode: typeof GHANA_JURISDICTION_CODE;
  readonly scopeMode: AiTaskScopeMode;
  readonly matterId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: Date;
}

export function aiTaskScopeUsesMatter(scopeMode: AiTaskScopeMode): boolean {
  return (
    scopeMode === 'ghana_corpus_and_matter' ||
    scopeMode === 'ghana_corpus_and_matter_and_firm_knowledge'
  );
}

export function aiTaskScopeUsesFirmKnowledge(scopeMode: AiTaskScopeMode): boolean {
  return (
    scopeMode === 'ghana_corpus_and_firm_knowledge' ||
    scopeMode === 'ghana_corpus_and_matter_and_firm_knowledge'
  );
}
