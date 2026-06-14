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
 *   6. Para tipos sem fonte segura: log interno — NUNCA cria ticket
 *   7. Para tipos suportados: criar chamado GLPI (gate duplo: flag global + flag por regra)
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
import type { LogmeinHardwareInventoryService, LogmeinHardwareInventory } from './LogmeinHardwareInventoryService.js';
import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';

const CHECKIN_DERIVED_ALARM_TYPES = new Set<string>([
  'host_offline',
  'host_not_seen',
  'host_not_seen_minutes',
]);

const DAILY_DEDUP_ALARM_TYPES = new Set<string>([
  'host_offline',
  'host_not_seen',
  'host_not_seen_minutes',
]);

const DELEGATED_TO_LOGMEIN_NATIVE_TYPES = new Set<string>([
  'cpu',
  'ram',
  'disk',
  'antivirus',
  'windows_update',
  'event_log',
  'low_disk',
  'low_memory',
  'hardware_change',
  'missing_equipment_tag',
  'missing_entity_mapping',
]);

const NON_DAILY_DEDUP_WINDOW_MS = 15 * 60 * 1000;

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
    private readonly hardwareInventoryService: LogmeinHardwareInventoryService | null = null,
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

    if (!isCheckinDerivedAlarmType(rule.alarmType)) {
      logger.info(
        {
          rule_id: rule.id,
          rule_name: rule.ruleName,
          alarm_type: rule.alarmType,
          reason: 'delegated_to_logmein_native',
          delegated_type_known: DELEGATED_TO_LOGMEIN_NATIVE_TYPES.has(rule.alarmType),
        },
        '[logmein_alarm][engine] Regra delegada ao LogMeIn nativo — motor interno não avalia threshold.',
      );
      return result;
    }

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
    const conditionMet = await this.evaluateCondition(rule, host, target);
    if (!conditionMet) return ZERO;

    // 3. Consecutive check gate (only for host_offline)
    if (rule.alarmType === 'host_offline') {
      const consecutive = await this.evaluateConsecutiveChecks(rule, target);
      if (!consecutive.thresholdReached) {
        return { ...ZERO, consecutiveWaiting: 1 };
      }
    }

    // 4. Cooldown via Redis
    // FAIL-SAFE: Redis unavailable → suppress alarm (return cooldownSkipped) rather than
    // proceeding without cooldown protection. This prevents duplicate tickets during outages.
    const cooldownKey = `logmein:alarm:cooldown:${rule.id}:${target.hostId}`;
    let cooldownActive = false;
    let redisAvailable = true;
    try {
      const existing = await this.redis.get(cooldownKey);
      cooldownActive = existing !== null;
    } catch {
      redisAvailable = false;
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Redis unavailable for cooldown check — suppressing alarm (fail-safe).',
      );
    }

    // Fail-safe: if Redis is unavailable we cannot guarantee cooldown — suppress alarm.
    if (!redisAvailable) {
      return { ...ZERO, cooldownSkipped: 1 };
    }

    if (cooldownActive) {
      logger.info(
        { rule_id: rule.id, host_id: target.hostId, hostname: target.hostname },
        '[logmein_alarm][engine] Cooldown ativo — alarme suprimido.',
      );
      return { ...ZERO, cooldownSkipped: 1 };
    }

    // 5. Dedupe via event_hash.
    // Check-in derived alarms keep daily granularity; future non-daily rules use a 15 min bucket + payload hash.
    const dedupKey = buildDedupWindowKey(rule.alarmType);
    const payloadHash = DAILY_DEDUP_ALARM_TYPES.has(rule.alarmType)
      ? ''
      : buildAlarmPayloadHash(rule.conditionPayload);
    const eventHash = buildEventHash(rule.id, target.hostId, rule.alarmType, dedupKey, payloadHash);

    let glpiTicketId: number | null = null;
    let ticketsCreated = 0;

    // 6. Alert-only types: log internally, NEVER create ticket
    const isAlertOnly = LogmeinAlarmRulesService.isAlertOnly(rule.alarmType);

    if (!isAlertOnly) {
      // 7. Auto-ticket: gate duplo (global flag + rule flag + category + queue)
      const hasCategory = rule.glpiItilCategoryId !== null && rule.glpiItilCategoryId > 0;
      const hasQueue    = rule.glpiGroupId !== null && rule.glpiGroupId > 0;
      const ticketEntityId = resolveTicketEntity(rule, host);
      const hasEntity   = ticketEntityId > 0;

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
            entitiesId: ticketEntityId,
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
              glpi_entities_id: ticketEntityId,
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
            resolved_entity_id: ticketEntityId,
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
        entity_id: resolveTicketEntity(rule, host),
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
      // FAIL-SAFE: Redis unavailable → suppress alarm (thresholdReached=false) rather than
      // treating as reached. This prevents tickets without the consecutive-check guard.
      // The worker will retry on the next cycle when Redis is available again.
      logger.warn(
        { rule_id: rule.id, host_id: target.hostId },
        '[logmein_alarm][engine] Redis unavailable for consecutive check — suppressing alarm (fail-safe).',
      );
      return { thresholdReached: false };
    }
  }

  // ── Condition evaluators ──────────────────────────────────────────────────

  private async evaluateCondition(
    rule: LogmeinAlarmRule,
    host: LogmeinHostContext,
    target: LogmeinAlarmTarget,
  ): Promise<boolean> {
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

      case 'host_not_seen_minutes': {
        const minutes = (rule.conditionPayload as Record<string, unknown>)['not_seen_minutes'];
        if (!Number.isInteger(minutes) || (minutes as number) < 1) return false;
        if (host.lastSeenAt === null) return false;
        const lastSeen = new Date(host.lastSeenAt).getTime();
        if (Number.isNaN(lastSeen)) return false;
        const elapsedMinutes = (Date.now() - lastSeen) / 60_000;
        return elapsedMinutes >= (minutes as number);
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
        return this.evaluateLowDisk(rule, target);

      case 'low_memory':
        return this.evaluateLowMemory(rule, target);

      default:
        return false;
    }
  }

  private async fetchHardware(target: LogmeinAlarmTarget): Promise<LogmeinHardwareInventory | null> {
    if (this.hardwareInventoryService === null) return null;
    const hostId = Number(target.hostId);
    if (!Number.isInteger(hostId) || hostId <= 0) return null;
    try {
      const inventory = await this.hardwareInventoryService.fetchHardwareInventoryForHosts([hostId]);
      return inventory.get(hostId) ?? null;
    } catch (error: unknown) {
      logger.warn(
        {
          host_id: target.hostId,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        '[logmein_alarm][engine] Inventário de hardware indisponível para condição.',
      );
      return null;
    }
  }

  private async evaluateLowDisk(rule: LogmeinAlarmRule, target: LogmeinAlarmTarget): Promise<boolean> {
    const hardware = await this.fetchHardware(target);
    if (hardware === null) return false;
    const payload = rule.conditionPayload as Record<string, unknown>;
    const freePercentThreshold = numberInRange(payload.free_percent_threshold, 1, 100, 20);
    const freeGbThreshold = optionalPositiveNumber(payload.free_space_gb_threshold);
    const selector = typeof payload.partition_selector === 'string' ? payload.partition_selector.trim().toLowerCase() : '';

    return hardware.partitions.some((partition) => {
      const totalMb = partition.totalSizeMb;
      const freeMb = partition.freeSpaceMb;
      if (totalMb == null || freeMb == null || totalMb <= 0) return false;
      const label = `${partition.drive ?? ''} ${partition.name ?? ''}`.toLowerCase();
      if (selector !== '' && !label.includes(selector)) return false;
      const freePercent = (freeMb / totalMb) * 100;
      const percentHit = freePercent <= freePercentThreshold;
      const gbHit = freeGbThreshold !== null && freeMb / 1024 <= freeGbThreshold;
      return percentHit || gbHit;
    });
  }

  private async evaluateLowMemory(rule: LogmeinAlarmRule, target: LogmeinAlarmTarget): Promise<boolean> {
    const hardware = await this.fetchHardware(target);
    if (hardware === null || hardware.memoryMb == null) return false;
    const minGb = optionalPositiveNumber((rule.conditionPayload as Record<string, unknown>).min_total_memory_gb) ?? 8;
    return hardware.memoryMb / 1024 < minGb;
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
 * event_hash = sha256(rule_id || host_id || alarm_type || dedup_key || payload_hash)
 * Granularidade: check-in alarms por regra/host/tipo/dia (UTC); demais por janela curta.
 */
export function buildEventHash(
  ruleId: string,
  hostId: string,
  alarmType: string,
  dedupKey: string,
  payloadHash = '',
): string {
  return createHash('sha256')
    .update(`${ruleId}|${hostId}|${alarmType}|${dedupKey}|${payloadHash}`)
    .digest('hex');
}

export function buildDedupWindowKey(alarmType: string, now = new Date()): string {
  if (DAILY_DEDUP_ALARM_TYPES.has(alarmType)) {
    return now.toISOString().slice(0, 10);
  }
  return String(Math.floor(now.getTime() / NON_DAILY_DEDUP_WINDOW_MS));
}

export function buildAlarmPayloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256')
    .update(stableJson(payload))
    .digest('hex');
}

function isCheckinDerivedAlarmType(alarmType: string): boolean {
  return CHECKIN_DERIVED_ALARM_TYPES.has(alarmType);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function resolveTicketEntity(rule: LogmeinAlarmRule, host: LogmeinHostContext): number {
  const hostEntity = host.glpiEntityCandidateId ?? null;
  return Number.isInteger(hostEntity) && hostEntity !== null && hostEntity > 0
    ? hostEntity
    : rule.glpiEntitiesId;
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function optionalPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
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
