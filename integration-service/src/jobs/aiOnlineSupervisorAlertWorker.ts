import { RedisKeyLock } from '../cache/RedisKeyLock.js';
import { redisClient } from '../cache/redisClient.js';
import { buildDependencies } from '../buildDependencies.js';
import { RiskScoringService } from '../domain/services/RiskScoringService.js';
import {
  AiOnlineSupervisorAlertService,
  createDefaultAiOnlineSupervisorAlertConfig,
} from '../domain/services/AiOnlineSupervisorAlertService.js';
import { AuditService } from '../domain/services/AuditService.js';
import { env } from '../config/env.js';
import { postgresPool } from '../infra/db/postgres.js';
import { logger } from '../infra/logger/logger.js';
import { PostgresAuditEventRepository } from '../repositories/postgres/PostgresAuditEventRepository.js';

export async function runAiOnlineSupervisorAlertWorker(): Promise<void> {
  const dependencies = buildDependencies();
  const auditService = new AuditService(new PostgresAuditEventRepository(postgresPool));
  const redisFacade = {
    get: (key: string) => redisClient.get(key),
    set: (key: string, value: string, mode?: string, ttlSeconds?: number) => {
      if (mode === 'EX' && typeof ttlSeconds === 'number') {
        return redisClient.set(key, value, 'EX', ttlSeconds);
      }
      return redisClient.set(key, value);
    },
    incr: (key: string) => redisClient.incr(key),
    expire: (key: string, seconds: number) => redisClient.expire(key, seconds),
  };
  const service = new AiOnlineSupervisorAlertService(
    postgresPool,
    redisFacade,
    new RedisKeyLock(120_000, 0, 0),
    new RiskScoringService(),
    dependencies.aiOnlineAlertSupervisorService,
    auditService,
    createDefaultAiOnlineSupervisorAlertConfig(),
  );

  const result = await service.runOnce();
  logger.info(
    {
      processed: result.processed,
      alerts_created: result.created,
      alerts_suppressed: result.suppressed,
      errors_sanitized: result.errors,
    },
    '[integration-service][ai_online_alerts][run_completed]',
  );
}

async function runLoop(): Promise<void> {
  const intervalSeconds = Math.max(60, Math.min(120, env.AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS));
  logger.info(
    {
      interval_seconds: intervalSeconds,
      max_conversations_per_run: createDefaultAiOnlineSupervisorAlertConfig().maxConversationsPerRun,
      max_execution_time_seconds: createDefaultAiOnlineSupervisorAlertConfig().maxExecutionTimeSeconds,
    },
    '[integration-service][ai_online_alerts][loop_started]',
  );
  while (true) {
    logger.info({ interval_seconds: intervalSeconds }, '[integration-service][ai_online_alerts][loop_tick]');
    await runAiOnlineSupervisorAlertWorker();
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

if (process.argv[1]?.endsWith('aiOnlineSupervisorAlertWorker.ts') === true
  || process.argv[1]?.endsWith('aiOnlineSupervisorAlertWorker.js') === true) {
  const loopEnabled = process.argv.includes('--loop') || env.AI_ONLINE_ALERT_WORKER_LOOP;
  const runner = loopEnabled ? runLoop : runAiOnlineSupervisorAlertWorker;
  runner()
    .catch((error: unknown) => {
      logger.error({ error }, '[integration-service][ai_online_alerts][run_failed]');
      process.exitCode = 1;
    })
    .finally(() => {
      void postgresPool.end();
      redisClient.disconnect();
    });
}
