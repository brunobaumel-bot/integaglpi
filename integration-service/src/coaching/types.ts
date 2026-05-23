export const COACHING_RECOMMENDATION_VERSION = 'coaching_v1_2026_05';

export const COACHING_RECOMMENDATION_TYPES = [
  'onboarding_plan',
  'training_path',
  'kb_study_suggestion',
  'communication_skill',
  'coaching_session_tip',
  'kb_review_recommendation',
  'process_improvement',
  'data_quality_warning',
] as const;

export type CoachingRecommendationType = typeof COACHING_RECOMMENDATION_TYPES[number];
export type CoachingScopeType = 'team' | 'queue' | 'category' | 'technician_private' | 'entity';
export type CoachingRecommendationStatus = 'active' | 'dismissed' | 'archived';

export interface CoachingKbArticle {
  articleId: number;
  title: string;
  category: string;
  internalUrl: string;
}

export interface CoachingSignalInput {
  scopeType: CoachingScopeType;
  scopeLabel: string;
  periodLabel: string;
  aiAnalysisCount: number;
  averageClarity?: number | null;
  averageEmpathy?: number | null;
  averageCompleteness?: number | null;
  kbNotAlignedCount?: number;
  kbNoArticleFoundCount?: number;
  procedureNotFollowedCount?: number;
  highSatisfactionRiskCount?: number;
  pendingKbCandidatesCount?: number;
  highRiskScoreCount?: number;
  usefulCopilotFeedbackCount?: number;
  notUsefulCopilotFeedbackCount?: number;
  relatedKbArticles?: CoachingKbArticle[];
  inputHash?: string;
}

export interface CoachingOnboardingPlan {
  day7: string[];
  day15: string[];
  day30: string[];
}

export interface CoachingRecommendation {
  recommendationId: string;
  recommendationKey: string;
  scopeType: CoachingScopeType;
  scopeHash: string;
  recommendationType: CoachingRecommendationType;
  title: string;
  summarySanitized: string;
  explanationSanitized: string;
  suggestedActions: string[];
  kbArticles: CoachingKbArticle[];
  onboardingPlan: CoachingOnboardingPlan;
  confidenceScore: number;
  inputHash: string;
  recommendationVersion: string;
  status: CoachingRecommendationStatus;
}
