import { defineIdKind, type Id } from '@legalintel/kernel';

export type AiTaskId = Id<'AiTask'>;
export const AiTaskId = defineIdKind('AiTask');

export const aiEmployeeTypes = [
  'research_associate',
  'ai_paralegal',
  'matter_manager',
  'contract_analyst',
] as const;

export type AiEmployeeType = (typeof aiEmployeeTypes)[number];

export const aiTaskStatuses = ['draft', 'ready', 'cancelled'] as const;
export type AiTaskStatus = (typeof aiTaskStatuses)[number];

export interface AiTask {
  readonly id: AiTaskId;
  readonly organizationId: string;
  readonly requestedByUserId: string;
  readonly employeeType: AiEmployeeType;
  readonly title: string;
  readonly instructions: string;
  readonly status: AiTaskStatus;
  readonly currentScopeRevision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
