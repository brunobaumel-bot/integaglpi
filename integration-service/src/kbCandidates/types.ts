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

export interface KbCandidateGenerationOptions {
  minConfidence: number;
  maxCandidates: number;
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
