import type { AiAnalysisResult } from '../types/AiAnalysisResult.js';

export interface AnalyzeMessageInput {
  text?: string | null;
}

export interface AiAnalysisService {
  analyzeMessage(input: AnalyzeMessageInput): Promise<AiAnalysisResult>;
}
