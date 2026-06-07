/**
 * LogmeinAlarmRulesService
 *
 * CRUD de regras de alarme com validações de segurança obrigatórias:
 *   - glpi_entities_id > 0 (entidade raiz/global proibida)
 *   - alarm_type deve ser valor do enum controlado
 *   - cooldown_minutes 1–10080 (1 min a 7 dias)
 *   - condition_payload validado por alarm_type
 *
 * Não envia WhatsApp. Não fecha chamado. Não atribui técnico.
 * Não acessa MariaDB GLPI.
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

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_ALARM_TYPES: readonly AlarmType[] = ['host_offline', 'host_not_seen_minutes'];
const COOLDOWN_MIN = 1;
const COOLDOWN_MAX = 10_080; // 7 days in minutes

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinAlarmRulesService {
  public constructor(
    private readonly repository: PostgresLogmeinAlarmRepository,
  ) {}

  // ── Read ────────────────────────────────────────────────────────────────────

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

  // ── Create ──────────────────────────────────────────────────────────────────

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

  // ── Update ──────────────────────────────────────────────────────────────────

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

  // ── Enable / disable ────────────────────────────────────────────────────────

  public async enableRule(id: string): Promise<UpdateAlarmRuleResult> {
    return this.updateRule(id, { enabled: true });
  }

  public async disableRule(id: string): Promise<UpdateAlarmRuleResult> {
    return this.updateRule(id, { enabled: false });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

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

  // ── Targets ─────────────────────────────────────────────────────────────────

  public async addTarget(ruleId: string, hostId: string, hostname: string): Promise<AddTargetResult> {
    if (!isNonEmptyString(ruleId) || !isNonEmptyString(hostId) || !isNonEmptyString(hostname)) {
      return { ok: false, target: null, error: 'ruleId, hostId e hostname são obrigatórios.' };
    }

    // Verify rule exists before adding target
    const rule = await this.repository.getRuleById(ruleId);
    if (rule == null) {
      return { ok: false, target: null, error: 'Regra não encontrada.' };
    }

    try {
      const target = await this.repository.addTarget(ruleId, hostId, hostname.trim());
      logger.info(
        {
          event_type: 'ALARM_TARGET_ADDED',
          rule_id: ruleId,
          host_id: hostId,
        },
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
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCreateInput(input: CreateAlarmRuleInput): AlarmRuleValidationError[] {
  const errors: AlarmRuleValidationError[] = [];

  if (!isNonEmptyString(input.ruleName)) {
    errors.push({ field: 'ruleName', reason: 'Nome da regra é obrigatório.' });
  }

  if (!VALID_ALARM_TYPES.includes(input.alarmType)) {
    errors.push({ field: 'alarmType', reason: `Tipo deve ser: ${VALID_ALARM_TYPES.join(' | ')}.` });
  }

  if (
    !Number.isInteger(input.cooldownMinutes) ||
    input.cooldownMinutes < COOLDOWN_MIN ||
    input.cooldownMinutes > COOLDOWN_MAX
  ) {
    errors.push({
      field: 'cooldownMinutes',
      reason: `cooldownMinutes deve ser inteiro entre ${COOLDOWN_MIN} e ${COOLDOWN_MAX}.`,
    });
  }

  // glpi_entities_id guard — never 0, never null
  if (!Number.isInteger(input.glpiEntitiesId) || input.glpiEntitiesId <= 0) {
    errors.push({
      field: 'glpiEntitiesId',
      reason: 'glpiEntitiesId deve ser inteiro > 0. Entidade raiz/global (0) proibida.',
    });
  }

  // alarm_type-specific payload validation
  if (input.alarmType === 'host_not_seen_minutes') {
    const minutes = (input.conditionPayload as Record<string, unknown>)['not_seen_minutes'];
    if (!Number.isInteger(minutes) || (minutes as number) < 1) {
      errors.push({
        field: 'conditionPayload.not_seen_minutes',
        reason: 'host_not_seen_minutes requer conditionPayload.not_seen_minutes (inteiro >= 1).',
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

  if (
    input.cooldownMinutes !== undefined &&
    (!Number.isInteger(input.cooldownMinutes) ||
      input.cooldownMinutes < COOLDOWN_MIN ||
      input.cooldownMinutes > COOLDOWN_MAX)
  ) {
    errors.push({
      field: 'cooldownMinutes',
      reason: `cooldownMinutes deve ser inteiro entre ${COOLDOWN_MIN} e ${COOLDOWN_MAX}.`,
    });
  }

  if (
    input.glpiEntitiesId !== undefined &&
    (!Number.isInteger(input.glpiEntitiesId) || input.glpiEntitiesId <= 0)
  ) {
    errors.push({
      field: 'glpiEntitiesId',
      reason: 'glpiEntitiesId deve ser inteiro > 0.',
    });
  }

  if (input.conditionPayload !== undefined) {
    // Validate not_seen_minutes if present in payload
    const payload = input.conditionPayload as Record<string, unknown>;
    if ('not_seen_minutes' in payload) {
      const minutes = payload['not_seen_minutes'];
      if (!Number.isInteger(minutes) || (minutes as number) < 1) {
        errors.push({
          field: 'conditionPayload.not_seen_minutes',
          reason: 'not_seen_minutes deve ser inteiro >= 1.',
        });
      }
    }
  }

  return errors;
}
