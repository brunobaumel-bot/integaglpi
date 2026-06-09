/**
 * LogmeinRuleTestService — F2B_4
 *
 * Pure simulation: evaluates an alarm rule condition in memory against a
 * provided host context and optional hardware inventory.
 *
 * Invariants (F2B contract — ABSOLUTE):
 *   - simulatedOnly: true — always.
 *   - createTicket: false — literal type, immutable.
 *   - whatsAppSent: false — literal type, immutable.
 *   - stateModified: false — literal type, immutable.
 *   - NO persistence to alarm_events table.
 *   - NO ticket creation.
 *   - NO WhatsApp send.
 *   - NO remote LogMeIn session.
 *   - NO MariaDB (GLPI) access.
 *   - NO schema change.
 *   - conditionPayload validated in memory; invalid payload → data_unavailable.
 *
 * Phase: integaglpi_v9_logmein_operations_001 — F2B_4
 */

import type { LogmeinAlarmRule } from '../../repositories/postgres/PostgresLogmeinAlarmRepository.js';
import type { LogmeinHostContext } from './LogmeinReadonlyContextService.js';
import type { LogmeinHardwareInventory } from './LogmeinHardwareInventoryService.js';
import { LogmeinLowDiskCheckService } from './LogmeinLowDiskCheckService.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TestResultOutcome = 'fired' | 'suppressed' | 'data_unavailable';

export interface RuleTestResult {
  /** Always true — no persistence, no side effects. */
  readonly simulatedOnly: true;
  /** Always false — immutable F2B invariant. */
  readonly createTicket: false;
  /** Always false — immutable F2B invariant. */
  readonly whatsAppSent: false;
  /** Always false — immutable F2B invariant. */
  readonly stateModified: false;
  outcome: TestResultOutcome;
  /** Whether the alarm condition evaluated to true. Null if data unavailable. */
  conditionMet: boolean | null;
  /** Human-readable explanation of the outcome. */
  reason: string;
  evaluatedAt: string;
  ruleId: string;
  alarmType: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinRuleTestService {
  private readonly lowDiskService: LogmeinLowDiskCheckService;

  public constructor(defaultLowDiskThresholdPercent = 10) {
    this.lowDiskService = new LogmeinLowDiskCheckService(defaultLowDiskThresholdPercent);
  }

  /**
   * Simulate rule evaluation in memory.
   *
   * @param rule     The alarm rule to evaluate.
   * @param host     Current host context (from asset_cache).
   * @param hardware Hardware inventory or null when not available.
   */
  public evaluate(
    rule: LogmeinAlarmRule,
    host: LogmeinHostContext,
    hardware: LogmeinHardwareInventory | null,
  ): RuleTestResult {
    const base = {
      simulatedOnly: true as const,
      createTicket: false as const,
      whatsAppSent: false as const,
      stateModified: false as const,
      evaluatedAt: new Date().toISOString(),
      ruleId: rule.id,
      alarmType: rule.alarmType,
    };

    // Rule disabled → always suppressed.
    if (!rule.enabled) {
      return {
        ...base,
        outcome: 'suppressed',
        conditionMet: null,
        reason: 'Regra desabilitada (enabled=false). Condição não avaliada.',
      };
    }

    switch (rule.alarmType) {
      case 'host_offline':
        return this.evaluateHostOffline(base, host);

      case 'host_not_seen':
        return this.evaluateHostNotSeen(base, rule, host);

      case 'missing_equipment_tag':
        return this.evaluateMissingTag(base, host);

      case 'missing_entity_mapping':
        return this.evaluateMissingEntity(base, host);

      case 'low_disk':
        return this.evaluateLowDisk(base, rule, host, hardware);

      case 'low_memory':
        return this.evaluateLowMemory(base, rule, hardware);

      case 'hardware_change':
        return {
          ...base,
          outcome: 'data_unavailable',
          conditionMet: null,
          reason:
            'hardware_change requer comparação com snapshot anterior — não disponível em simulação estática.',
        };

      default:
        return {
          ...base,
          outcome: 'data_unavailable',
          conditionMet: null,
          reason: `Tipo de alarme desconhecido: ${String(rule.alarmType)}.`,
        };
    }
  }

  // ── Private evaluators ────────────────────────────────────────────────────

  private evaluateHostOffline(
    base: Omit<RuleTestResult, 'outcome' | 'conditionMet' | 'reason'>,
    host: LogmeinHostContext,
  ): RuleTestResult {
    if (host.status === 'unknown') {
      return {
        ...base,
        outcome: 'data_unavailable',
        conditionMet: null,
        reason: 'Status do host desconhecido (cache pode estar desatualizado).',
      };
    }
    const conditionMet = host.status === 'offline';
    return {
      ...base,
      outcome: conditionMet ? 'fired' : 'suppressed',
      conditionMet,
      reason: conditionMet
        ? `Host está offline (status='offline').`
        : `Host está online (status='${host.status}').`,
    };
  }

  private evaluateHostNotSeen(
    base: Omit<RuleTestResult, 'outcome' | 'conditionMet' | 'reason'>,
    rule: LogmeinAlarmRule,
    host: LogmeinHostContext,
  ): RuleTestResult {
    const thresholdMinutes =
      typeof rule.conditionPayload.not_seen_minutes === 'number'
        ? rule.conditionPayload.not_seen_minutes
        : null;

    if (thresholdMinutes === null) {
      return {
        ...base,
        outcome: 'data_unavailable',
        conditionMet: null,
        reason: 'conditionPayload.not_seen_minutes não configurado na regra.',
      };
    }

    if (host.lastSeenAt === null) {
      return {
        ...base,
        outcome: 'data_unavailable',
        conditionMet: null,
        reason: 'Host nunca registrado no cache (lastSeenAt=null).',
      };
    }

    const lastSeenMs = new Date(host.lastSeenAt).getTime();
    if (isNaN(lastSeenMs)) {
      return {
        ...base,
        outcome: 'data_unavailable',
        conditionMet: null,
        reason: 'Formato de lastSeenAt inválido no cache.',
      };
    }

    const minutesAgo = (Date.now() - lastSeenMs) / 60_000;
    const conditionMet = minutesAgo >= thresholdMinutes;
    return {
      ...base,
      outcome: conditionMet ? 'fired' : 'suppressed',
      conditionMet,
      reason: conditionMet
        ? `Host não visto há ${Math.round(minutesAgo)} min (limiar: ${thresholdMinutes} min).`
        : `Host visto há ${Math.round(minutesAgo)} min — dentro do limiar de ${thresholdMinutes} min.`,
    };
  }

  private evaluateMissingTag(
    base: Omit<RuleTestResult, 'outcome' | 'conditionMet' | 'reason'>,
    host: LogmeinHostContext,
  ): RuleTestResult {
    const conditionMet = host.equipmentTag === '' || host.equipmentTag == null;
    return {
      ...base,
      outcome: conditionMet ? 'fired' : 'suppressed',
      conditionMet,
      reason: conditionMet
        ? 'Tag de patrimônio ausente ou vazia.'
        : `Tag de patrimônio presente: ${host.equipmentTag}.`,
    };
  }

  private evaluateMissingEntity(
    base: Omit<RuleTestResult, 'outcome' | 'conditionMet' | 'reason'>,
    host: LogmeinHostContext,
  ): RuleTestResult {
    const conditionMet = host.glpiEntityCandidateId === null;
    return {
      ...base,
      outcome: conditionMet ? 'fired' : 'suppressed',
      conditionMet,
      reason: conditionMet
        ? 'Host sem entidade GLPI mapeada (glpi_entity_candidate_id=null).'
        : `Host com entidade GLPI mapeada (id=${host.glpiEntityCandidateId}).`,
    };
  }

  private evaluateLowDisk(
    base: Omit<RuleTestResult, 'outcome' | 'conditionMet' | 'reason'>,
    rule: LogmeinAlarmRule,
    host: LogmeinHostContext,
    hardware: LogmeinHardwareInventory | null,
  ): RuleTestResult {
    const thresholdPercent =
      typeof rule.conditionPayload.free_percent_threshold === 'number'
        ? rule.conditionPayload.free_percent_threshold
        : undefined;

    const svc = thresholdPercent !== undefined
      ? new LogmeinLowDiskCheckService(thresholdPercent)
      : this.lowDiskService;

    const result = svc.check(host.externalId, hardware);

    if (result.status === 'data_unavailable') {
      return {
        ...base,
        outcome: 'data_unavailable',
        conditionMet: null,
        reason: result.message,
      };
    }

    const conditionMet = result.status === 'alert';
    return {
      ...base,
      outcome: conditionMet ? 'fired' : 'suppressed',
      conditionMet,
      reason: result.message,
    };
  }

  private evaluateLowMemory(
    base: Omit<RuleTestResult, 'outcome' | 'conditionMet' | 'reason'>,
    rule: LogmeinAlarmRule,
    hardware: LogmeinHardwareInventory | null,
  ): RuleTestResult {
    if (hardware === null || hardware.memoryMb === null) {
      return {
        ...base,
        outcome: 'data_unavailable',
        conditionMet: null,
        reason:
          'Dados de memória não disponíveis. LOGMEIN_HARDWARE_INVENTORY_ENABLED pode estar desabilitado.',
      };
    }

    const thresholdMb =
      typeof rule.conditionPayload.free_memory_mb_threshold === 'number'
        ? rule.conditionPayload.free_memory_mb_threshold
        : null;

    if (thresholdMb === null) {
      return {
        ...base,
        outcome: 'data_unavailable',
        conditionMet: null,
        reason: 'conditionPayload.free_memory_mb_threshold não configurado na regra.',
      };
    }

    // hardware.memoryMb is total physical memory — threshold comparison is
    // illustrative (free memory is not tracked in this version).
    const conditionMet = hardware.memoryMb < thresholdMb;
    return {
      ...base,
      outcome: conditionMet ? 'fired' : 'suppressed',
      conditionMet,
      reason: conditionMet
        ? `Memória total ${hardware.memoryMb} MB abaixo do limiar ${thresholdMb} MB.`
        : `Memória total ${hardware.memoryMb} MB acima do limiar ${thresholdMb} MB.`,
    };
  }
}
