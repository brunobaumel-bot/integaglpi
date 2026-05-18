export const AI_QUALITY_ANALYSIS_VERSION = 'ai_quality_v1';

export const AI_QUALITY_RESOLUTIONS = [
  'resolved',
  'probably_resolved',
  'uncertain',
  'probably_not_resolved',
] as const;

export const AI_QUALITY_SENTIMENTS = [
  'satisfied',
  'neutral',
  'dissatisfied',
  'high_risk',
] as const;

export const AI_QUALITY_FLAGS = [
  'supervisor_review_required',
  'needs_training',
  'customer_dissatisfied',
  'unclear_resolution',
  'long_delay',
  'poor_tone',
] as const;

export type AiQualityResolution = typeof AI_QUALITY_RESOLUTIONS[number];
export type AiQualitySentiment = typeof AI_QUALITY_SENTIMENTS[number];
export type AiQualityFlag = typeof AI_QUALITY_FLAGS[number];

export interface AiQualityResult {
  summary: string;
  resolution: AiQualityResolution;
  sentiment: AiQualitySentiment;
  flags: AiQualityFlag[];
  recommendation: string;
}

export interface AiQualityMessage {
  direction: string;
  messageType: string;
  messageText: string;
  createdAt: Date;
}

export interface AiQualityContext {
  conversationId: string;
  glpiTicketId: number;
  ticketStatus: string | null;
  csatRating: string | null;
  supervisorReviewRequired: boolean;
  inactivityStatus: string | null;
  messages: AiQualityMessage[];
  requesterName?: string | null;
}
