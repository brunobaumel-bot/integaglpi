import type { AiAnalysisService, AnalyzeMessageInput } from './AiAnalysisService.js';

export class UnavailableAiAnalysisService implements AiAnalysisService {
  public async analyzeMessage(_input: AnalyzeMessageInput): Promise<never> {
    throw new Error('AI provider real ainda nao configurado nesta PoC.');
  }
}
