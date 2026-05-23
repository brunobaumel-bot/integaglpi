import type { SqlExecutor } from '../infra/db/postgres.js';
import type { CoachingRecommendation } from './types.js';

export class CoachingRecommendationRepository {
  public constructor(private readonly executor: SqlExecutor) {}

  public async upsertMany(recommendations: CoachingRecommendation[]): Promise<number> {
    let persisted = 0;
    for (const recommendation of recommendations) {
      await this.executor.query(
        `
          INSERT INTO public.glpi_plugin_integaglpi_coaching_recommendations (
            recommendation_id,
            recommendation_key,
            scope_type,
            scope_hash,
            recommendation_type,
            title,
            summary_sanitized,
            explanation_sanitized,
            suggested_actions_json,
            kb_articles_json,
            onboarding_plan_json,
            confidence_score,
            input_hash,
            recommendation_version,
            status,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, NOW())
          ON CONFLICT (recommendation_key) DO UPDATE SET
            summary_sanitized = EXCLUDED.summary_sanitized,
            explanation_sanitized = EXCLUDED.explanation_sanitized,
            suggested_actions_json = EXCLUDED.suggested_actions_json,
            kb_articles_json = EXCLUDED.kb_articles_json,
            onboarding_plan_json = EXCLUDED.onboarding_plan_json,
            confidence_score = EXCLUDED.confidence_score,
            updated_at = NOW()
          WHERE public.glpi_plugin_integaglpi_coaching_recommendations.status = 'active'
        `,
        [
          recommendation.recommendationId,
          recommendation.recommendationKey,
          recommendation.scopeType,
          recommendation.scopeHash,
          recommendation.recommendationType,
          recommendation.title,
          recommendation.summarySanitized,
          recommendation.explanationSanitized,
          JSON.stringify(recommendation.suggestedActions),
          JSON.stringify(recommendation.kbArticles),
          JSON.stringify(recommendation.onboardingPlan),
          recommendation.confidenceScore,
          recommendation.inputHash,
          recommendation.recommendationVersion,
          recommendation.status,
        ],
      );
      persisted++;
    }

    return persisted;
  }
}
