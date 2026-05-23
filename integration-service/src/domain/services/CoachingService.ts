import { generateCoachingRecommendations } from '../../coaching/engine.js';
import type { CoachingSignalInput } from '../../coaching/types.js';
import { CoachingRecommendationRepository } from '../../coaching/repository.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { AuditService } from './AuditService.js';

export class CoachingService {
  private readonly repository: CoachingRecommendationRepository;

  public constructor(
    executor: SqlExecutor,
    private readonly auditService?: AuditService,
  ) {
    this.repository = new CoachingRecommendationRepository(executor);
  }

  public async generateAndPersist(input: CoachingSignalInput): Promise<{ generated: number; persisted: number }> {
    const recommendations = generateCoachingRecommendations(input);
    const persisted = await this.repository.upsertMany(recommendations);
    await this.auditService?.recordAuditEventSafe({
      eventType: 'COACHING_RECOMMENDATIONS_GENERATED',
      status: 'success',
      severity: 'info',
      source: 'CoachingService',
      payload: {
        scope_type: input.scopeType,
        recommendations: recommendations.length,
        input_hash: recommendations[0]?.inputHash ?? input.inputHash ?? null,
        recommendation_version: recommendations[0]?.recommendationVersion ?? null,
      },
    });

    return { generated: recommendations.length, persisted };
  }
}
