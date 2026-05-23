export const AI_QUALITY_ANALYSIS_VERSION = 'ai_quality_v2';

export const AI_QUALITY_RESOLUTIONS = [
  'resolved',
  'probably_resolved',
  'uncertain',
  'probably_not_resolved',
] as const;

export const AI_QUALITY_SENTIMENTS = [
  'positive',
  'neutral',
  'negative',
  'frustrated',
  'unknown',
] as const;

export const AI_QUALITY_URGENCY_LEVELS = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export const AI_QUALITY_RISK_LEVELS = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

export const AI_QUALITY_RISK_FLAGS = [
  'customer_frustrated',
  'sla_risk',
  'missing_context',
  'meta_failure',
  'glpi_failure',
  'possible_reopen',
  'attachment_issue',
  'preticket_incomplete',
] as const;

export const AI_QUALITY_QUALITY_FLAGS = [
  'good_tone',
  'poor_tone',
  'delayed_response',
  'unclear_instructions',
  'needs_follow_up',
  'insufficient_resolution',
  'complete_context',
  'supervisor_review_required',
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
export type AiQualityUrgency = typeof AI_QUALITY_URGENCY_LEVELS[number];
export type AiQualityRiskLevel = typeof AI_QUALITY_RISK_LEVELS[number];
export type AiQualityRiskFlag = typeof AI_QUALITY_RISK_FLAGS[number];
export type AiQualityQualityFlag = typeof AI_QUALITY_QUALITY_FLAGS[number];
export type AiQualityFlag = typeof AI_QUALITY_FLAGS[number];

export interface AiQualityResult {
  summary: string;
  resolution: AiQualityResolution;
  sentiment: AiQualitySentiment;
  urgency: AiQualityUrgency;
  riskLevel: AiQualityRiskLevel;
  riskFlags: AiQualityRiskFlag[];
  qualityFlags: AiQualityQualityFlag[];
  missingContext: string[];
  probableCause: string;
  suggestedNextAction: string;
  supervisorNotes: string;
  confidenceScore: number;
  safetyNotes: string[];
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
  conversationStatus?: string | null;
  queueName?: string | null;
  entityName?: string | null;
  serviceName?: string | null;
  slaResponseDeadline?: Date | null;
  slaSolutionDeadline?: Date | null;
  accumulatedPausedMinutes?: number | null;
  reopenCount?: number | null;
  csatRating: string | null;
  supervisorReviewRequired: boolean;
  inactivityStatus: string | null;
  inactivitySkipReason?: string | null;
  messages: AiQualityMessage[];
  requesterName?: string | null;
  recentEvents?: AiQualityEvent[];
  attachmentMetadata?: AiQualityAttachmentMetadata[];
  deliveryFailures?: AiQualityDeliveryFailure[];
  templateEvents?: AiQualityTemplateEvent[];
}

export interface AiQualityEvent {
  eventType: string;
  status: string | null;
  severity: string | null;
  errorSummary: string | null;
  createdAt: Date;
}

export interface AiQualityAttachmentMetadata {
  messageType: string;
  status: string | null;
  mimeDetected: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  createdAt: Date;
}

export interface AiQualityDeliveryFailure {
  messageType: string;
  deliveryStatus: string | null;
  metaErrorMessage: string | null;
  createdAt: Date;
}

export interface AiQualityTemplateEvent {
  templateName: string | null;
  deliveryStatus: string | null;
  metaErrorMessage: string | null;
  createdAt: Date;
}
