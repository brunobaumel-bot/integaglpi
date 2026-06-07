import type { Request, Response } from 'express';

import type { LogmeinFieldMappingService } from '../domain/services/LogmeinFieldMappingService.js';
import type { LogmeinOverwritePolicy } from '../adapters/glpi/glpiTypes.js';
import { LOGMEIN_FORBIDDEN_FIELDS } from '../domain/services/LogmeinFieldMappingService.js';
import { logger } from '../infra/logger/logger.js';

const VALID_POLICIES = new Set<LogmeinOverwritePolicy>([
  'never_overwrite_manual',
  'overwrite_only_logmein_origin',
  'always_update',
]);

/** GET /internal/logmein/field-mappings — list all mappings. */
export function createLogmeinFieldMappingListController(service: LogmeinFieldMappingService) {
  return async (_req: Request, res: Response): Promise<Response> => {
    try {
      const mappings = await service.listMappings();
      return res.status(200).json({
        ok: true,
        mappings,
        forbidden_fields: [...LOGMEIN_FORBIDDEN_FIELDS],
        auto_ticket: false,
        alarm_engine: false,
        read_only: false,
      });
    } catch (error: unknown) {
      logger.error(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping_list] unexpected error',
      );
      return res.status(500).json({ ok: false, status: 'error' });
    }
  };
}

/** PATCH /internal/logmein/field-mappings/:id — toggle is_active. */
export function createLogmeinFieldMappingToggleController(service: LogmeinFieldMappingService) {
  return async (req: Request, res: Response): Promise<Response> => {
    try {
      const id = parseInt(req.params.id ?? '', 10);
      const isActive = req.body?.is_active;
      if (!Number.isFinite(id) || id <= 0 || typeof isActive !== 'boolean') {
        return res.status(400).json({ ok: false, status: 'invalid_input' });
      }
      const updated = await service.setMappingActive(id, isActive);
      if (!updated) return res.status(404).json({ ok: false, status: 'not_found' });
      return res.status(200).json({ ok: true, mapping: updated });
    } catch (error: unknown) {
      logger.error(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping_toggle] unexpected error',
      );
      return res.status(500).json({ ok: false, status: 'error' });
    }
  };
}

/** PATCH /internal/logmein/field-mappings/:id/policy — update overwrite policy. */
export function createLogmeinFieldMappingPolicyController(service: LogmeinFieldMappingService) {
  return async (req: Request, res: Response): Promise<Response> => {
    try {
      const id = parseInt(req.params.id ?? '', 10);
      const policy = req.body?.overwrite_policy as string | undefined;
      if (!Number.isFinite(id) || id <= 0 || !policy || !VALID_POLICIES.has(policy as LogmeinOverwritePolicy)) {
        return res.status(400).json({ ok: false, status: 'invalid_input' });
      }
      const updated = await service.setMappingPolicy(id, policy as LogmeinOverwritePolicy);
      if (!updated) return res.status(404).json({ ok: false, status: 'not_found' });
      return res.status(200).json({ ok: true, mapping: updated });
    } catch (error: unknown) {
      logger.error(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping_policy] unexpected error',
      );
      return res.status(500).json({ ok: false, status: 'error' });
    }
  };
}

/**
 * POST /internal/logmein/field-mappings/dry-run
 * Body: { logmein_host_id, glpi_computer_id, sync_local_ip?, current_glpi_values? }
 *
 * Returns a per-field preview of what would be synced.
 * NEVER modifies GLPI. auto_ticket is always false.
 */
export function createLogmeinFieldMappingDryRunController(
  service: LogmeinFieldMappingService,
) {
  return async (req: Request, res: Response): Promise<Response> => {
    try {
      const logmeinHostId = parseInt(req.body?.logmein_host_id ?? '', 10);
      const glpiComputerId = parseInt(req.body?.glpi_computer_id ?? '', 10);
      if (!Number.isFinite(logmeinHostId) || !Number.isFinite(glpiComputerId)) {
        return res.status(400).json({ ok: false, status: 'invalid_input' });
      }
      const syncLocalIp = Boolean(req.body?.sync_local_ip === true);
      const currentGlpiValues =
        typeof req.body?.current_glpi_values === 'object' && req.body.current_glpi_values !== null
          ? (req.body.current_glpi_values as Record<string, string | null>)
          : {};

      // The dry-run requires hardware data; the service must be injected with a hardware service.
      // For now, return a mapping-only dry-run (without live LM data fetch) using the mapping definitions.
      const mappings = await service.listActiveMappings();
      const fields = mappings.map((m) => ({
        logmeinFieldKey: m.logmeinFieldKey,
        glpiTargetType: m.glpiTargetType,
        glpiTargetField: m.glpiTargetField,
        overwritePolicy: m.overwritePolicy,
        status: service.isFieldForbidden(m.logmeinFieldKey)
          ? 'blocked_pii'
          : (currentGlpiValues[m.glpiTargetField] !== undefined && currentGlpiValues[m.glpiTargetField] !== null
              ? (m.overwritePolicy === 'never_overwrite_manual' ? 'blocked_by_policy' : 'would_update')
              : 'field_unavailable') as string,
        currentGlpiValue: currentGlpiValues[m.glpiTargetField] ?? null,
        proposedValue: null as string | null,
      }));

      const wouldUpdate = fields.filter((f) => f.status === 'would_update').length;
      const blockedByPolicy = fields.filter((f) => f.status === 'blocked_by_policy').length;

      return res.status(200).json({
        ok: true,
        logmein_host_id: logmeinHostId,
        glpi_computer_id: glpiComputerId,
        dry_run_only: true,
        auto_ticket: false,
        alarm_engine: false,
        fields,
        summary: {
          would_update: wouldUpdate,
          blocked_by_policy: blockedByPolicy,
          field_unavailable: fields.filter((f) => f.status === 'field_unavailable').length,
          blocked_pii: fields.filter((f) => f.status === 'blocked_pii').length,
        },
      });
    } catch (error: unknown) {
      logger.error(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping_dry_run] unexpected error',
      );
      return res.status(500).json({ ok: false, status: 'error' });
    }
  };
}
