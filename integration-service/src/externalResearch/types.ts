export type ExternalSourceType = 'official_docs' | 'vendor_docs' | 'low_confidence' | 'internal_manual';
export type ExternalResearchStatus =
  | 'previewed'
  | 'blocked_pii'
  | 'blocked_source'
  | 'blocked_budget'
  | 'completed'
  | 'candidate_created'
  | 'incident_reported';
export type ExternalResearchCandidateStatus =
  | 'suggested'
  | 'suggested_low_confidence'
  | 'draft'
  | 'in_review'
  | 'approved_for_manual_publish'
  | 'rejected'
  | 'archived';

export interface ExternalSourceCatalogEntry {
  id: number;
  sourceKey: string;
  name: string;
  urlPattern: string;
  sourceType: ExternalSourceType;
  officialFlag: boolean;
  priority: number;
  confidenceBoost: number;
  enabled: boolean;
  requiresVerification: boolean;
  language: string;
}

export interface SourceValidationResult {
  allowed: boolean;
  blockedReason: string | null;
  matchedSource: ExternalSourceCatalogEntry | null;
  confidenceScore: number;
  confidenceLevel: 'official' | 'verified' | 'low_confidence' | 'blocked';
  warnings: string[];
}

export interface ExternalResearchSanitizationResult {
  inputHash: string;
  anonymizedPayloadHash: string;
  sanitizedText: string;
  detectedKinds: string[];
  blocked: boolean;
  blockedReason: string | null;
}

export interface ExternalResearchSourceInput {
  url: string;
  title?: string;
}

export interface ExternalResearchCandidate {
  candidateId: string;
  status: ExternalResearchCandidateStatus;
  problemSignature: string;
  sanitizedSymptoms: string;
  likelyCategory: string;
  proposedSolution: string;
  stepByStep: string[];
  validationSteps: string[];
  risks: string[];
  prerequisites: string[];
  externalSources: Array<{
    title: string;
    url: string;
    sourceType: ExternalSourceType;
    officialFlag: boolean;
    confidence: number;
    lastVerifiedDate: string;
  }>;
  sourceConflicts: string[];
  confidenceScore: number;
  sourceConfidenceLevel: string;
  lowConfidenceReason: string | null;
  lastVerifiedDate: string;
  nextReviewDue: string;
  humanizedCustomerExplanation: string;
  suggestedKbArticle: {
    title: string;
    contentMarkdown: string;
    tags: string[];
    categorySuggestion: string;
  };
  humanReviewRequired: true;
  autoPublish: false;
  inputHash: string;
  anonymizedPayloadHash: string;
  sourceCatalogIds: number[];
}
