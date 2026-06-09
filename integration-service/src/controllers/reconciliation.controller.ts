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

import type { LogmeinAssetMatchingService } from '../domain/services/LogmeinAssetMatchingService.js';
import type { PostgresLogmeinReadonlyRepository } from '../repositories/postgres/PostgresLogmeinReadonlyRepository.js';

// ── Controller deps ──────────────────────────────────────────────────────────

export interface ReconciliationControllerDeps {
  matchingService: LogmeinAssetMatchingService;
  readonlyRepository: PostgresLogmeinReadonlyRepository;
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
