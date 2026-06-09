/**
 * logmein.controller.ts — F2B HTTP endpoint factories
 *
 * Five read-only endpoint factories for LogMeIn operations:
 *   1. GET  /internal/glpi/logmein/operations/dashboard
 *   2. GET  /internal/glpi/logmein/operations/alarm-history
 *   3. POST /internal/glpi/logmein/operations/test-rule
 *   4. POST /internal/glpi/logmein/operations/low-disk/dry-run
 *   5. GET  /internal/glpi/logmein/operations/coverage
 *
 * Safety invariants:
 *   - All endpoints are read-only (SELECT / in-memory simulation only).
 *   - No PII exposed: no phone, MAC, IP, user, token, credential.
 *   - No ticket creation, no WhatsApp send, no remote session.
 *   - No MariaDB (GLPI) access.
 *   - No schema change.
 *   - Raw errors NOT forwarded to client (security).
 *   - Input validated and length-capped; SQL parameters never interpolated.
 *
 * Phase: integaglpi_v9_logmein_operations_001 — F2B
 */

import type { Request, Response } from 'express';

import type {
  LogmeinOperationsDashboardService,
} from '../domain/services/LogmeinOperationsDashboardService.js';
import type {
  LogmeinReadonlyContextService,
} from '../domain/services/LogmeinReadonlyContextService.js';
import type {
  PostgresLogmeinAlarmRepository,
} from '../repositories/postgres/PostgresLogmeinAlarmRepository.js';
import type {
  LogmeinRuleTestService,
} from '../domain/services/LogmeinRuleTestService.js';
import type {
  LogmeinLowDiskCheckService,
} from '../domain/services/LogmeinLowDiskCheckService.js';
import type {
  LogmeinCoverageReportService,
} from '../domain/services/LogmeinCoverageReportService.js';
import type {
  LogmeinHostContext,
} from '../domain/services/LogmeinReadonlyContextService.js';
import type {
  LogmeinAlarmRule,
} from '../repositories/postgres/PostgresLogmeinAlarmRepository.js';
import type {
  LogmeinHardwareInventory,
  LogmeinNetworkConnection,
} from '../domain/services/LogmeinHardwareInventoryService.js';
import type {
  LogmeinPartitionInfo,
} from '../adapters/glpi/glpiTypes.js';
import { logger } from '../infra/logger/logger.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeString(v: unknown, max = 200): string | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  return v.trim().slice(0, max);
}

function safeInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ── 1. Dashboard ──────────────────────────────────────────────────────────────

export interface OperationsDashboardControllerDeps {
  dashboardService: LogmeinOperationsDashboardService;
  contextService: LogmeinReadonlyContextService;
}

export function createLogmeinOperationsDashboardController(
  deps: OperationsDashboardControllerDeps,
) {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      const health = await deps.contextService.getHealthSummary();
      const dashboard = await deps.dashboardService.buildDashboard(health);
      res.status(200).json(dashboard);
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[logmein][dashboard] error',
      );
      res.status(500).json({
        ok: false,
        status: 'dashboard_error',
        message: 'Dashboard LogMeIn indisponível.',
      });
    }
  };
}

// ── 2. Alarm history ──────────────────────────────────────────────────────────

export function createLogmeinAlarmHistoryController(
  alarmRepo: PostgresLogmeinAlarmRepository,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, unknown>;

      const periodDays = safeInt(q['period_days'], 1, 90, 30);
      const limit = safeInt(q['limit'], 1, 200, 50);
      const offset = safeInt(q['offset'], 0, 100_000, 0);
      const ruleId = safeString(q['rule_id'], 36);
      const hostId = safeString(q['host_id'], 200);
      const alarmType = safeString(q['alarm_type'], 100);

      const page = await alarmRepo.listAlarmHistory({
        periodDays,
        limit,
        offset,
        ruleId: ruleId ?? undefined,
        hostId: hostId ?? undefined,
        // Safe cast: ListAlarmHistoryFilters.alarmType is AlarmType | null | undefined.
        // The query param is forwarded as-is; the DB rejects invalid enum strings harmlessly.
        alarmType: alarmType as import('../repositories/postgres/PostgresLogmeinAlarmRepository.js').AlarmType ?? undefined,
      });

      res.status(200).json({
        ok: true,
        ...page,
      });
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[logmein][alarm-history] error',
      );
      res.status(500).json({
        ok: false,
        status: 'alarm_history_error',
        message: 'Histórico de alarmes indisponível.',
      });
    }
  };
}

// ── 3. Rule test ──────────────────────────────────────────────────────────────

export function createLogmeinRuleTestController(
  ruleTestService: LogmeinRuleTestService,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Require rule and host in body.
      if (typeof body['rule'] !== 'object' || body['rule'] === null) {
        res.status(400).json({ ok: false, status: 'invalid_body', message: 'Campo "rule" obrigatório.' });
        return;
      }
      if (typeof body['host'] !== 'object' || body['host'] === null) {
        res.status(400).json({ ok: false, status: 'invalid_body', message: 'Campo "host" obrigatório.' });
        return;
      }

      const rawRule = body['rule'] as Record<string, unknown>;
      const rawHost = body['host'] as Record<string, unknown>;
      const rawHardware = (body['hardware'] ?? null) as Record<string, unknown> | null;

      // Minimal validation / normalization of rule.
      const rule: LogmeinAlarmRule = {
        id: safeString(rawRule['id'], 36) ?? 'test',
        ruleName: safeString(rawRule['rule_name'] ?? rawRule['ruleName'], 200) ?? 'test-rule',
        alarmType: safeString(rawRule['alarm_type'] ?? rawRule['alarmType'], 100) as LogmeinAlarmRule['alarmType'] ?? 'host_offline',
        enabled: rawRule['enabled'] !== false,
        cooldownMinutes: safeInt(rawRule['cooldown_minutes'] ?? rawRule['cooldownMinutes'], 0, 10_080, 15),
        conditionPayload:
          typeof rawRule['condition_payload'] === 'object' && rawRule['condition_payload'] !== null
            ? rawRule['condition_payload'] as Record<string, unknown>
            : typeof rawRule['conditionPayload'] === 'object' && rawRule['conditionPayload'] !== null
              ? rawRule['conditionPayload'] as Record<string, unknown>
              : {},
        glpiEntitiesId: safeInt(rawRule['glpi_entities_id'] ?? rawRule['glpiEntitiesId'], 0, 999_999, 0),
        glpiGroupId: rawRule['glpi_group_id'] !== undefined ? safeInt(rawRule['glpi_group_id'], 0, 999_999, 0) : null,
        glpiItilCategoryId: rawRule['glpi_itil_category_id'] !== undefined ? safeInt(rawRule['glpi_itil_category_id'], 0, 999_999, 0) : null,
        createTicket: rawRule['create_ticket'] === true,
        minConsecutiveChecks: safeInt(rawRule['min_consecutive_checks'] ?? rawRule['minConsecutiveChecks'], 1, 100, 1),
        consecutiveCheckIntervalMinutes: safeInt(rawRule['consecutive_check_interval_minutes'] ?? rawRule['consecutiveCheckIntervalMinutes'], 1, 1_440, 5),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Minimal validation / normalization of host.
      const host: LogmeinHostContext = {
        externalId: safeString(rawHost['external_id'] ?? rawHost['externalId'], 200) ?? '',
        groupExternalId: safeString(rawHost['group_external_id'] ?? rawHost['groupExternalId'], 200) ?? '',
        groupName: safeString(rawHost['group_name'] ?? rawHost['groupName'], 200) ?? '',
        hostName: safeString(rawHost['host_name'] ?? rawHost['hostName'], 200) ?? '',
        equipmentTag: safeString(rawHost['equipment_tag'] ?? rawHost['equipmentTag'], 200) ?? '',
        status: rawHost['status'] === 'online' ? 'online' : rawHost['status'] === 'offline' ? 'offline' : 'unknown',
        lastSeenAt: typeof rawHost['last_seen_at'] === 'string' ? rawHost['last_seen_at'] : null,
        glpiEntityCandidateId: rawHost['glpi_entity_candidate_id'] !== undefined ? safeInt(rawHost['glpi_entity_candidate_id'], 0, 999_999, 0) : null,
      };

      // Hardware is optional — null is valid (maps to data_unavailable in evaluators).
      const hardware: LogmeinHardwareInventory | null =
        rawHardware !== null
          ? {
              hostId: safeInt(rawHardware['host_id'] ?? rawHardware['hostId'], 0, Number.MAX_SAFE_INTEGER, 0),
              serviceTag: safeString(rawHardware['service_tag'] ?? rawHardware['serviceTag'], 200),
              manufacturer: safeString(rawHardware['manufacturer'], 200),
              model: safeString(rawHardware['model'], 200),
              memoryMb: typeof rawHardware['memory_mb'] === 'number' ? rawHardware['memory_mb'] : null,
              memoryModules: typeof rawHardware['memory_modules'] === 'number' ? rawHardware['memory_modules'] : null,
              batteryName: safeString(rawHardware['battery_name'] ?? rawHardware['batteryName'], 200),
              motherboardChipset: safeString(rawHardware['motherboard_chipset'] ?? rawHardware['motherboardChipset'], 200),
              motherboardMemorySlots: typeof rawHardware['motherboard_memory_slots'] === 'number' ? rawHardware['motherboard_memory_slots'] : null,
              primaryScreenResolution: safeString(rawHardware['primary_screen_resolution'] ?? rawHardware['primaryScreenResolution'], 100),
              processors: Array.isArray(rawHardware['processors']) ? rawHardware['processors'] as LogmeinHardwareInventory['processors'] : [],
              drives: Array.isArray(rawHardware['drives']) ? rawHardware['drives'] as LogmeinHardwareInventory['drives'] : [],
              displays: Array.isArray(rawHardware['displays']) ? rawHardware['displays'] as LogmeinHardwareInventory['displays'] : [],
              partitions: Array.isArray(rawHardware['partitions']) ? rawHardware['partitions'] as LogmeinPartitionInfo[] : [],
              networkConnections: Array.isArray(rawHardware['network_connections']) ? rawHardware['network_connections'] as LogmeinNetworkConnection[] : [],
            }
          : null;

      const result = ruleTestService.evaluate(rule, host, hardware);

      res.status(200).json({
        ok: true,
        create_ticket: false,
        simulatedOnly: true,
        result,
      });
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[logmein][test-rule] error',
      );
      res.status(500).json({
        ok: false,
        status: 'rule_test_error',
        message: 'Simulação de regra indisponível.',
      });
    }
  };
}

// ── 4. Low disk dry-run ───────────────────────────────────────────────────────

export function createLogmeinLowDiskDryRunController(
  lowDiskService: LogmeinLowDiskCheckService,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (typeof body['hardware'] !== 'object' || body['hardware'] === null) {
        res.status(400).json({ ok: false, status: 'invalid_body', message: 'Campo "hardware" obrigatório.' });
        return;
      }

      const rawHardware = body['hardware'] as Record<string, unknown>;
      const hostId = safeString(body['host_id'] ?? body['hostId'], 200) ?? 'unknown';

      const hardware: LogmeinHardwareInventory = {
        hostId: safeInt(rawHardware['host_id'] ?? rawHardware['hostId'], 0, Number.MAX_SAFE_INTEGER, 0),
        serviceTag: safeString(rawHardware['service_tag'] ?? rawHardware['serviceTag'], 200),
        manufacturer: safeString(rawHardware['manufacturer'], 200),
        model: safeString(rawHardware['model'], 200),
        memoryMb: typeof rawHardware['memory_mb'] === 'number' ? rawHardware['memory_mb'] : null,
        memoryModules: typeof rawHardware['memory_modules'] === 'number' ? rawHardware['memory_modules'] : null,
        batteryName: safeString(rawHardware['battery_name'] ?? rawHardware['batteryName'], 200),
        motherboardChipset: safeString(rawHardware['motherboard_chipset'] ?? rawHardware['motherboardChipset'], 200),
        motherboardMemorySlots: typeof rawHardware['motherboard_memory_slots'] === 'number' ? rawHardware['motherboard_memory_slots'] : null,
        primaryScreenResolution: safeString(rawHardware['primary_screen_resolution'] ?? rawHardware['primaryScreenResolution'], 100),
        processors: Array.isArray(rawHardware['processors']) ? rawHardware['processors'] as LogmeinHardwareInventory['processors'] : [],
        drives: Array.isArray(rawHardware['drives']) ? rawHardware['drives'] as LogmeinHardwareInventory['drives'] : [],
        displays: Array.isArray(rawHardware['displays']) ? rawHardware['displays'] as LogmeinHardwareInventory['displays'] : [],
        partitions: Array.isArray(rawHardware['partitions']) ? rawHardware['partitions'] as LogmeinPartitionInfo[] : [],
        networkConnections: Array.isArray(rawHardware['network_connections']) ? rawHardware['network_connections'] as LogmeinNetworkConnection[] : [],
      };

      const result = lowDiskService.check(hostId, hardware);

      res.status(200).json({
        ok: true,
        result,
      });
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[logmein][low-disk-dry-run] error',
      );
      res.status(500).json({
        ok: false,
        status: 'low_disk_check_error',
        message: 'Verificação de disco indisponível.',
      });
    }
  };
}

// ── 5. Coverage ───────────────────────────────────────────────────────────────

export function createLogmeinCoverageController(
  coverageService: LogmeinCoverageReportService,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query as Record<string, unknown>;
      const limit = safeInt(q['limit'], 1, 200, 50);
      const offset = safeInt(q['offset'], 0, 100_000, 0);

      const report = await coverageService.buildReport({ limit, offset });

      res.status(200).json({
        ok: true,
        report,
      });
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[logmein][coverage] error',
      );
      res.status(500).json({
        ok: false,
        status: 'coverage_error',
        message: 'Relatório de cobertura indisponível.',
      });
    }
  };
}
