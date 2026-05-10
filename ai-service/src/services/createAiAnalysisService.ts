import { env } from '../config/env.js';
import { MockAiAnalysisService } from '../domain/services/MockAiAnalysisService.js';
import { UnavailableAiAnalysisService } from '../domain/services/UnavailableAiAnalysisService.js';

import type { AiAnalysisService } from '../domain/services/AiAnalysisService.js';

/** Mock quando `AI_ENABLED=false` ou `AI_PROVIDER` (case-insensitive) é `mock`. Sem clientes externos. */
export function isMockModeEnabled(): boolean {
  return !env.AI_ENABLED || env.AI_PROVIDER.toLowerCase() === 'mock';
}

export function createAiAnalysisService(): AiAnalysisService {
  if (isMockModeEnabled()) {
    return new MockAiAnalysisService();
  }

  return new UnavailableAiAnalysisService();
}
