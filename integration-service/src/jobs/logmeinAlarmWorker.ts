/**
 * logmeinAlarmWorker.ts
 *
 * Worker assíncrono do motor de alarme LogMeIn.
 * Completamente separado do serviço de webhook WhatsApp.
 * Executa em processo próprio ou como job agendado.
 *
 * Completamente isolado do serviço de webhook WhatsApp.
 * NÃO envia WhatsApp.
 * NÃO fecha chamado.
 * NÃO atribui técnico.
 * NUNCA toca produção automaticamente.
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

import { redisClient } from '../cache/redisClient.js';
import { postgresPool } from '../infra/db/postgres.js';
import { logger } from '../infra/logger/logger.js';
import { env } from '../config/env.js';
import { buildDependencies } from '../buildDependencies.js';
import { PostgresLogmeinAlarmRepository } from '../repositories/postgres/PostgresLogmeinAlarmRepository.js';
import { LogmeinAlarmEngineService } from '../domain/services/LogmeinAlarmEngineService.js';

// ── Redis facade (same pattern as aiOnlineSupervisorAlertWorker) ─────────────

function buildAlarmRedisFacade() {
  return {
    get: (key: string) => redisClient.get(key),
    set: (key: string, value: string, mode?: string, ttlSeconds?: number) => {
      if (mode === 'EX' && typeof ttlSeconds === 'number') {
        return redisClient.set(key, value, 'EX', ttlSeconds);
      }
      return redisClient.set(key, value);
    },
  };
}

// ── Single run ────────────────────────────────────────────────────────────────

export async function runLogmeinAlarmWorker(): Promise<void> {
  if (!env.LOGMEIN_ALARM_ENGINE_ENABLED) {
    logger.info(
      { engine_enabled: false },
      '[logmein_alarm][worker] LOGMEIN_ALARM_ENGINE_ENABLED=false — worker encerrado sem processar.',
    );
    return;
  }

  const dependencies = buildDependencies();
  const repository = new PostgresLogmeinAlarmRepository(postgresPool);
  const redisFacade = buildAlarmRedisFacade();

  const engine = new LogmeinAlarmEngineService(
    repository,
    redisFacade,
    dependencies.glpiClient,
  );

  const result = await engine.runOnce();

  logger.info(
    {
      processed: result.processed,
      fired: result.fired,
      cooldown_skipped: result.cooldownSkipped,
      dedupe_skipped: result.dedupeSkipped,
      tickets_created: result.ticketsCreated,
      errors: result.errors,
      engine_disabled: result.engineDisabled,
    },
    '[logmein_alarm][worker] Ciclo de avaliação concluído.',
  );
}

// ── Loop ──────────────────────────────────────────────────────────────────────

async function runLoop(): Promise<void> {
  const intervalSeconds = Math.max(
    30,
    Math.min(3600, env.LOGMEIN_ALARM_WORKER_INTERVAL_SECONDS),
  );

  logger.info(
    { interval_seconds: intervalSeconds },
    '[logmein_alarm][worker] Loop iniciado.',
  );

  while (true) {
    logger.info(
      { interval_seconds: intervalSeconds },
      '[logmein_alarm][worker] Tick.',
    );
    await runLogmeinAlarmWorker();
    await new Promise<void>((resolve) => setTimeout(resolve, intervalSeconds * 1_000));
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (
  process.argv[1]?.endsWith('logmeinAlarmWorker.ts') === true ||
  process.argv[1]?.endsWith('logmeinAlarmWorker.js') === true
) {
  const loopEnabled = process.argv.includes('--loop');
  const runner = loopEnabled ? runLoop : runLogmeinAlarmWorker;

  runner()
    .catch((error: unknown) => {
      logger.error(
        { error },
        '[logmein_alarm][worker] Falha fatal no worker.',
      );
      process.exitCode = 1;
    })
    .finally(() => {
      void postgresPool.end();
      redisClient.disconnect();
    });
}
