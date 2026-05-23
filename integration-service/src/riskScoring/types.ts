export const RISK_SCORE_MODEL_VERSION = 'risk_score_v1_2026_05';

export const RISK_LEVELS = ['low', 'medium', 'high', 'unknown'] as const;
export type PredictiveRiskLevel = typeof RISK_LEVELS[number];

export interface CommunicationQualitySignals {
  clarity?: number | null;
  empathy?: number | null;
  completeness?: number | null;
}

export interface AiQualityRiskSignals {
  riskLevel?: string | null;
  urgency?: string | null;
  sentiment?: string | null;
  clientSatisfactionRisk?: string | null;
  communicationQuality?: CommunicationQualitySignals | null;
  kbAlignment?: string | null;
  procedureFollowed?: string | null;
  missingContext?: string[];
  riskFlags?: string[];
  qualityFlags?: string[];
}

export interface HistoricalRiskSignals {
  reopenPatternSeverity?: 'low' | 'medium' | 'high' | null;
  dissatisfactionPatternSeverity?: 'low' | 'medium' | 'high' | null;
  reworkCategoryFrequency?: number;
}

export interface KbCandidateRiskSignals {
  pendingCount?: number;
  possibleDuplicateCount?: number;
}

export interface SlaInactivityRiskSignals {
  slaState?: string | null;
  inactivityStatus?: string | null;
  minutesWithoutTechnicianResponse?: number | null;
}

export interface MessageMetadataRiskSignals {
  messageCount?: number;
  lastActivityAgeMinutes?: number | null;
  reopenCount?: number;
}

export interface CsatRiskSignals {
  rating?: string | null;
  supervisorReviewRequired?: boolean;
}

export interface CopilotFeedbackRiskSignals {
  negativeFeedbackCount?: number;
}

export interface RiskScoringInput {
  conversationId?: string | null;
  glpiTicketId?: number | null;
  aiQuality?: AiQualityRiskSignals | null;
  historical?: HistoricalRiskSignals | null;
  kbCandidates?: KbCandidateRiskSignals | null;
  slaInactivity?: SlaInactivityRiskSignals | null;
  messageMetadata?: MessageMetadataRiskSignals | null;
  csat?: CsatRiskSignals | null;
  copilotFeedback?: CopilotFeedbackRiskSignals | null;
}

export interface RiskScoreResult {
  scoreId: string;
  conversationId: string | null;
  glpiTicketId: number | null;
  modelVersion: string;
  inputHash: string;
  reopenRisk: PredictiveRiskLevel;
  dissatisfactionRisk: PredictiveRiskLevel;
  abandonmentRisk: PredictiveRiskLevel;
  riskScore: number;
  confidenceScore: number;
  reasons: string[];
  suggestedHumanAction: string;
  signalsUsed: string[];
  dataQualityWarnings: string[];
}
