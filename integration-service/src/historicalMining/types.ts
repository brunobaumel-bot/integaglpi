export const HISTORICAL_MINING_INPUT_FORMATS = ['jsonl', 'csv'] as const;
export type HistoricalMiningInputFormat = typeof HISTORICAL_MINING_INPUT_FORMATS[number];

export interface HistoricalMiningCliOptions {
  inputPath: string;
  windowStart?: Date;
  windowEnd?: Date;
  maxRows: number;
  dryRun: boolean;
  outputSummaryPath?: string;
}

export interface HistoricalTicketRecord {
  ticketIdHash: string;
  openedAt: Date;
  solvedAt: Date | null;
  status: string;
  category: string;
  entity: string;
  group: string;
  priority: string | null;
  urgency: string | null;
  titleText: string;
  descriptionText: string;
  followupText: string;
  solutionText: string;
  reopenedCount: number;
  satisfactionScore: number | null;
}

export type HistoricalMiningRejectionReason =
  | 'invalid_json'
  | 'missing_required_field'
  | 'empty_sanitized_text'
  | 'unsupported_status'
  | 'sensitive_data_residual'
  | 'schema_version_mismatch'
  | 'below_minimum_content'
  | 'unknown_error';

export interface HistoricalMiningRejection {
  line: number;
  reason: HistoricalMiningRejectionReason;
  field?: string;
  ticketIdHash?: string;
  excerpt?: string;
}

export interface HistoricalMiningDataset {
  inputHash: string;
  rowsSeen: number;
  rowsRejected: number;
  records: HistoricalTicketRecord[];
  rejectionReasonCounts?: Partial<Record<HistoricalMiningRejectionReason, number>>;
  rejectionExamples?: HistoricalMiningRejection[];
}

export interface HistoricalMiningRunSummary {
  runId: string;
  inputHash: string;
  windowStart: Date | null;
  windowEnd: Date | null;
  rowsSeen: number;
  rowsProcessed: number;
  rowsRejected: number;
}

export type HistoricalPatternType =
  | 'recurring_category'
  | 'reopen_hotspot'
  | 'frustration_signal'
  | 'communication_gap'
  | 'kb_gap_candidate'
  | 'solution_effectiveness';

export interface HistoricalMiningPattern {
  patternType: HistoricalPatternType;
  category: string;
  entityLabelSanitized: string | null;
  frequencyAbs: number;
  severity: 'low' | 'medium' | 'high';
  descriptionSanitized: string;
  evidenceHashes: string[];
}

export type HistoricalInsightType =
  | 'volume'
  | 'reopen'
  | 'satisfaction_risk'
  | 'communication'
  | 'kb_opportunity'
  | 'solution_quality'
  | 'response_time';

export interface HistoricalMiningInsight {
  insightType: HistoricalInsightType;
  priority: 'low' | 'medium' | 'high';
  title: string;
  summarySanitized: string;
  recommendationSanitized: string;
  confidenceScore: number;
  filters: Record<string, unknown>;
}

export interface HistoricalMiningEvidence {
  ticketIdHash: string;
  patternType?: HistoricalPatternType;
  insightType?: HistoricalInsightType;
  anonymizedExcerpt: string;
}

export interface HistoricalMiningResult {
  run: HistoricalMiningRunSummary;
  patterns: HistoricalMiningPattern[];
  insights: HistoricalMiningInsight[];
  evidence: HistoricalMiningEvidence[];
}
