/**
 * LogmeinAlarmEngineService
 *
 * Motor de avaliação de regras de alarme LogMeIn.
 * Roda como worker assíncrono separado — nunca dentro do webhook WhatsApp.
 *
 * Fluxo por regra habilitada × alvo:
 *   1. Buscar status atual do host no cache PostgreSQL
 *   2. Avaliar condição do alarme
 *   3. Para host_offline: verificar checks consecutivos (Redis)
 *   4. Verificar cooldown via Redis (SET EX)
 *   5. Verificar dedupe via event_hash (INSERT ON CONFLICT DO NOTHING)
 *   6. Para tipos alert-only: log interno — NUNCA cria ticket
 *   7. Para tipos auto-ticket: criar chamado GLPI (gate duplo: flag global + flag por regra)
 *   8. Gravar evento de auditoria
 *
 * FORBIDDEN:
 *   - Nunca envia WhatsApp
 *   - Nunca fecha chamado automaticamente
 *   - Nunca atribui técnico automaticamente
 *   - Nunca cria ticket sem glpi_entities_id > 0
 *   - Nunca cria ticket sem categoria (glpi_itil_category_id)
 *   - Nunca cria ticket sem fila/grupo (glpi_group_id)
 *   - Nunca acessa banco de dados do GLPI (apenas PostgreSQL de integração)
 *   - Nunca grava PII de usuários/perfis
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger/logger.js';
import type {
  PostgresLogmeinAlarmRepository,
  LogmeinAlarmRule,
  LogmeinAlarmTarget,
} from '../../repositories/postgres/PostgresLogmeinAlarmRepository.js';
import { LogmeinAlarmRulesService } from './LogmeinAlarmRulesService.js';
import type { LogmeinHostContext } from './LogmeinReadonlyContextService.js';
import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';

// ── Redis facade ──────────────────────────────────────────────────────────────

export interface AlarmRedisFacade {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
}

// ── Result ────────────────────────────────────────────────────────────────────

export interface AlarmEngineResult {
  processed: number;
  fired: number;
  cooldownSkipped: number;
  dedupeSkipped: number;
  consecutiveWaiting: number;
  ticketsCreated: number;
  errors: number;
  engineDisabled: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinAlarmEngineService {
  public constructor(
    private readonly repository: PostgresLogmeinAlarmRepository,
    private readonly redis: AlarmRedisFacade,
    private readonly glpiClient: GlpiClient | null,
  ) {}

  /**
   * Avalia todas as regras habilitadas uma vez.
   * Seguro para chamar em loop — nunca lança exceção.
   */
  public async runOnce(): Promise<AlarmEngineResult> {
    const result: AlarmEngineResult = {
      processed: 0,
      fired: 0,
      cooldownSkipped: 0,
      dedupeSkipped: 0,
      consecutiveWaiting: 0,
      ticketsCreated: 0,
      errors: 0,
      engineDisabled: false,
    };

    if (!env.LOGMEIN_ALARM_ENGINE_ENABLED) {
      result.engineDisabled = true;
      return result;
    }

    let rules: LogmeinAlarmRule[] = [];
    try {
      rules = await this.repository.listEnabledRules();
    } catch (error: unknown) {
      logger.error(
        { errorMessage: error instanceof Error ? error.message : String(error) },
        '[logmein_alarm][engine] Falha ao listar regras habilitadas.',
      );
      result.errors += 1;
      return result;
    }

    for (const rule of rules) {
      try {
        const partial = await this.evaluateRule(rule);
        result.processed += partial.processed;
        result.fired += partial.fired;
        result.cooldownSkipped += partial.cooldownSkipped;
        result.dedupeSkipped += partial.dedupeSkipped;
        result.consecutiveWaiting += partial.consecutiveWaiting;
        result.ticketsCreated += partial.ticketsCreated;
        result.errors += partial.errors;
      } catch (error: unknown) {
        logger.error(
          {
            rule_id: rule.id,
            rule_name: rule.ruleName,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          '[logmein_alarm][engine] Erro inesperado ao avaliar regra.',
        );
        result.errors += 1;
      }
    }

    return result;
  }

  // ── Per-rule evaluation ───────────────────────────────────────────────────

  private async evaluateRule(rule: LogmeinAlarmRule): Promise<AlarmEngineResult> {
    const result = emptyResult();

    let targets: LogmeinAlarmTarget[] = [];
    try {
      targets = await this.repository.listTargetsForRule(rule.id);
    } catch {
      result.errors += 1;
      return result;
    }

    if (targets.length === 0) return result;

    const hostIds = targets.map((t) => t.hostId);
    const hostStatusMap = await this.repository.getHostsCurrentStatus(hostIds);

    for (const target of targets) {
      result.processed += 1;
      try {
        const partial = await this.evaluateTarget(rule, target, hostStatusMap.get(target.hostId) ?? null);
        result.fired += partial.fired;
        result.cooldownSkipped += partial.cooldownSkipped;
        result.dedupeSkipped += partial.dedupeSkipped;
        result.consecutiveWaiting += partial.consecutiveWaiting;
        result.ticketsCreated += partial.ticketsCreated;
        result.errors += partial.errors;
      } catch (error: unknown) {
        logger.error(
          {
            rule_id: rule.id,
            host_id: target.hostId,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          '[logmein_alarm][engine] Erro ao avaliar alvo.',
        );
        result.errors += 1;
      }
    }

    return result;
  }

  // ── Per-target evaluation ─────────────────────────────────────────────────

  private async evaluateTarget(
    rule: LogmeinAlarmRule,
    target: LogmeinAlarmTarget,
    host: LogmeinHostContext | null,
  ): Promise<AlarmEngineResult> {
    const ZERO = emptyResult();

    // 1. Host not in cache → status unknown → no alarm
    if (host === null) return ZERO;

    // 2. Evaluate condition
    const conditionMet = this.evaluateCondition(rule, host);
    if (!conditionMet) return ZERO;

    // 3. Consecutive check gate (only for host_offline)
    if (rule.alarmType === 'host_offline') {
      const consecutive = await this.evaluateConsecutiveChecks(rule, target);
      if (!consecutive.thresholdReached) {
        return { ...ZERO, consecutiveWaiting: 1 };
      }
    }

    // 4. Cooldown via Redis
    const cooldownKey = `logmein:alarm:cooldown:${rule.id}:${target.hostId}`;
    let cooldownActive = false;
    try {
      const existing = await this.redis.get(cooldownKey);
      cooldownActive = existing !== null;
    } catch {
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Redis unavailable for cooldown check — proceeding without cooldown.',
      );
    }

    if (cooldownActive) {
      logger.info(
        { rule_id: rule.id, host_id: target.hostId, hostname: target.hostname },
        '[logmein_alarm][engine] Cooldown ativo — alarme suprimido.',
      );
      return { ...ZERO, cooldownSkipped: 1 };
    }

    // 5. Dedupe via event_hash (daily granularity)
    const dateUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const eventHash = buildEventHash(rule.id, target.hostId, rule.alarmType, dateUtc);

    let glpiTicketId: number | null = null;
    let ticketsCreated = 0;

    // 6. Alert-only types: log internally, NEVER create ticket
    const isAlertOnly = LogmeinAlarmRulesService.isAlertOnly(rule.alarmType);

    if (!isAlertOnly) {
      // 7. Auto-ticket: gate duplo (global flag + rule flag + category + queue)
      const hasCategory = rule.glpiItilCategoryId !== null && rule.glpiItilCategoryId > 0;
      const hasQueue    = rule.glpiGroupId !== null && rule.glpiGroupId > 0;
      const hasEntity   = rule.glpiEntitiesId > 0;

      const shouldCreateTicket =
        rule.createTicket &&
        env.LOGMEIN_AUTO_TICKET_ENABLED &&
        hasEntity &&
        hasCategory &&   // categoria obrigatória
        hasQueue &&      // fila/grupo obrigatório
        this.glpiClient !== null;

      if (shouldCreateTicket && this.glpiClient !== null) {
        try {
          glpiTicketId = await this.glpiClient.createTicket({
            title: `[LogMeIn] ${rule.alarmType} - ${host.hostName}`,
            content: buildTicketContent(rule, host),
            requesterPhone: 'sistema',
            requesterName: 'Sistema LogMeIn',
            entitiesId: rule.glpiEntitiesId,
            assignedGroupId: rule.glpiGroupId ?? undefined,
            itilcategoriesId: rule.glpiItilCategoryId ?? undefined,
          });
          ticketsCreated = 1;
          logger.info(
            {
              event_type: 'ALARM_TICKET_CREATED',
              rule_id: rule.id,
              host_id: target.hostId,
              hostname: target.hostname,
              glpi_ticket_id: glpiTicketId,
              glpi_entities_id: rule.glpiEntitiesId,
              glpi_category_id: rule.glpiItilCategoryId,
              glpi_group_id: rule.glpiGroupId,
            },
            '[logmein_alarm][engine] Chamado GLPI criado por alarme LogMeIn.',
          );
        } catch (error: unknown) {
          logger.error(
            {
              rule_id: rule.id,
              host_id: target.hostId,
              errorMessage: error instanceof Error ? error.message : String(error),
            },
            '[logmein_alarm][engine] Falha ao criar chamado GLPI — alarme registrado sem ticket.',
          );
        }
      } else if (rule.createTicket && !isAlertOnly) {
        // Log why ticket was skipped
        logger.info(
          {
            rule_id: rule.id,
            host_id: target.hostId,
            auto_ticket_enabled: env.LOGMEIN_AUTO_TICKET_ENABLED,
            has_category: hasCategory,
            has_queue: hasQueue,
            has_entity: hasEntity,
          },
          '[logmein_alarm][engine] Criação de ticket pulada (flag desligada ou guards ausentes).',
        );
      }
    } else {
      // Alert-only: log internal alert
      logger.info(
        {
          event_type: 'ALARM_ALERT_ONLY',
          rule_id: rule.id,
          rule_name: rule.ruleName,
          alarm_type: rule.alarmType,
          host_id: target.hostId,
          hostname: target.hostname,
        },
        '[logmein_alarm][engine] Alerta interno (alert-only) — sem ticket GLPI.',
      );
    }

    // 8. Persist event (ON CONFLICT → dedupe)
    let inserted = false;
    try {
      const insertResult = await this.repository.insertEventIfNew({
        ruleId: rule.id,
        hostId: target.hostId,
        hostname: target.hostname,
        alarmType: rule.alarmType,
        eventHash,
        glpiTicketId,
        cooldownSkipped: false,
        dedupeHit: false,
      });
      inserted = insertResult.inserted;
    } catch {
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Falha ao gravar evento — dedupe inconsistente.',
      );
    }

    if (!inserted) {
      logger.info(
        { rule_id: rule.id, host_id: target.hostId, event_hash: eventHash },
        '[logmein_alarm][engine] Dedupe: alarme já registrado hoje para este host/regra.',
      );
      return { ...ZERO, dedupeSkipped: 1 };
    }

    // 9. Set Redis cooldown
    try {
      const ttlSeconds = rule.cooldownMinutes * 60;
      await this.redis.set(cooldownKey, '1', 'EX', ttlSeconds);
    } catch {
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Falha ao definir cooldown no Redis — alarme registrado sem cooldown.',
      );
    }

    // 10. Audit
    logger.info(
      {
        event_type: 'ALARM_FIRED',
        rule_id: rule.id,
        rule_name: rule.ruleName,
        alarm_type: rule.alarmType,
        alert_only: isAlertOnly,
        host_id: target.hostId,
        hostname: target.hostname,
        glpi_ticket_id: glpiTicketId,
        entity_id: rule.glpiEntitiesId,
        cooldown_minutes: rule.cooldownMinutes,
      },
      '[logmein_alarm][engine] Alarme disparado.',
    );

    return { ...ZERO, fired: 1, ticketsCreated };
  }

  // ── Consecutive check gate (host_offline only) ────────────────────────────

  /**
   * Tracks consecutive offline checks for host_offline rules.
   * Key format: logmein:alarm:consecutive:{rule_id}:{host_id}
   * Value format: "{count}:{epochSeconds}"
   *
   * Only increments if at least consecutiveCheckIntervalMinutes have passed since last count.
   * Returns thresholdReached=true when count >= minConsecutiveChecks.
   */
  private async evaluateConsecutiveChecks(
    rule: LogmeinAlarmRule,
    target: LogmeinAlarmTarget,
  ): Promise<{ thresholdReached: boolean }> {
    const key = `logmein:alarm:consecutive:${rule.id}:${target.hostId}`;
    const nowEpoch = Math.floor(Date.now() / 1_000);
    const minIntervalSeconds = rule.consecutiveCheckIntervalMinutes * 60;

    // TTL: enough to survive min_consecutive_checks intervals plus buffer
    const ttlSeconds = Math.ceil(rule.minConsecutiveChecks * minIntervalSeconds * 1.5) + 60;

    try {
      const rawValue = await this.redis.get(key);
      let count = 0;
      let lastEpoch = 0;

      if (rawValue !== null) {
        const parts = rawValue.split(':');
        count = parseInt(parts[0] ?? '0', 10);
        lastEpoch = parseInt(parts[1] ?? '0', 10);
        if (Number.isNaN(count)) count = 0;
        if (Number.isNaN(lastEpoch)) lastEpoch = 0;
      }

      const elapsed = nowEpoch - lastEpoch;

      // Only count if enough time has passed since last increment
      if (elapsed < minIntervalSeconds && rawValue !== null) {
        // Not enough time — count stays the same
        const thresholdReached = count >= rule.minConsecutiveChecks;
        return { thresholdReached };
      }

      const newCount = count + 1;
      await this.redis.set(key, `${newCount}:${nowEpoch}`, 'EX', ttlSeconds);

      const thresholdReached = newCount >= rule.minConsecutiveChecks;

      if (!thresholdReached) {
        logger.info(
          {
            rule_id: rule.id,
            host_id: target.hostId,
            consecutive_count: newCount,
            required: rule.minConsecutiveChecks,
          },
          '[logmein_alarm][engine] Aguardando checks consecutivos para host_offline.',
        );
      }

      return { thresholdReached };
    } catch {
      // Redis failure: treat as threshold reached to avoid indefinite suppression
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Redis unavailable for consecutive check — treating as threshold reached.',
      );
      return { thresholdReached: true };
    }
  }

  // ── Condition evaluators ──────────────────────────────────────────────────

  private evaluateCondition(rule: LogmeinAlarmRule, host: LogmeinHostContext): boolean {
    switch (rule.alarmType) {
      case 'host_offline':
        return host.status === 'offline';

      case 'host_not_seen': {
        const days = (rule.conditionPayload as Record<string, unknown>)['not_seen_days'];
        if (!Number.isInteger(days) || (days as number) < 1) return false;
        if (host.lastSeenAt === null) return false;
        const lastSeen = new Date(host.lastSeenAt).getTime();
        if (Number.isNaN(lastSeen)) return false;
        const elapsedDays = (Date.now() - lastSeen) / 86_400_000;
        return elapsedDays >= (days as number);
      }

      case 'missing_equipment_tag':
        // Alert-only: host exists in cache but equipmentTag is empty
        return host.equipmentTag === '' || host.equipmentTag == null;

      case 'missing_entity_mapping':
        // Alert-only: host group has no entity mapping (groupExternalId without GLPI entity)
        // Conservative: only trigger if groupExternalId is empty/unknown
        return host.groupExternalId === '' || host.groupExternalId == null;

      case 'hardware_change':
        // Alert-only: reserved for future implementation when hardware delta is available
        // Currently never triggers (no delta data source yet)
        return false;

      case 'low_disk':
        // Alert-only: reserved for future implementation when disk metrics are available
        return false;

      case 'low_memory':
        // Alert-only: reserved for future implementation when memory metrics are available
        return false;

      default:
        return false;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyResult(): AlarmEngineResult {
  return {
    processed: 0,
    fired: 0,
    cooldownSkipped: 0,
    dedupeSkipped: 0,
    consecutiveWaiting: 0,
    ticketsCreated: 0,
    errors: 0,
    engineDisabled: false,
  };
}

/**
 * event_hash = sha256(rule_id || host_id || alarm_type || date_utc)
 * Granularidade: 1 evento por regra/host/tipo/dia (UTC).
 */
function buildEventHash(ruleId: string, hostId: string, alarmType: string, dateUtc: string): string {
  return createHash('sha256')
    .update(`${ruleId}|${hostId}|${alarmType}|${dateUtc}`)
    .digest('hex');
}

/**
 * Conteúdo do chamado GLPI.
 * Nunca inclui PII de usuários/perfis/contatos.
 */
function buildTicketContent(rule: LogmeinAlarmRule, host: LogmeinHostContext): string {
  const lines: string[] = [
    '[Alarme LogMeIn — gerado automaticamente]',
    '',
    `Regra   : ${rule.ruleName}`,
    `Tipo    : ${rule.alarmType}`,
    `Host    : ${host.hostName}`,
    `Grupo   : ${host.groupName}`,
    `Status  : ${host.status}`,
  ];

  if (host.lastSeenAt !== null) {
    lines.push(`Visto em: ${host.lastSeenAt}`);
  }

  lines.push('', 'Este chamado foi criado automaticamente pelo motor de alarme.');
  lines.push('Não responder por este canal ao cliente — fluxo interno.');

  return lines.join('\n');
}
