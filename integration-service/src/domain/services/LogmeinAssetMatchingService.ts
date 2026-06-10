/**
 * LogmeinAssetMatchingService — F6 Inventário / Conciliação GLPI ↔ LogMeIn
 *
 * Matching determinístico e explicável entre hosts LogMeIn e entidades/ativos GLPI.
 * Scoring fixo, sem LLM como fonte de verdade.
 * Todos os resultados são read-only e de prévia — nenhuma mutação é executada.
 *
 * Scoring rules (priority order):
 *   equipment_tag_exact   : 0.90 → strong_candidate
 *   hostname_plus_entity  : 0.70 → strong_candidate
 *   hostname_only         : 0.40 → weak_candidate
 *   group_plus_entity     : 0.30 → weak_candidate
 *   no_match              : 0.00 → no_match
 *   ambiguous             : override when multiple candidates have score diff < AMBIGUITY_THRESHOLD
 *
 * Safety invariants (F6 contract — ABSOLUTE):
 *   - Read-only: zero INSERT / UPDATE / DELETE / ALTER.
 *   - No PII: no local_ip, mac_address, local_username, token, credential, raw payload.
 *   - No ticket creation.
 *   - No WhatsApp send.
 *   - No remote LogMeIn session.
 *   - No MariaDB (GLPI) access.
 *   - No schema change.
 *   - No LLM as source of truth: scoring is fully deterministic.
 *   - No CMDB complete or real-time inventory: this is a matching report, not an asset registry.
 *   - create_ticket: false — immutable literal.
 *   - real_mutation_forbidden: true — immutable literal.
 *   - INVENTORY_RECONCILIATION_ENABLED=false by default.
 *
 * Phase: integaglpi_v9_inventory_reconciliation_001 — F6
 */

import { env } from '../../config/env.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MatchStatus =
  | 'strong_candidate'
  | 'weak_candidate'
  | 'ambiguous'
  | 'no_match';

export type HostnameQuality = 'corporate' | 'generic' | 'unknown';
export type TagQuality = 'valid' | 'invalid' | 'missing';

export interface MatchSignals {
  /** Host has a non-empty equipment_tag. */
  hasEquipmentTag: boolean;
  /** The equipment_tag passes a format validation heuristic. */
  tagQuality: TagQuality;
  /** Group has an active entity mapping in group_maps. */
  hasEntityMapping: boolean;
  /** Hostname has a corporate-looking pattern (e.g. DESKTOP-CORP, WORKSTATION-*, tag-suffixed). */
  hostnameQuality: HostnameQuality;
  /** Entity ID resolved from group mapping. null if not mapped. */
  entityId: number | null;
  /** Source of the entity ID. */
  entitySource: 'group_map' | 'none';
}

export interface AlternativeCandidate {
  /** External ID of the competing host. */
  hostId: string;
  hostName: string;
  score: number;
  status: MatchStatus;
}

export interface MatchCandidate {
  /** LogMeIn external host ID. */
  hostId: string;
  hostName: string;
  equipmentTag: string | null;
  groupExternalId: string;
  groupName: string;
  /** Best match score [0.0 .. 0.90]. */
  score: number;
  status: MatchStatus;
  /** Human-readable explanation of the score and status. */
  reason: string;
  /** Resolved GLPI entity ID candidate. null when no entity mapping exists. */
  entityId: number | null;
  entitySource: 'group_map' | 'none';
  /** Signals used to compute the score. */
  signals: MatchSignals;
  /** Non-empty only when status === 'ambiguous'. */
  alternatives: AlternativeCandidate[];
  /** Always false — immutable F6 invariant. */
  readonly create_ticket: false;
  /** Always true — no real action executed. */
  readonly real_mutation_forbidden: true;
  /** Always false — no WhatsApp send. */
  readonly whatsAppSent: false;
}

export interface MatchReport {
  schema_version: string;
  phase: string;
  feature_flag_enabled: boolean;
  generated_at: string;
  total_hosts_evaluated: number;
  by_status: Record<MatchStatus, number>;
  candidates: MatchCandidate[];
  /** Always false — immutable invariant. */
  create_ticket: false;
  real_mutation_forbidden: true;
  readonly_note: string;
}

export interface GroupEntityMap {
  groupExternalId: string;
  entityId: number;
  confidenceScore: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Score thresholds (deterministic — must not be changed per request). */
export const SCORE_EQUIPMENT_TAG_EXACT = 0.90;
export const SCORE_HOSTNAME_PLUS_ENTITY = 0.70;
export const SCORE_HOSTNAME_ONLY = 0.40;
export const SCORE_GROUP_PLUS_ENTITY = 0.30;
export const SCORE_NO_MATCH = 0.00;

/** If two candidates for the same entity differ by less than this, declare ambiguous. */
export const AMBIGUITY_THRESHOLD = 0.20;

/**
 * Corporate hostname patterns:
 * - DESKTOP-XXXXXX, NOTEBOOK-XXXXXX, WKS-XXXXXX, PC-XXXXXX, WORKSTATION-XXXXXX
 * - Exactly 4–6 uppercase letters/digits (short device names)
 * - Ends with a 4-digit equipment tag suffix (e.g. DEVICE-1234)
 */
const CORPORATE_HOSTNAME_RE = /^(?:DESKTOP|NOTEBOOK|LAPTOP|WKS|WORKSTATION|PC|SRV|SERVER|CORP|ETI|TI)-\w+$/i;
const CORPORATE_HOSTNAME_SHORT_RE = /^[A-Z][A-Z0-9-]{2,20}$/;
const CORPORATE_HOSTNAME_TAG_SUFFIX_RE = /[_-]\d{4}$/;

/**
 * Forbidden fields for matching (must not appear in output).
 * These are not scored; they are excluded at the signal layer.
 */
const FORBIDDEN_FIELDS = new Set([
  'local_ip', 'mac_address', 'local_username', 'remote_session_token',
  'password', 'token', 'credential', 'psk',
]);

// ── Hostname quality assessment ───────────────────────────────────────────────

/**
 * Classify the hostname quality for scoring purposes.
 * Corporate = likely a managed asset. Generic = default/unset name.
 * No external call; fully deterministic regex matching.
 */
export function assessHostnameQuality(hostname: string): HostnameQuality {
  if (!hostname || hostname.trim() === '') return 'unknown';
  const h = hostname.trim().toUpperCase();

  // Generic patterns: random UUIDs, "localhost", short or all-numeric
  if (/^(LOCALHOST|UNKNOWN|WINDOWS|DESKTOP)$/i.test(h)) return 'generic';
  if (/^\d+$/.test(h)) return 'generic';
  if (h.length < 4) return 'generic';

  if (
    CORPORATE_HOSTNAME_RE.test(hostname)
    || CORPORATE_HOSTNAME_TAG_SUFFIX_RE.test(hostname)
    || (CORPORATE_HOSTNAME_SHORT_RE.test(h) && h.length >= 6 && h.length <= 20)
  ) {
    return 'corporate';
  }

  return 'generic';
}

// ── Tag quality assessment ────────────────────────────────────────────────────

/**
 * Classify equipment_tag quality.
 * valid   = 4-digit numeric tag (standard company format).
 * invalid = non-empty but wrong format.
 * missing = empty or null.
 */
export function assessTagQuality(tag: string | null | undefined): TagQuality {
  if (!tag || tag.trim() === '') return 'missing';
  if (/^\d{4}$/.test(tag.trim())) return 'valid';
  return 'invalid';
}

// ── Score computation (deterministic) ────────────────────────────────────────

/**
 * Compute the raw score and derive the status.
 * Scores are fixed constants — not configurable at runtime.
 * LLM is NOT used.
 *
 * Priority order:
 *   1. equipment_tag_exact (0.90): valid tag + entity mapped
 *   2. hostname_plus_entity (0.70): corporate hostname + entity mapped
 *   3. hostname_only (0.40): corporate hostname, no entity
 *   4. group_plus_entity (0.30): entity mapped, generic hostname
 *   5. no_match (0.00): nothing matched
 */
export function computeScore(signals: MatchSignals): { score: number; baseStatus: MatchStatus } {
  // Rule 1: valid tag + entity mapping
  if (signals.tagQuality === 'valid' && signals.hasEntityMapping) {
    return { score: SCORE_EQUIPMENT_TAG_EXACT, baseStatus: 'strong_candidate' };
  }

  // Rule 2: corporate hostname + entity mapping
  if (signals.hostnameQuality === 'corporate' && signals.hasEntityMapping) {
    return { score: SCORE_HOSTNAME_PLUS_ENTITY, baseStatus: 'strong_candidate' };
  }

  // Rule 3: corporate hostname, no entity (hostname_only — NOT strong, not enough alone)
  if (signals.hostnameQuality === 'corporate' && !signals.hasEntityMapping) {
    return { score: SCORE_HOSTNAME_ONLY, baseStatus: 'weak_candidate' };
  }

  // Rule 4: entity mapping only (generic hostname)
  if (signals.hasEntityMapping && signals.hostnameQuality !== 'corporate') {
    return { score: SCORE_GROUP_PLUS_ENTITY, baseStatus: 'weak_candidate' };
  }

  // Rule 5: no match
  return { score: SCORE_NO_MATCH, baseStatus: 'no_match' };
}

// ── Reason text builder (deterministic) ──────────────────────────────────────

/**
 * Build a human-readable explanation of the match score.
 * Text is deterministic — no LLM.
 * No PII: no IP, MAC, username, token.
 */
export function buildReason(
  signals: MatchSignals,
  score: number,
  status: MatchStatus,
): string {
  const parts: string[] = [];

  if (status === 'ambiguous') {
    parts.push('Ambiguidade detectada: múltiplos candidatos com scores próximos (diferença < 20%).');
  }

  if (signals.tagQuality === 'valid') {
    parts.push(`Tag "${signals.tagQuality === 'valid' ? 'presente e válida' : ''}" — identificador confiável.`);
  } else if (signals.tagQuality === 'invalid') {
    parts.push('Tag presente mas em formato inválido (esperado: 4 dígitos).');
  } else {
    parts.push('Tag ausente.');
  }

  if (signals.hasEntityMapping) {
    parts.push(`Entidade GLPI mapeada via grupo (ID=${signals.entityId ?? 'desconhecido'}).`);
  } else {
    parts.push('Sem mapeamento de entidade GLPI para o grupo.');
  }

  if (signals.hostnameQuality === 'corporate') {
    parts.push('Hostname com padrão corporativo.');
  } else if (signals.hostnameQuality === 'generic') {
    parts.push('Hostname genérico ou não classificado.');
  }

  const scoreLabel = `Score: ${(score * 100).toFixed(0)}%.`;
  parts.push(scoreLabel);

  if (status === 'no_match') {
    parts.push('Nenhuma correspondência confiável encontrada.');
  } else if (status === 'weak_candidate') {
    parts.push('Candidato fraco — requer revisão manual antes de qualquer vínculo.');
  } else if (status === 'strong_candidate') {
    parts.push('Candidato forte — sugerido para revisão e confirmação manual.');
  }

  return parts.filter(Boolean).join(' ');
}

// ── Signal derivation ─────────────────────────────────────────────────────────

export function deriveSignals(
  host: {
    externalId: string;
    hostName: string;
    equipmentTag: string | null;
    groupExternalId: string;
  },
  groupEntityMap: Map<string, number>,
): MatchSignals {
  // Enforce forbidden field exclusion at signal layer.
  const tag = host.equipmentTag;
  // Verify tag doesn't contain forbidden field content (defense in depth).
  if (tag && FORBIDDEN_FIELDS.has(tag.toLowerCase())) {
    throw new Error(`FORBIDDEN_FIELD_IN_TAG: ${host.externalId}`);
  }

  const tagQuality = assessTagQuality(tag);
  const hostnameQuality = assessHostnameQuality(host.hostName);
  const entityId = groupEntityMap.get(host.groupExternalId) ?? null;
  const hasEntityMapping = entityId !== null;

  return {
    hasEquipmentTag: tag !== null && tag !== '',
    tagQuality,
    hasEntityMapping,
    hostnameQuality,
    entityId,
    entitySource: hasEntityMapping ? 'group_map' : 'none',
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinAssetMatchingService {
  /**
   * Match a batch of hosts and produce a report with ambiguity detection.
   *
   * @param hosts          List of hosts from LogMeIn cache.
   * @param groupEntityMap Group external ID → GLPI entity ID mapping.
   */
  public buildReport(
    hosts: Array<{
      externalId: string;
      hostName: string;
      equipmentTag: string | null;
      groupExternalId: string;
      groupName: string;
    }>,
    groupEntityMap: Map<string, number>,
  ): MatchReport {
    const featureFlagEnabled = env.INVENTORY_RECONCILIATION_ENABLED;

    const candidates = this.matchAll(hosts, groupEntityMap);

    const byStatus: Record<MatchStatus, number> = {
      strong_candidate: 0,
      weak_candidate: 0,
      ambiguous: 0,
      no_match: 0,
    };
    for (const c of candidates) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    }

    return {
      schema_version: '1.0',
      phase: 'integaglpi_v9_inventory_reconciliation_001',
      feature_flag_enabled: featureFlagEnabled,
      generated_at: new Date().toISOString(),
      total_hosts_evaluated: hosts.length,
      by_status: byStatus,
      candidates,
      create_ticket: false,
      real_mutation_forbidden: true,
      readonly_note:
        'Relatório read-only. Nenhum ativo criado ou alterado. Nenhuma entidade/tag modificada. ' +
        'Preview apenas — aprovação humana obrigatória antes de qualquer ação manual.',
    };
  }

  /**
   * Generate a preview of what a manual correction would look like.
   * NEVER executes any mutation. No write to DB, no GLPI call.
   *
   * @param hostId         LogMeIn external host ID.
   * @param proposedEntity GLPI entity ID proposed for manual linking.
   * @param currentSignals Current signals for the host.
   */
  public buildPreview(
    hostId: string,
    hostName: string,
    currentTag: string | null,
    currentEntityId: number | null,
    proposedEntityId: number,
    proposedEntitySource: string,
  ): CorrectionPreview {
    const before: PreviewState = {
      hostId,
      hostName,
      equipmentTag: currentTag,
      entityId: currentEntityId,
      entitySource: currentEntityId !== null ? 'group_map' : 'none',
      matchStatus: currentEntityId !== null ? 'weak_candidate' : 'no_match',
    };

    const after: PreviewState = {
      hostId,
      hostName,
      equipmentTag: currentTag,
      entityId: proposedEntityId,
      entitySource: proposedEntitySource,
      matchStatus: currentTag && /^\d{4}$/.test(currentTag) ? 'strong_candidate' : 'weak_candidate',
    };

    const changes: string[] = [];
    if (before.entityId !== after.entityId) {
      changes.push(
        `Entidade: ${before.entityId ?? 'sem mapeamento'} → ${after.entityId} (via ${proposedEntitySource})`,
      );
    }
    if (changes.length === 0) {
      changes.push('Nenhuma alteração identificada — host já tem este mapeamento.');
    }

    return {
      schema_version: '1.0',
      phase: 'integaglpi_v9_inventory_reconciliation_001',
      preview_only: true,
      real_mutation_forbidden: true,
      create_ticket: false,
      whatsAppSent: false,
      stateModified: false,
      hostId,
      before,
      after,
      changes,
      checklist: [
        '[ ] Confirmar que o host pertenece à entidade proposta (verificar no GLPI)',
        '[ ] Confirmar equipment_tag correto antes de vincular',
        '[ ] Atualizar o grupo mapping via painel de conciliação (ação manual)',
        '[ ] Aguardar próximo ciclo de sincronização LogMeIn',
        '[ ] Verificar resultado no relatório de cobertura após sincronização',
      ],
      audit_note: 'Preview gerado via F6. Nenhuma mutação executada.',
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private matchAll(
    hosts: Array<{
      externalId: string;
      hostName: string;
      equipmentTag: string | null;
      groupExternalId: string;
      groupName: string;
    }>,
    groupEntityMap: Map<string, number>,
  ): MatchCandidate[] {
    // First pass: score each host independently.
    const scored = hosts.map((host) => {
      const signals = deriveSignals(host, groupEntityMap);
      const { score, baseStatus } = computeScore(signals);
      return { host, signals, score, baseStatus };
    });

    // Second pass: detect ambiguity within the same entity.
    // Group hosts by entity candidate; flag ambiguous when scores are close.
    const byEntity = new Map<number, typeof scored>();
    for (const item of scored) {
      const entityId = item.signals.entityId;
      if (entityId === null || item.baseStatus === 'no_match') continue;
      const group = byEntity.get(entityId) ?? [];
      group.push(item);
      byEntity.set(entityId, group);
    }

    const ambiguousHostIds = new Set<string>();
    const alternativeMap = new Map<string, AlternativeCandidate[]>();

    for (const [, group] of byEntity) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => b.score - a.score);
      const top = sorted[0]!;
      const second = sorted[1]!;
      if (top.score - second.score < AMBIGUITY_THRESHOLD) {
        // All hosts in this group are ambiguous.
        for (const item of group) {
          ambiguousHostIds.add(item.host.externalId);
          const alts: AlternativeCandidate[] = group
            .filter((g) => g.host.externalId !== item.host.externalId)
            .map((g) => ({
              hostId: g.host.externalId,
              hostName: g.host.hostName,
              score: g.score,
              status: g.baseStatus,
            }));
          alternativeMap.set(item.host.externalId, alts);
        }
      }
    }

    // Build final candidate list.
    return scored.map(({ host, signals, score, baseStatus }) => {
      const isAmbiguous = ambiguousHostIds.has(host.externalId);
      const finalStatus: MatchStatus = isAmbiguous ? 'ambiguous' : baseStatus;
      const reason = buildReason(signals, score, finalStatus);
      const alternatives = alternativeMap.get(host.externalId) ?? [];

      return {
        hostId: host.externalId,
        hostName: host.hostName,
        equipmentTag: host.equipmentTag,
        groupExternalId: host.groupExternalId,
        groupName: host.groupName,
        score,
        status: finalStatus,
        reason,
        entityId: signals.entityId,
        entitySource: signals.entitySource,
        signals,
        alternatives,
        create_ticket: false,
        real_mutation_forbidden: true,
        whatsAppSent: false,
      };
    });
  }
}

// ── Preview types ─────────────────────────────────────────────────────────────

export interface PreviewState {
  hostId: string;
  hostName: string;
  equipmentTag: string | null;
  entityId: number | null;
  entitySource: string;
  matchStatus: MatchStatus;
}

export interface CorrectionPreview {
  schema_version: string;
  phase: string;
  /** Always true — no mutation is executed. */
  preview_only: true;
  /** Always true — immutable F6 invariant. */
  real_mutation_forbidden: true;
  /** Always false — immutable invariant. */
  create_ticket: false;
  /** Always false — immutable invariant. */
  whatsAppSent: false;
  /** Always false — immutable invariant. */
  stateModified: false;
  hostId: string;
  before: PreviewState;
  after: PreviewState;
  changes: string[];
  checklist: string[];
  audit_note: string;
}
