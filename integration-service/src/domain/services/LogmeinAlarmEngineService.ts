/**
 * LogmeinAlarmEngineService
 *
 * Motor de avaliação de regras de alarme LogMeIn.
 * Roda como worker assíncrono separado — nunca dentro do webhook WhatsApp.
 *
 * Fluxo por regra habilitada × alvo:
 *   1. Buscar status atual do host no cache PostgreSQL
 *   2. Avaliar condição do alarme (host_offline / host_not_seen_minutes)
 *   3. Verificar cooldown via Redis (SET EX)
 *   4. Verificar dedupe via event_hash (INSERT ON CONFLICT DO NOTHING)
 *   5. Opcionalmente criar chamado GLPI (gate duplo: LOGMEIN_AUTO_TICKET_ENABLED + create_ticket)
 *   6. Gravar evento de auditoria
 *
 * FORBIDDEN:
 *   - Nunca envia WhatsApp
 *   - Nunca fecha chamado automaticamente
 *   - Nunca atribui técnico automaticamente
 *   - Nunca cria ticket sem glpi_entities_id > 0
 *   - Nunca acessa o banco de dados do GLPI (apenas PostgreSQL de integração)
 *   - Nunca grava PII de usuários/perfis
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../infra/logger/logger.js';
import type { PostgresLogmeinAlarmRepository, LogmeinAlarmRule, LogmeinAlarmTarget } from '../../repositories/postgres/PostgresLogmeinAlarmRepository.js';
import type { LogmeinHostContext } from './LogmeinReadonlyContextService.js';
import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';

// ── Redis facade (same pattern as aiOnlineAlertRedisFacade) ──────────────────

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
    const result: AlarmEngineResult = {
      processed: 0,
      fired: 0,
      cooldownSkipped: 0,
      dedupeSkipped: 0,
      ticketsCreated: 0,
      errors: 0,
      engineDisabled: false,
    };

    let targets: LogmeinAlarmTarget[] = [];
    try {
      targets = await this.repository.listTargetsForRule(rule.id);
    } catch {
      result.errors += 1;
      return result;
    }

    if (targets.length === 0) return result;

    // Fetch current status for all targets in one query
    const hostIds = targets.map((t) => t.hostId);
    const hostStatusMap = await this.repository.getHostsCurrentStatus(hostIds);

    for (const target of targets) {
      result.processed += 1;
      try {
        const partial = await this.evaluateTarget(rule, target, hostStatusMap.get(target.hostId) ?? null);
        result.fired += partial.fired;
        result.cooldownSkipped += partial.cooldownSkipped;
        result.dedupeSkipped += partial.dedupeSkipped;
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
  ): Promise<{ fired: number; cooldownSkipped: number; dedupeSkipped: number; ticketsCreated: number; errors: number }> {
    const ZERO = { fired: 0, cooldownSkipped: 0, dedupeSkipped: 0, ticketsCreated: 0, errors: 0 };

    // 1. Host not in cache → status unknown → no alarm
    if (host === null) {
      return ZERO;
    }

    // 2. Evaluate condition
    const conditionMet = this.evaluateCondition(rule, host);
    if (!conditionMet) return ZERO;

    // 3. Check cooldown via Redis
    const cooldownKey = `logmein:alarm:cooldown:${rule.id}:${target.hostId}`;
    let cooldownActive = false;
    try {
      const existing = await this.redis.get(cooldownKey);
      cooldownActive = existing !== null;
    } catch {
      // Redis failure: safe-fail → treat as no cooldown (alarm can fire)
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Redis unavailable for cooldown check — proceeding.',
      );
    }

    if (cooldownActive) {
      logger.info(
        { rule_id: rule.id, host_id: target.hostId, hostname: target.hostname },
        '[logmein_alarm][engine] Cooldown ativo — alarme suprimido.',
      );
      return { ...ZERO, cooldownSkipped: 1 };
    }

    // 4. Dedupe via event_hash (daily granularity)
    const dateUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const eventHash = buildEventHash(rule.id, target.hostId, rule.alarmType, dateUtc);

    let glpiTicketId: number | null = null;
    let ticketsCreated = 0;

    // 5. Optionally create GLPI ticket (gate duplo)
    const shouldCreateTicket =
      rule.createTicket &&
      env.LOGMEIN_AUTO_TICKET_ENABLED &&
      rule.glpiEntitiesId > 0 && // guard: never create without valid entity
      this.glpiClient !== null;

    if (shouldCreateTicket && this.glpiClient !== null) {
      try {
        glpiTicketId = await this.glpiClient.createTicket({
          title: `[LogMeIn] ${rule.alarmType} - ${host.hostName}`,
          content: buildTicketContent(rule, host),
          requesterPhone: 'sistema', // internal ticket — no real phone
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
    }

    // 6. Persist event (INSERT ON CONFLICT → dedupe)
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
      // event_hash conflict → dedupe hit
      logger.info(
        { rule_id: rule.id, host_id: target.hostId, event_hash: eventHash },
        '[logmein_alarm][engine] Dedupe: alarme já registrado hoje para este host/regra.',
      );
      return { ...ZERO, dedupeSkipped: 1 };
    }

    // 7. Set Redis cooldown
    try {
      const ttlSeconds = rule.cooldownMinutes * 60;
      await this.redis.set(cooldownKey, '1', 'EX', ttlSeconds);
    } catch {
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Falha ao definir cooldown no Redis — alarme registrado sem cooldown.',
      );
    }

    // 8. Audit log
    logger.info(
      {
        event_type: 'ALARM_FIRED',
        rule_id: rule.id,
        rule_name: rule.ruleName,
        alarm_type: rule.alarmType,
        host_id: target.hostId,
        hostname: target.hostname,
        glpi_ticket_id: glpiTicketId,
        entity_id: rule.glpiEntitiesId,
        cooldown_minutes: rule.cooldownMinutes,
      },
      '[logmein_alarm][engine] Alarme disparado.',
    );

    return { fired: 1, cooldownSkipped: 0, dedupeSkipped: 0, ticketsCreated, errors: 0 };
  }

  // ── Condition evaluators ──────────────────────────────────────────────────

  private evaluateCondition(rule: LogmeinAlarmRule, host: LogmeinHostContext): boolean {
    switch (rule.alarmType) {
      case 'host_offline':
        return host.status === 'offline';

      case 'host_not_seen_minutes': {
        const minutes = (rule.conditionPayload as Record<string, unknown>)['not_seen_minutes'];
        if (!Number.isInteger(minutes) || (minutes as number) < 1) return false;
        if (host.lastSeenAt === null) return false;
        const lastSeen = new Date(host.lastSeenAt).getTime();
        if (Number.isNaN(lastSeen)) return false;
        const elapsedMinutes = (Date.now() - lastSeen) / 60_000;
        return elapsedMinutes >= (minutes as number);
      }

      default:
        return false;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
 * Apenas dados do host LogMeIn (hostname, grupo, status, lastSeenAt).
 */
function buildTicketContent(rule: LogmeinAlarmRule, host: LogmeinHostContext): string {
  const lines: string[] = [
    `[Alarme LogMeIn — gerado automaticamente]`,
    ``,
    `Regra   : ${rule.ruleName}`,
    `Tipo    : ${rule.alarmType}`,
    `Host    : ${host.hostName}`,
    `Grupo   : ${host.groupName}`,
    `Status  : ${host.status}`,
  ];

  if (host.lastSeenAt !== null) {
    lines.push(`Visto em: ${host.lastSeenAt}`);
  }

  lines.push(``, `Este chamado foi criado automaticamente pelo motor de alarme.`);
  lines.push(`Não responder por este canal ao cliente — fluxo interno.`);

  return lines.join('\n');
}
