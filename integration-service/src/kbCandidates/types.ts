export const KB_CANDIDATE_ARTICLE_TYPES = [
  'procedimento_tecnico',
  'solucao_comum',
  'resposta_padrao_humanizada',
  'checklist_diagnostico',
  'faq_interno',
  'alerta_operacional',
  'pergunta_inicial_recomendada',
] as const;

export type KbCandidateArticleType = typeof KB_CANDIDATE_ARTICLE_TYPES[number];

export const KB_CANDIDATE_STATUSES = [
  'suggested',
  'in_review',
  'approved',
  'rejected',
  'low_confidence',
  'possible_duplicate',
] as const;

export type KbCandidateStatus = typeof KB_CANDIDATE_STATUSES[number];

export interface KbCandidateNativeArticle {
  articleId: number;
  title: string;
  category: string;
  internalUrl: string;
  excerpt?: string;
}

export interface KbCandidateSourcePattern {
  id: number;
  patternType: string;
  category: string;
  frequencyAbs: number;
  severity: 'low' | 'medium' | 'high';
  descriptionSanitized: string;
  evidenceHashes: string[];
}

export interface KbCandidateSourceInsight {
  id: number;
  insightType: string;
  priority: 'low' | 'medium' | 'high';
  title: string;
  summarySanitized: string;
  recommendationSanitized: string;
  confidenceScore: number;
  filters: Record<string, unknown>;
}

export interface KbCandidateSourceEvidence {
  ticketIdHash: string;
  anonymizedExcerpt: string;
}

export interface KbCandidateGenerationInput {
  runId: string;
  inputHash: string;
  patterns: KbCandidateSourcePattern[];
  insights: KbCandidateSourceInsight[];
  evidence: KbCandidateSourceEvidence[];
  nativeArticles?: KbCandidateNativeArticle[];
}

export const KB_CANDIDATE_DIFFICULTY_LEVELS = ['basico', 'intermediario', 'avancado'] as const;
export type KbCandidateDifficultyLevel = typeof KB_CANDIDATE_DIFFICULTY_LEVELS[number];

export interface KbCandidateGenerationOptions {
  minConfidence: number;
  maxCandidates: number;
  /** Minimum recurrence (frequencyAbs) for a pattern to yield a candidate. Default 5. */
  recurrenceThreshold: number;
  /** Token-overlap ratio above which a candidate is flagged as a duplicate. Default 0.75. */
  duplicateSimilarityThreshold: number;
}

export interface GeneratedKbCandidate {
  candidateKey: string;
  inputHash: string;
  status: KbCandidateStatus;
  articleType: KbCandidateArticleType;
  title: string;
  contentMarkdown: string;
  problemPattern: string;
  symptoms: string[];
  probableCause: string;
  recommendedProcedure: string[];
  checklistItems: string[];
  humanizedCustomerResponse: string;
  tags: string[];
  categorySuggestion: string;
  relatedNativeKbArticles: KbCandidateNativeArticle[];
  possibleDuplicate: boolean;
  duplicateReason: string | null;
  sourcePatternIds: number[];
  sourceInsightIds: number[];
  evidenceSummarySanitized: string;
  evidenceHashes: string[];
  confidenceScore: number;
  /** Human-readable justification for the confidence score (never artificial 100%). */
  confidenceReason: string;
  /** Estimated difficulty of executing the procedure. */
  difficultyLevel: KbCandidateDifficultyLevel;
  /** Intended reader of the article (e.g. "Técnico N1", "Técnico N2"). */
  targetAudience: string;
  limitations: string[];
}

export interface KbCandidateCliOptions {
  runId: string;
  maxCandidates: number;
  minConfidence: number;
  dryRun: boolean;
  outputSummaryPath?: string;
  nativeKbExportPath?: string;
}
