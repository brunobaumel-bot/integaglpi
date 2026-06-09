/**
 * automation.controller.ts — F5 Controlled Automation HTTP endpoints
 *
 * Two endpoint factories:
 *   POST /internal/glpi/automation/advisory
 *   GET  /internal/glpi/automation/matrix
 *
 * Safety invariants (F5 contract — ABSOLUTE):
 *   - real_execution_forbidden: true — response always includes this literal.
 *   - No ticket creation, no WhatsApp send, no remote session.
 *   - No state mutation of any kind.
 *   - Raw errors NOT forwarded to client (security).
 *   - Audit event fired on every advisory request (fire-and-forget).
 *
 * Phase: integaglpi_v9_controlled_automation_001 — F5
 */

import type { Request, Response } from 'express';

import type {
  ControlledAutomationService,
  AutomationActionType,
} from '../domain/services/ControlledAutomationService.js';
import type { AuditService } from '../domain/services/AuditService.js';
import { logger } from '../infra/logger/logger.js';

// ── Valid action types (allowlist for input validation) ─────────────────────

const VALID_ACTION_TYPES = new Set<string>([
  'suppress_alarm_rule',
  'update_equipment_tag',
  'run_disk_check',
  'run_rule_test',
  'generate_coverage_report',
  'restart_logmein_agent',
  'create_maintenance_ticket',
  'send_whatsapp_alert',
]);

// ── 1. Advisory ───────────────────────────────────────────────────────────────

export function createAutomationAdvisoryController(
  automationService: ControlledAutomationService,
  auditService: AuditService,
) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const rawActionType = typeof body['action_type'] === 'string'
        ? body['action_type'].trim().slice(0, 100)
        : null;

      if (rawActionType === null || !VALID_ACTION_TYPES.has(rawActionType)) {
        res.status(400).json({
          ok: false,
          status: 'invalid_action_type',
          message: `action_type inválido. Valores aceitos: ${[...VALID_ACTION_TYPES].join(', ')}.`,
        });
        return;
      }

      const actionType = rawActionType as AutomationActionType;

      // Sanitize signals — no PII, no raw user input beyond basic strings.
      const rawSignals = typeof body['signals'] === 'object' && body['signals'] !== null
        ? body['signals'] as Record<string, unknown>
        : {};

      const signals = {
        alarmType: typeof rawSignals['alarm_type'] === 'string'
          ? rawSignals['alarm_type'].slice(0, 100)
          : null,
        hostId: typeof rawSignals['host_id'] === 'string'
          ? rawSignals['host_id'].slice(0, 200)
          : null,
        ruleId: typeof rawSignals['rule_id'] === 'string'
          ? rawSignals['rule_id'].slice(0, 36)
          : null,
        metadata: null, // Not forwarded to signals — reduce surface area.
      };

      const advisory = automationService.generateAdvisory(actionType, signals);

      // Audit the request (fire-and-forget — never blocks response).
      // Event type: controlled_automation_advisory_requested (no mutation, no execution).
      auditService.recordAuditEventFireAndForget({
        eventType: 'controlled_automation_advisory_requested',
        status: 'success',
        severity: advisory.status === 'blocked' ? 'warning' : 'info',
        source: 'automation.controller',
        payload: {
          actionType,
          actionClass: advisory.actionClass,
          advisoryStatus: advisory.status,
          // No PII, no real identifiers beyond action metadata.
        },
      });

      res.status(200).json({
        ok: advisory.status !== 'blocked',
        ...advisory,
      });
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[automation][advisory] error',
      );
      res.status(500).json({
        ok: false,
        status: 'advisory_error',
        real_execution_forbidden: true,
        message: 'Serviço de automação controlada indisponível.',
      });
    }
  };
}

// ── 2. Action matrix (introspection) ─────────────────────────────────────────

export function createAutomationMatrixController(
  automationService: ControlledAutomationService,
) {
  return (_req: Request, res: Response): void => {
    try {
      const matrix = automationService.getActionMatrix();
      res.status(200).json({
        ok: true,
        real_execution_forbidden: true,
        schema_version: '1.0',
        phase: 'integaglpi_v9_controlled_automation_001',
        matrix,
      });
    } catch (err) {
      logger.error(
        { error_message: err instanceof Error ? err.message : String(err) },
        '[automation][matrix] error',
      );
      res.status(500).json({
        ok: false,
        status: 'matrix_error',
        message: 'Matriz de ações indisponível.',
      });
    }
  };
}
