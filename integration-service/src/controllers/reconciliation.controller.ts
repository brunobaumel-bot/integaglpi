/**
 * Reconciliation Controller — F6 Inventário / Conciliação GLPI ↔ LogMeIn
 *
 * Três endpoints read-only para o painel de conciliação de ativos:
 *   GET  /internal/glpi/logmein/operations/inventory/matching-report
 *   GET  /internal/glpi/logmein/operations/inventory/coverage-gaps
 *   POST /internal/glpi/logmein/operations/inventory/preview
 *
 * Invariantes absolutas F6:
 *   - read_only: true
 *   - real_mutation_forbidden: true
 *   - create_ticket: false
 *   - whatsAppSent: false
 *   - stateModified: false (preview apenas)
 *   - INVENTORY_RECONCILIATION_ENABLED=false por default
 *   - Nenhum raw error exposto na resposta
 *   - Nenhum PII (sem MAC, IP, username, token)
 *   - LLM não é fonte de verdade: scoring é determinístico
 *   - Sem acesso ao MariaDB GLPI via Node
 *
 * Phase: integaglpi_v9_inventory_reconciliation_001 — F6
 */

import type { Request, Response } from 'express';

import { env } from '../config/env.js';
import type { GlpiClient } from '../adapters/glpi/GlpiClient.js';
import type { GlpiComputerAssetCandidate, GlpiComputerHardwarePayload } from '../adapters/glpi/glpiTypes.js';
import type { LogmeinAssetMatchingService } from '../domain/services/LogmeinAssetMatchingService.js';
import type { LogmeinHardwareInventory, LogmeinHardwareInventoryService } from '../domain/services/LogmeinHardwareInventoryService.js';
import type { PostgresLogmeinReadonlyRepository } from '../repositories/postgres/PostgresLogmeinReadonlyRepository.js';

// ── Controller deps ──────────────────────────────────────────────────────────

export interface ReconciliationControllerDeps {
  matchingService: LogmeinAssetMatchingService;
  readonlyRepository: PostgresLogmeinReadonlyRepository;
  hardwareInventoryService?: LogmeinHardwareInventoryService;
  glpiClient?: GlpiClient;
  integrationServiceApiKey?: string;
}

type CachedHost = Awaited<ReturnType<PostgresLogmeinReadonlyRepository['listHostsForMatching']>>[number];

interface InventorySyncDiff {
  host_id: string;
  glpi_computer_id: number | null;
  match_source: 'equipment_tag' | 'service_tag' | 'hostname' | 'none';
  action: 'updated' | 'skipped' | 'needs_review' | 'error';
  fields: string[];
  reason: string;
}

interface InventoryRevertPlan {
  host_id: string;
  glpi_computer_id: number;
  operation: 'restore_previous_asset_identity';
  previous: {
    name: string | null;
    serial: string | null;
    otherserial: string | null;
    entities_id: number | null;
  };
  auto_executed: false;
}

function toPositiveHostId(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.trunc(parsed) : fallback, max));
}

function readRequestedHostIds(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids = new Set<string>();
  for (const item of value) {
    const text = String(item ?? '').trim();
    if (/^[0-9]+$/.test(text)) {
      ids.add(text);
    }
  }
  return ids.size > 0 ? ids : null;
}

function compactFields(payload: GlpiComputerHardwarePayload): string[] {
  const fields: string[] = [];
  if (payload.service_tag !== undefined) fields.push('service_tag');
  if (payload.manufacturer !== undefined) fields.push('manufacturer');
  if (payload.model !== undefined) fields.push('model');
  if (payload.memory_mb !== undefined) fields.push('memory_mb');
  if ((payload.processors ?? []).length > 0) fields.push('processors');
  if ((payload.drives ?? []).length > 0) fields.push('drives');
  if ((payload.network_connections ?? []).length > 0) fields.push('network_connections');
  return fields;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

async function findBestComputerMatch(
  glpiClient: GlpiClient,
  host: CachedHost,
  hw: LogmeinHardwareInventory,
): Promise<{ candidate: GlpiComputerAssetCandidate | null; source: InventorySyncDiff['match_source']; reason: string }> {
  const equipmentTag = String(host.equipmentTag ?? '').trim();
  if (equipmentTag !== '') {
    const byTag = await glpiClient.findComputersByOtherserial(equipmentTag, 5);
    if (byTag.length === 1) {
      return { candidate: byTag[0] ?? null, source: 'equipment_tag', reason: 'matched_by_equipment_tag' };
    }
    if (byTag.length > 1) {
      return { candidate: null, source: 'none', reason: 'ambiguous_equipment_tag' };
    }
  }

  const serviceTag = String(hw.serviceTag ?? '').trim();
  if (serviceTag !== '') {
    const byServiceTag = await glpiClient.findComputersByOtherserial(serviceTag, 5);
    if (byServiceTag.length === 1) {
      return { candidate: byServiceTag[0] ?? null, source: 'service_tag', reason: 'matched_by_service_tag' };
    }
    if (byServiceTag.length > 1) {
      return { candidate: null, source: 'none', reason: 'ambiguous_service_tag' };
    }
  }

  const hostName = String(host.hostName ?? '').trim();
  if (hostName !== '') {
    const byName = await glpiClient.findComputersByName(hostName, 5);
    if (byName.length === 1) {
      return { candidate: byName[0] ?? null, source: 'hostname', reason: 'matched_by_hostname' };
    }
    if (byName.length > 1) {
      return { candidate: null, source: 'none', reason: 'ambiguous_hostname' };
    }
  }

  return { candidate: null, source: 'none', reason: 'no_safe_match' };
}

function isSerialConflict(candidate: GlpiComputerAssetCandidate, hw: LogmeinHardwareInventory): boolean {
  const currentSerial = String(candidate.serial ?? '').trim();
  const proposedSerial = String(hw.serviceTag ?? '').trim();
  return currentSerial !== '' && proposedSerial !== '' && !sameText(currentSerial, proposedSerial);
}

// ── 1. Matching report ────────────────────────────────────────────────────────

/**
 * GET /internal/glpi/logmein/operations/inventory/matching-report
 *
 * Query params:
 *   limit?  [1..2000]  default: 500  — max hosts to evaluate
 *   offset? [0..]      default: 0
 *
 * Returns: F6 MatchReport (with candidates, by_status, invariants).
 */
export function createReconciliationMatchingReportController(
  deps: ReconciliationControllerDeps,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res): Promise<void> => {
    try {
      const q = req.query as Record<string, unknown>;
      const limit = Math.max(1, Math.min(Number(q['limit']) || 500, 2000));
      const offset = Math.max(0, Number(q['offset']) || 0);

      // Load data from PostgreSQL (read-only).
      const [hosts, groupEntityRows] = await Promise.all([
        deps.readonlyRepository.listHostsForMatching(limit, offset),
        deps.readonlyRepository.listGroupEntityMaps(),
      ]);

      // Build in-memory Map for scoring (deterministic, no LLM).
      const groupEntityMap = new Map<string, number>(
        groupEntityRows.map((r) => [r.groupExternalId, r.entityId]),
      );

      // Run matching (pure in-memory, no mutation).
      const report = deps.matchingService.buildReport(hosts, groupEntityMap);

      res.status(200).json({
        ok: true,
        read_only: true,
        report,
      });
    } catch (_err) {
      res.status(500).json({
        ok: false,
        status: 'matching_error',
        message: 'Relatório de conciliação de ativos indisponível.',
        read_only: true,
        create_ticket: false,
        real_mutation_forbidden: true,
      });
    }
  };
}

// ── 2. Coverage gaps ──────────────────────────────────────────────────────────

/**
 * GET /internal/glpi/logmein/operations/inventory/coverage-gaps
 *
 * Returns hosts without valid tag + groups without entity mapping.
 * Re-uses existing coverage methods from the readonly repository.
 *
 * Query params:
 *   limit?  [1..500]  default: 100
 *   offset? [0..]     default: 0
 */
export function createReconciliationCoverageGapsController(
  deps: ReconciliationControllerDeps,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res): Promise<void> => {
    try {
      const q = req.query as Record<string, unknown>;
      const limit = Math.max(1, Math.min(Number(q['limit']) || 100, 500));
      const offset = Math.max(0, Number(q['offset']) || 0);

      const [hostsWithoutTag, groupsWithoutEntity, totalHosts] = await Promise.all([
        deps.readonlyRepository.listHostsWithoutTag(limit, offset),
        deps.readonlyRepository.listGroupsWithoutEntity(limit, offset),
        deps.readonlyRepository.countHostsForMatching(),
      ]);

      res.status(200).json({
        ok: true,
        read_only: true,
        create_ticket: false,
        real_mutation_forbidden: true,
        coverage_gaps: {
          schema_version: '1.0',
          phase: 'integaglpi_v9_inventory_reconciliation_001',
          total_hosts: totalHosts,
          hosts_without_tag: hostsWithoutTag,
          groups_without_entity: groupsWithoutEntity,
          readonly_note:
            'Read-only. Nenhum ativo criado ou alterado. ' +
            'Use o endpoint de preview para simular correções manuais.',
        },
      });
    } catch (_err) {
      res.status(500).json({
        ok: false,
        status: 'coverage_gaps_error',
        message: 'Relatório de lacunas de cobertura indisponível.',
        read_only: true,
        create_ticket: false,
        real_mutation_forbidden: true,
      });
    }
  };
}

// ── 3. Correction preview ─────────────────────────────────────────────────────

/**
 * POST /internal/glpi/logmein/operations/inventory/preview
 *
 * Body:
 *   {
 *     host_id: string;           — LogMeIn external host ID
 *     host_name: string;         — hostname (for display only)
 *     current_tag: string|null;  — current equipment_tag
 *     current_entity_id: number|null;
 *     proposed_entity_id: number;
 *     proposed_entity_source: string;  — e.g. "manual_correction", "group_map"
 *   }
 *
 * Returns: CorrectionPreview (with before/after states, checklist — no mutation).
 */
export function createReconciliationPreviewController(
  deps: ReconciliationControllerDeps,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res): Promise<void> => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const hostId = typeof body['host_id'] === 'string' ? body['host_id'].trim() : '';
      const hostName = typeof body['host_name'] === 'string' ? body['host_name'].trim() : '';
      const currentTag =
        typeof body['current_tag'] === 'string'
          ? body['current_tag'].trim() || null
          : null;
      const currentEntityId =
        body['current_entity_id'] !== null && body['current_entity_id'] !== undefined
          ? Number(body['current_entity_id'])
          : null;
      const proposedEntityId = Number(body['proposed_entity_id']);
      const proposedEntitySource =
        typeof body['proposed_entity_source'] === 'string'
          ? body['proposed_entity_source'].trim()
          : 'manual_correction';

      // Validate required fields.
      if (!hostId || !hostName || !Number.isFinite(proposedEntityId) || proposedEntityId <= 0) {
        res.status(400).json({
          ok: false,
          status: 'invalid_body',
          message:
            'Campos obrigatórios: host_id (string), host_name (string), proposed_entity_id (number > 0).',
          create_ticket: false,
          real_mutation_forbidden: true,
        });
        return;
      }

      // Generate preview (pure in-memory, zero mutation).
      const preview = deps.matchingService.buildPreview(
        hostId,
        hostName,
        currentTag,
        Number.isFinite(currentEntityId) && currentEntityId !== null ? currentEntityId : null,
        proposedEntityId,
        proposedEntitySource,
      );

      res.status(200).json({
        ok: true,
        read_only: true,
        preview,
      });
    } catch (_err) {
      res.status(500).json({
        ok: false,
        status: 'preview_error',
        message: 'Preview de correção indisponível.',
        read_only: true,
        create_ticket: false,
        real_mutation_forbidden: true,
      });
    }
  };
}

// ── 4. One-click inventory sync ──────────────────────────────────────────────

/**
 * POST /internal/glpi/logmein/operations/inventory/sync-now
 *
 * Mutating path guarded by two feature flags:
 *   LOGMEIN_HARDWARE_INVENTORY_ENABLED=true
 *   INVENTORY_RECONCILIATION_ENABLED=true
 *
 * Writes only through GLPI/PHP bridge. Never accesses GLPI MariaDB from Node.
 */
export function createReconciliationSyncNowController(
  deps: ReconciliationControllerDeps,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (!env.LOGMEIN_HARDWARE_INVENTORY_ENABLED || !env.INVENTORY_RECONCILIATION_ENABLED) {
      res.status(409).json({
        ok: false,
        status: 'feature_disabled',
        message: 'Sincronizacao de inventario LogMeIn desabilitada por feature flag.',
        flags: {
          LOGMEIN_HARDWARE_INVENTORY_ENABLED: env.LOGMEIN_HARDWARE_INVENTORY_ENABLED,
          INVENTORY_RECONCILIATION_ENABLED: env.INVENTORY_RECONCILIATION_ENABLED,
        },
        mutated: false,
      });
      return;
    }

    if (!deps.hardwareInventoryService || !deps.glpiClient || !deps.integrationServiceApiKey) {
      res.status(503).json({
        ok: false,
        status: 'sync_not_configured',
        message: 'Sincronizacao de inventario LogMeIn indisponivel.',
        mutated: false,
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const limit = sanitizeLimit(body['limit'], 50, 50);
    const offset = Math.max(0, Number(body['offset']) || 0);
    const requestedHostIds = readRequestedHostIds(body['host_ids']);

    const summary = {
      scanned: 0,
      updated: 0,
      skipped: 0,
      needs_review: 0,
      errors: 0,
    };
    const diffs: InventorySyncDiff[] = [];
    const revertPlan: InventoryRevertPlan[] = [];

    try {
      const cachedHosts = await deps.readonlyRepository.listHostsForMatching(limit, offset);
      const hosts = requestedHostIds
        ? cachedHosts.filter((host) => requestedHostIds.has(host.externalId))
        : cachedHosts;
      const numericHostIds = hosts
        .map((host) => toPositiveHostId(host.externalId))
        .filter((id): id is number => id !== null);

      const inventory = await deps.hardwareInventoryService.fetchHardwareInventoryForHosts(numericHostIds);

      for (const host of hosts) {
        summary.scanned++;
        const numericId = toPositiveHostId(host.externalId);
        if (numericId === null) {
          summary.needs_review++;
          diffs.push({
            host_id: host.externalId,
            glpi_computer_id: null,
            match_source: 'none',
            action: 'needs_review',
            fields: [],
            reason: 'invalid_logmein_host_id',
          });
          continue;
        }

        const hw = inventory.get(numericId) ?? null;
        if (!hw) {
          summary.skipped++;
          diffs.push({
            host_id: host.externalId,
            glpi_computer_id: null,
            match_source: 'none',
            action: 'skipped',
            fields: [],
            reason: 'no_hardware_data',
          });
          continue;
        }

        const match = await findBestComputerMatch(deps.glpiClient, host, hw);
        if (!match.candidate) {
          summary.needs_review++;
          diffs.push({
            host_id: host.externalId,
            glpi_computer_id: null,
            match_source: match.source,
            action: 'needs_review',
            fields: [],
            reason: match.reason,
          });
          continue;
        }

        if (isSerialConflict(match.candidate, hw)) {
          summary.needs_review++;
          diffs.push({
            host_id: host.externalId,
            glpi_computer_id: match.candidate.id,
            match_source: match.source,
            action: 'needs_review',
            fields: ['service_tag'],
            reason: 'serial_conflict_requires_review',
          });
          continue;
        }

        const payload = await deps.hardwareInventoryService.toGlpiHardwarePayload(hw, env.LOGMEIN_SYNC_LOCAL_IP);
        const fields = compactFields(payload);
        if (fields.length === 0) {
          summary.skipped++;
          diffs.push({
            host_id: host.externalId,
            glpi_computer_id: match.candidate.id,
            match_source: match.source,
            action: 'skipped',
            fields: [],
            reason: 'no_mapped_fields_available',
          });
          continue;
        }

        const result = await deps.glpiClient.syncComputerHardware(
          match.candidate.id,
          payload,
          {
            pluginBaseUrl: env.GLPI_API_BASE_URL,
            apiKey: deps.integrationServiceApiKey,
          },
        );

        if (result.ok) {
          summary.updated++;
          diffs.push({
            host_id: host.externalId,
            glpi_computer_id: match.candidate.id,
            match_source: match.source,
            action: 'updated',
            fields,
            reason: match.reason,
          });
          revertPlan.push({
            host_id: host.externalId,
            glpi_computer_id: match.candidate.id,
            operation: 'restore_previous_asset_identity',
            previous: {
              name: match.candidate.name,
              serial: match.candidate.serial,
              otherserial: match.candidate.otherserial,
              entities_id: match.candidate.entitiesId,
            },
            auto_executed: false,
          });
        } else {
          summary.errors++;
          diffs.push({
            host_id: host.externalId,
            glpi_computer_id: match.candidate.id,
            match_source: match.source,
            action: 'error',
            fields,
            reason: 'glpi_bridge_error',
          });
        }
      }

      await deps.readonlyRepository.insertInventorySyncAudit({
        status: summary.errors > 0 ? 'failed' : 'completed',
        summary,
        diffs,
        revertPlan,
        errorMessageSanitized: summary.errors > 0 ? 'one_or_more_assets_failed' : null,
      });

      res.status(summary.errors > 0 ? 207 : 200).json({
        ok: summary.errors === 0,
        status: summary.errors > 0 ? 'partial' : 'completed',
        summary,
        diffs,
        revert_plan: revertPlan,
        revert_auto_executed: false,
        mutated: summary.updated > 0,
        write_path: 'glpi_php_bridge',
      });
    } catch (_err) {
      await deps.readonlyRepository.insertInventorySyncAudit({
        status: 'failed',
        summary,
        diffs,
        revertPlan,
        errorMessageSanitized: 'inventory_sync_failed',
      }).catch(() => undefined);

      res.status(500).json({
        ok: false,
        status: 'inventory_sync_failed',
        message: 'Sincronizacao de inventario LogMeIn indisponivel.',
        summary,
        mutated: summary.updated > 0,
      });
    }
  };
}
