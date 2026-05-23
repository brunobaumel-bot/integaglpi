export type AiPilotProvider = 'disabled' | 'local' | 'cloud';
export type AiPilotOperationType = 'synthetic_test' | 'cloud_llm' | 'embedding_index' | 'embedding_search';
export type AiPilotStatus = 'disabled' | 'blocked' | 'completed' | 'failed' | 'fallback_local';

export interface AiPilotConfig {
  cloudEnabled: boolean;
  embeddingsEnabled: boolean;
  provider: AiPilotProvider;
  model: string;
  monthlyBudgetLimit: number;
  hardBudgetBlock: boolean;
  dpoApproved: boolean;
  adminOptIn: boolean;
  incidentAck: boolean;
  testEnvironmentOnly: boolean;
  environment: string;
  timeoutMs: number;
  retryCount: number;
}

export interface AiPilotUsageRecord {
  requestId: string;
  provider: string;
  model: string;
  operationType: AiPilotOperationType;
  status: AiPilotStatus;
  estimatedCost: number;
  actualCost: number | null;
  inputHash: string;
  anonymizedPayloadHash: string;
  blockedReason: string | null;
  latencyMs: number | null;
  requestedByGlpiUserId: number | null;
}

export interface AiPilotRunInput {
  payload: string;
  requestedByGlpiUserId?: number | null;
  syntheticOnly?: boolean;
}

export interface AiPilotRunResult {
  ok: boolean;
  status: AiPilotStatus;
  requestId: string;
  provider: string;
  model: string;
  estimatedCost: number;
  blockedReason: string | null;
  inputHash: string;
  anonymizedPayloadHash: string;
  detectedKinds: string[];
  latencyMs: number | null;
  outputPreview: string;
  fallbackUsed: boolean;
}
