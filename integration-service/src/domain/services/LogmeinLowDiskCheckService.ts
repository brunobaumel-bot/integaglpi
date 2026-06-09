/**
 * LogmeinLowDiskCheckService — F2B_3
 *
 * Read-only check of disk space for a given host.
 *
 * Returns DATA_UNAVAILABLE when partition data is not populated in the hardware
 * inventory (freeSpaceMb/totalSizeMb null). This is the expected state in HML
 * because LOGMEIN_HARDWARE_INVENTORY_ENABLED=false.
 *
 * Safety invariants (F2B contract — ABSOLUTE):
 *   - create_ticket: false — literal type, immutable. NEVER changes.
 *   - Read-only: zero mutation of any store.
 *   - No new column in DB (freeSpaceMb/totalSizeMb already mapped, not stored).
 *   - No new storage: does NOT amplify ingest of PartitionFreeSpace/TotalSize.
 *   - No invented data: when hardware null → DATA_UNAVAILABLE, not 0 or "ok".
 *   - No remote session start via LogMeIn.
 *   - No WhatsApp send.
 *   - No MariaDB (GLPI) access.
 *
 * Phase: integaglpi_v9_logmein_operations_001 — F2B_3
 */

import type { LogmeinHardwareInventory } from './LogmeinHardwareInventoryService.js';
import type { LogmeinPartitionInfo } from '../../adapters/glpi/glpiTypes.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Status values:
 *   ok              — all partitions above threshold.
 *   alert           — at least one partition below threshold.
 *   data_unavailable — hardware or partition data not populated.
 *
 * data_unavailable is the safe path: callers MUST NOT infer that disk is ok
 * just because no alert was returned.
 */
export type LowDiskStatus = 'ok' | 'alert' | 'data_unavailable';

export interface PartitionCheckResult {
  drive: string;
  totalSizeMb: number | null;
  freeSpaceMb: number | null;
  freePercent: number | null;
  status: 'ok' | 'alert' | 'data_unavailable';
}

export interface LowDiskCheckResult {
  /** Always false — immutable F2B invariant. */
  readonly create_ticket: false;
  /** Always true in this phase — simulation only, no side effects. */
  readonly simulatedOnly: true;
  status: LowDiskStatus;
  partitions: PartitionCheckResult[];
  /** Human-readable explanation for the status. */
  message: string;
  hostId: string;
  /** Threshold used for evaluation (percentage of free space). */
  thresholdPercent: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD_PERCENT = 10;

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinLowDiskCheckService {
  public constructor(
    private readonly thresholdPercent: number = DEFAULT_THRESHOLD_PERCENT,
  ) {}

  /**
   * Evaluate disk space for a host given its hardware inventory.
   *
   * @param hostId    LogMeIn host external ID (for correlation only — not logged with PII).
   * @param hardware  Inventory object or null when not available.
   * @returns         LowDiskCheckResult with create_ticket=false always.
   */
  public check(hostId: string, hardware: LogmeinHardwareInventory | null): LowDiskCheckResult {
    const threshold = Math.max(1, Math.min(this.thresholdPercent, 99));

    // Case 1: hardware not available → DATA_UNAVAILABLE safe path.
    if (hardware === null) {
      return this.makeUnavailable(hostId, threshold, 'hardware_null');
    }

    // Case 2: no partitions in inventory.
    if (hardware.partitions.length === 0) {
      return this.makeUnavailable(hostId, threshold, 'no_partitions');
    }

    // Case 3: evaluate each partition.
    const partitions = hardware.partitions.map((p) => this.checkPartition(p, threshold));

    // If ALL partitions have data_unavailable → aggregate is data_unavailable.
    const allUnavailable = partitions.every((p) => p.status === 'data_unavailable');
    if (allUnavailable) {
      return {
        create_ticket: false,
        simulatedOnly: true,
        status: 'data_unavailable',
        partitions,
        message:
          'Dados de espaço em disco não disponíveis para nenhuma partição. ' +
          'LOGMEIN_HARDWARE_INVENTORY_ENABLED pode estar desabilitado ou dados ainda não sincronizados.',
        hostId,
        thresholdPercent: threshold,
      };
    }

    // Alert if any non-unavailable partition is in alert.
    const anyAlert = partitions.some((p) => p.status === 'alert');

    return {
      create_ticket: false,
      simulatedOnly: true,
      status: anyAlert ? 'alert' : 'ok',
      partitions,
      message: anyAlert
        ? `Alerta: uma ou mais partições com espaço livre abaixo de ${threshold}%.`
        : `OK: todas as partições com espaço livre acima de ${threshold}%.`,
      hostId,
      thresholdPercent: threshold,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private checkPartition(
    partition: LogmeinPartitionInfo,
    thresholdPercent: number,
  ): PartitionCheckResult {
    const drive = partition.drive ?? partition.name ?? '?';
    const totalSizeMb = partition.totalSizeMb;
    const freeSpaceMb = partition.freeSpaceMb;

    // DATA_UNAVAILABLE when either field is null or totalSizeMb is 0.
    if (totalSizeMb === null || freeSpaceMb === null || totalSizeMb === 0) {
      return {
        drive,
        totalSizeMb,
        freeSpaceMb,
        freePercent: null,
        status: 'data_unavailable',
      };
    }

    const freePercent = Math.round((freeSpaceMb / totalSizeMb) * 100);
    return {
      drive,
      totalSizeMb,
      freeSpaceMb,
      freePercent,
      status: freePercent < thresholdPercent ? 'alert' : 'ok',
    };
  }

  private makeUnavailable(
    hostId: string,
    threshold: number,
    reason: string,
  ): LowDiskCheckResult {
    return {
      create_ticket: false,
      simulatedOnly: true,
      status: 'data_unavailable',
      partitions: [],
      message:
        `Dados de disco não disponíveis (${reason}). ` +
        'Verifique se LOGMEIN_HARDWARE_INVENTORY_ENABLED=true e se a sincronização foi executada.',
      hostId,
      thresholdPercent: threshold,
    };
  }
}
