import type { AiQualityContext, AiQualityResult } from '../../ai/aiQualityTypes.js';

export type AiQualityAnalysisStatus = 'pending' | 'completed' | 'failed' | 'skipped';
export type AiQualitySupervisorFeedback = 'useful' | 'not_useful' | 'incorrect';

export interface AiQualityAnalysisRecord {
  id: string;
  conversationId: string;
  glpiTicketId: number;
  analysisVersion: string;
  provider: string;
  model: string;
  status: AiQualityAnalysisStatus;
  classificationResolution: string | null;
  sentiment: string | null;
  flags: string[];
  summary: string | null;
  recommendation: string | null;
  resultJson: Record<string, unknown> | null;
  supervisorFeedback: AiQualitySupervisorFeedback | null;
  feedbackNotes: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAiQualityPendingInput {
  conversationId: string;
  glpiTicketId: number;
  analysisVersion: string;
  provider: string;
  model: string;
  createdBy: number | null;
}

export interface AiQualityAnalysisRepository {
  getContext(conversationId: string, glpiTicketId: number, maxMessages: number): Promise<AiQualityContext | null>;
  createPending(input: CreateAiQualityPendingInput): Promise<AiQualityAnalysisRecord>;
  markCompleted(id: string, result: AiQualityResult): Promise<AiQualityAnalysisRecord>;
  markFailed(id: string, errorMessage: string): Promise<AiQualityAnalysisRecord>;
  markSkipped(id: string, reason: string): Promise<AiQualityAnalysisRecord>;
  saveFeedback(id: string, feedback: AiQualitySupervisorFeedback, notes: string | null): Promise<AiQualityAnalysisRecord | null>;
}
