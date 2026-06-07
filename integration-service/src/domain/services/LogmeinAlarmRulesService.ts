/**
 * LogmeinAlarmRulesService
 *
 * CRUD de regras de alarme com validações de segurança obrigatórias:
 *
 * Tipos de alarme:
 *   Auto-ticket (gate duplo global + por regra):
 *     host_offline    — min 2 checks consecutivos, cooldown mín. 60 min
 *     host_not_seen   — threshold mín. 7 dias, cooldown mín. 60 min
 *   Alert-only (nunca criam ticket):
 *     missing_equipment_tag, missing_entity_mapping, hardware_change, low_disk, low_memory
 *   Proibidos nesta fase:
 *     high_cpu, disk_health_smart, network_bandwidth, software_compliance
 *
 * Guards obrigatórios:
 *   - glpi_entities_id > 0 (entidade raiz/global proibida)
 *   - create_ticket=true exige glpi_group_id + glpi_itil_category_id (não nulos)
 *   - create_ticket=true em tipos auto-ticket exige cooldown >= 60 min
 *   - create_ticket=true proibido para tipos alert-only
 *   - host_offline: min_consecutive_checks >= 2
 *   - host_not_seen: condition_payload.not_seen_days >= 7
 *
 * Não envia WhatsApp. Não fecha chamado. Não atribui técnico.
 * Não acessa banco de dados do GLPI (apenas PostgreSQL de integração).
 *
 * PHASE: integaglpi_logmein_alarm_rules_and_auto_ticket_implementation_001
 */

import { logger } from '../../infra/logger/logger.js';
import type {
  PostgresLogmeinAlarmRepository,
  LogmeinAlarmRule,
  LogmeinAlarmTarget,
  CreateAlarmRuleInput,
  AlarmType,
} from '../../repositories/postgres/PostgresLogmeinAlarmRepository.js';

// ── Alarm type taxonomy ───────────────────────────────────────────────────────

/** Tipos que podem criar ticket (com gate duplo). */
const AUTO_TICKET_ALARM_TYPES: readonly AlarmType[] = ['host_offline', 'host_not_seen'];

/** Tipos que só geram alertas internos — nunca criam ticket. */
const ALERT_ONLY_ALARM_TYPES: readonly AlarmType[] = [
  'missing_equipment_tag',
  'missing_entity_mapping',
  'hardware_change',
  'low_disk',
  'low_memory',
];

/** Todos os tipos permitidos nesta fase. */
const VALID_ALARM_TYPES: readonly AlarmType[] = [
  ...AUTO_TICKET_ALARM_TYPES,
  ...ALERT_ONLY_ALARM_TYPES,
];

/** Tipos explicitamente proibidos nesta fase. */
const FORBIDDEN_ALARM_TYPES: readonly string[] = [
  'high_cpu',
  'disk_health_smart',
  'network_bandwidth',
  'software_compliance',
];

// ── Limites ───────────────────────────────────────────────────────────────────

const COOLDOWN_MIN_GENERIC = 1;
const COOLDOWN_MIN_AUTO_TICKET = 60; // mínimo 60 min para tipos com create_ticket=true
const COOLDOWN_MAX = 10_080;         // 7 dias
const MIN_NOT_SEEN_DAYS = 7;         // mínimo 7 dias para host_not_seen
const MIN_CONSECUTIVE_CHECKS_FOR_TICKET = 2; // mínimo para host_offline com create_ticket=true
const MIN_CONSECUTIVE_INTERVAL = 5;  // mínimo 5 min entre checks consecutivos

// ── Public result types ───────────────────────────────────────────────────────

export interface AlarmRuleValidationError {
  field: string;
  reason: string;
}

export interface CreateAlarmRuleResult {
  ok: boolean;
  rule: LogmeinAlarmRule | null;
  errors: AlarmRuleValidationError[];
}

export interface UpdateAlarmRuleResult {
  ok: boolean;
  rule: LogmeinAlarmRule | null;
  errors: AlarmRuleValidationError[];
}

export interface AddTargetResult {
  ok: boolean;
  target: LogmeinAlarmTarget | null;
  error: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinAlarmRulesService {
  public constructor(
    private readonly repository: PostgresLogmeinAlarmRepository,
  ) {}

  // ── Read ─────────────────────────────────────────────────────────────────────

  public async listAllRules(): Promise<LogmeinAlarmRule[]> {
    return this.repository.listAllRules();
  }

  public async getRuleById(id: string): Promise<LogmeinAlarmRule | null> {
    if (!isNonEmptyString(id)) return null;
    return this.repository.getRuleById(id);
  }

  public async listTargetsForRule(ruleId: string): Promise<LogmeinAlarmTarget[]> {
    if (!isNonEmptyString(ruleId)) return [];
    return this.repository.listTargetsForRule(ruleId);
  }

  // ── Create ────────────────────────────────────────────────────────────────────

  public async createRule(input: CreateAlarmRuleInput): Promise<CreateAlarmRuleResult> {
    const errors = validateCreateInput(input);
    if (errors.length > 0) {
      logger.warn(
        { event_type: 'ALARM_RULE_CREATE_VALIDATION_ERROR', errors },
        '[logmein_alarm][rules] Validação falhou ao criar regra.',
      );
      return { ok: false, rule: null, errors };
    }

    try {
      const rule = await this.repository.createRule(input);
      logger.info(
        {
          event_type: 'ALARM_RULE_CREATED',
          rule_id: rule.id,
          rule_name: rule.ruleName,
          alarm_type: rule.alarmType,
          glpi_entities_id: rule.glpiEntitiesId,
          create_ticket: rule.createTicket,
        },
        '[logmein_alarm][rules] Regra de alarme criada (enabled=false por padrão).',
      );
      return { ok: true, rule, errors: [] };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { event_type: 'ALARM_RULE_CREATE_ERROR', errorMessage: msg },
        '[logmein_alarm][rules] Erro ao criar regra.',
      );
      return {
        ok: false,
        rule: null,
        errors: [{ field: 'database', reason: 'Erro ao persistir regra. Verifique logs.' }],
      };
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────────

  public async updateRule(
    id: string,
    input: Partial<Omit<CreateAlarmRuleInput, 'alarmType'>> & { enabled?: boolean },
  ): Promise<UpdateAlarmRuleResult> {
    if (!isNonEmptyString(id)) {
      return { ok: false, rule: null, errors: [{ field: 'id', reason: 'ID inválido.' }] };
    }

    const errors = validateUpdateInput(input);
    if (errors.length > 0) {
      return { ok: false, rule: null, errors };
    }

    try {
      const rule = await this.repository.updateRule(id, input);
      if (rule == null) {
        return { ok: false, rule: null, errors: [{ field: 'id', reason: 'Regra não encontrada.' }] };
      }
      logger.info(
        {
          event_type: 'ALARM_RULE_UPDATED',
          rule_id: id,
          changed_fields: Object.keys(input).join(', '),
        },
        '[logmein_alarm][rules] Regra de alarme atualizada.',
      );
      return { ok: true, rule, errors: [] };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { event_type: 'ALARM_RULE_UPDATE_ERROR', errorMessage: msg },
        '[logmein_alarm][rules] Erro ao atualizar regra.',
      );
      return {
        ok: false,
        rule: null,
        errors: [{ field: 'database', reason: 'Erro ao atualizar regra. Verifique logs.' }],
      };
    }
  }

  // ── Enable / disable ──────────────────────────────────────────────────────────

  public async enableRule(id: string): Promise<UpdateAlarmRuleResult> {
    return this.updateRule(id, { enabled: true });
  }

  public async disableRule(id: string): Promise<UpdateAlarmRuleResult> {
    return this.updateRule(id, { enabled: false });
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  public async deleteRule(id: string): Promise<{ ok: boolean; notFound: boolean }> {
    if (!isNonEmptyString(id)) {
      return { ok: false, notFound: false };
    }
    const deleted = await this.repository.deleteRule(id);
    if (deleted) {
      logger.info(
        { event_type: 'ALARM_RULE_DELETED', rule_id: id },
        '[logmein_alarm][rules] Regra de alarme removida (cascade: targets + events).',
      );
    }
    return { ok: deleted, notFound: !deleted };
  }

  // ── Targets ───────────────────────────────────────────────────────────────────

  public async addTarget(ruleId: string, hostId: string, hostname: string): Promise<AddTargetResult> {
    if (!isNonEmptyString(ruleId) || !isNonEmptyString(hostId) || !isNonEmptyString(hostname)) {
      return { ok: false, target: null, error: 'ruleId, hostId e hostname são obrigatórios.' };
    }
    const rule = await this.repository.getRuleById(ruleId);
    if (rule == null) {
      return { ok: false, target: null, error: 'Regra não encontrada.' };
    }
    try {
      const target = await this.repository.addTarget(ruleId, hostId, hostname.trim());
      logger.info(
        { event_type: 'ALARM_TARGET_ADDED', rule_id: ruleId, host_id: hostId },
        '[logmein_alarm][rules] Alvo adicionado à regra.',
      );
      return { ok: true, target, error: null };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { event_type: 'ALARM_TARGET_ADD_ERROR', errorMessage: msg },
        '[logmein_alarm][rules] Erro ao adicionar alvo.',
      );
      return { ok: false, target: null, error: 'Erro ao adicionar alvo. Verifique logs.' };
    }
  }

  public async removeTarget(ruleId: string, hostId: string): Promise<{ ok: boolean }> {
    if (!isNonEmptyString(ruleId) || !isNonEmptyString(hostId)) {
      return { ok: false };
    }
    const removed = await this.repository.removeTarget(ruleId, hostId);
    if (removed) {
      logger.info(
        { event_type: 'ALARM_TARGET_REMOVED', rule_id: ruleId, host_id: hostId },
        '[logmein_alarm][rules] Alvo removido da regra.',
      );
    }
    return { ok: removed };
  }

  // ── Taxonomy helpers (exported for admin UI / tests) ─────────────────────────

  public static isAlertOnly(alarmType: string): boolean {
    return (ALERT_ONLY_ALARM_TYPES as readonly string[]).includes(alarmType);
  }

  public static isAutoTicketCapable(alarmType: string): boolean {
    return (AUTO_TICKET_ALARM_TYPES as readonly string[]).includes(alarmType);
  }

  public static isForbidden(alarmType: string): boolean {
    return FORBIDDEN_ALARM_TYPES.includes(alarmType);
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCreateInput(input: CreateAlarmRuleInput): AlarmRuleValidationError[] {
  const errors: AlarmRuleValidationError[] = [];

  // ── Rule name
  if (!isNonEmptyString(input.ruleName)) {
    errors.push({ field: 'ruleName', reason: 'Nome da regra é obrigatório.' });
  }

  // ── Alarm type — block forbidden first
  if (FORBIDDEN_ALARM_TYPES.includes(input.alarmType)) {
    errors.push({
      field: 'alarmType',
      reason: `Tipo '${input.alarmType}' é proibido nesta fase. Proibidos: ${FORBIDDEN_ALARM_TYPES.join(', ')}.`,
    });
    return errors; // no further validation needed
  }

  if (!(VALID_ALARM_TYPES as readonly string[]).includes(input.alarmType)) {
    errors.push({
      field: 'alarmType',
      reason: `Tipo inválido. Permitidos: ${VALID_ALARM_TYPES.join(' | ')}.`,
    });
  }

  // ── create_ticket blocked for alert-only types
  if (input.createTicket && (ALERT_ONLY_ALARM_TYPES as readonly string[]).includes(input.alarmType)) {
    errors.push({
      field: 'createTicket',
      reason: `Tipo '${input.alarmType}' é alert-only — create_ticket=true não é permitido.`,
    });
  }

  // ── glpi_entities_id guard — never 0, never negative
  if (!Number.isInteger(input.glpiEntitiesId) || input.glpiEntitiesId <= 0) {
    errors.push({
      field: 'glpiEntitiesId',
      reason: 'glpiEntitiesId deve ser inteiro > 0. Entidade raiz/global (0) proibida.',
    });
  }

  // ── When create_ticket=true: category + queue required, min cooldown
  if (input.createTicket) {
    if (input.glpiGroupId === null || input.glpiGroupId === undefined || input.glpiGroupId <= 0) {
      errors.push({
        field: 'glpiGroupId',
        reason: 'glpiGroupId é obrigatório quando create_ticket=true.',
      });
    }
    if (
      input.glpiItilCategoryId === null ||
      input.glpiItilCategoryId === undefined ||
      input.glpiItilCategoryId <= 0
    ) {
      errors.push({
        field: 'glpiItilCategoryId',
        reason: 'glpiItilCategoryId é obrigatório quando create_ticket=true.',
      });
    }
    // Min cooldown 60 min for auto-ticket types
    if ((AUTO_TICKET_ALARM_TYPES as readonly string[]).includes(input.alarmType)) {
      if (
        !Number.isInteger(input.cooldownMinutes) ||
        input.cooldownMinutes < COOLDOWN_MIN_AUTO_TICKET
      ) {
        errors.push({
          field: 'cooldownMinutes',
          reason: `cooldownMinutes mínimo é ${COOLDOWN_MIN_AUTO_TICKET} para tipos auto-ticket com create_ticket=true.`,
        });
      }
    }
  } else {
    // Generic cooldown range
    if (
      !Number.isInteger(input.cooldownMinutes) ||
      input.cooldownMinutes < COOLDOWN_MIN_GENERIC ||
      input.cooldownMinutes > COOLDOWN_MAX
    ) {
      errors.push({
        field: 'cooldownMinutes',
        reason: `cooldownMinutes deve ser inteiro entre ${COOLDOWN_MIN_GENERIC} e ${COOLDOWN_MAX}.`,
      });
    }
  }

  // ── alarm_type-specific payload validation
  if (input.alarmType === 'host_not_seen') {
    const days = (input.conditionPayload as Record<string, unknown>)['not_seen_days'];
    if (!Number.isInteger(days) || (days as number) < MIN_NOT_SEEN_DAYS) {
      errors.push({
        field: 'conditionPayload.not_seen_days',
        reason: `host_not_seen requer conditionPayload.not_seen_days (inteiro >= ${MIN_NOT_SEEN_DAYS}).`,
      });
    }
  }

  // ── host_offline consecutive checks guard
  if (input.alarmType === 'host_offline') {
    const minChecks = input.minConsecutiveChecks ?? 1;
    const minInterval = input.consecutiveCheckIntervalMinutes ?? 5;

    if (input.createTicket && minChecks < MIN_CONSECUTIVE_CHECKS_FOR_TICKET) {
      errors.push({
        field: 'minConsecutiveChecks',
        reason: `host_offline com create_ticket=true requer min_consecutive_checks >= ${MIN_CONSECUTIVE_CHECKS_FOR_TICKET}.`,
      });
    }

    if (!Number.isInteger(minInterval) || minInterval < MIN_CONSECUTIVE_INTERVAL) {
      errors.push({
        field: 'consecutiveCheckIntervalMinutes',
        reason: `consecutiveCheckIntervalMinutes mínimo é ${MIN_CONSECUTIVE_INTERVAL} minutos.`,
      });
    }
  }

  return errors;
}

function validateUpdateInput(
  input: Partial<Omit<CreateAlarmRuleInput, 'alarmType'>> & { enabled?: boolean },
): AlarmRuleValidationError[] {
  const errors: AlarmRuleValidationError[] = [];

  if (input.ruleName !== undefined && !isNonEmptyString(input.ruleName)) {
    errors.push({ field: 'ruleName', reason: 'Nome da regra não pode ser vazio.' });
  }

  if (input.cooldownMinutes !== undefined) {
    if (
      !Number.isInteger(input.cooldownMinutes) ||
      input.cooldownMinutes < COOLDOWN_MIN_GENERIC ||
      input.cooldownMinutes > COOLDOWN_MAX
    ) {
      errors.push({
        field: 'cooldownMinutes',
        reason: `cooldownMinutes deve ser inteiro entre ${COOLDOWN_MIN_GENERIC} e ${COOLDOWN_MAX}.`,
      });
    }
  }

  if (input.glpiEntitiesId !== undefined && (!Number.isInteger(input.glpiEntitiesId) || input.glpiEntitiesId <= 0)) {
    errors.push({ field: 'glpiEntitiesId', reason: 'glpiEntitiesId deve ser inteiro > 0.' });
  }

  if (input.conditionPayload !== undefined) {
    const payload = input.conditionPayload as Record<string, unknown>;
    if ('not_seen_days' in payload) {
      const days = payload['not_seen_days'];
      if (!Number.isInteger(days) || (days as number) < MIN_NOT_SEEN_DAYS) {
        errors.push({
          field: 'conditionPayload.not_seen_days',
          reason: `not_seen_days deve ser inteiro >= ${MIN_NOT_SEEN_DAYS}.`,
        });
      }
    }
  }

  if (input.minConsecutiveChecks !== undefined) {
    const v = input.minConsecutiveChecks;
    if (!Number.isInteger(v) || v < 1 || v > 10) {
      errors.push({ field: 'minConsecutiveChecks', reason: 'minConsecutiveChecks deve ser entre 1 e 10.' });
    }
  }

  if (input.consecutiveCheckIntervalMinutes !== undefined) {
    const v = input.consecutiveCheckIntervalMinutes;
    if (!Number.isInteger(v) || v < MIN_CONSECUTIVE_INTERVAL) {
      errors.push({
        field: 'consecutiveCheckIntervalMinutes',
        reason: `consecutiveCheckIntervalMinutes mínimo é ${MIN_CONSECUTIVE_INTERVAL} minutos.`,
      });
    }
  }

  return errors;
}
