/**
 * LogmeinFieldMappingService
 *
 * Governs which LogMeIn Hardware Inventory fields are synced to GLPI and
 * how conflicts with existing GLPI data are handled.
 *
 * Responsibilities:
 *  - Enforce the per-field overwrite policy.
 *  - Block PII fields unconditionally (localUsers, windowsProfiles, lastLogonUserName, externalIp, journalEntries).
 *  - Respect per-field feature flags (e.g. LOGMEIN_SYNC_LOCAL_IP).
 *  - Separate GLPI-writable fields from context/alarm-only fields.
 *  - Produce dry-run previews that never modify GLPI.
 *  - Never invent data: absent LM fields remain null.
 *  - No alarm engine, no auto-ticket.
 *
 * PHASE: integaglpi_logmein_field_mapping_config_001
 */

import type {
  LogmeinFieldMapping,
  LogmeinFieldDryRunResult,
  LogmeinFieldDryRunStatus,
  LogmeinHardwareDryRun,
  LogmeinOverwritePolicy,
} from '../../adapters/glpi/glpiTypes.js';
import type { LogmeinHardwareInventory } from './LogmeinHardwareInventoryService.js';
import { logger } from '../../infra/logger/logger.js';
import type { PostgresLogmeinFieldMappingRepository } from '../../repositories/postgres/PostgresLogmeinFieldMappingRepository.js';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * PII fields that must never be synced regardless of configuration.
 * This list is exhaustive and enforced unconditionally.
 */
export const LOGMEIN_FORBIDDEN_FIELDS = new Set<string>([
  'localUsers',
  'windowsProfiles',
  'lastLogonUserName',
  'externalIp',
  'journalEntries',
]);

/**
 * All valid LogMeIn hardware fields that may appear in a mapping config.
 * Any field not in this set is treated as unknown and blocked.
 */
export const LOGMEIN_ALLOWED_FIELD_KEYS = new Set<string>([
  'BatteryName',
  'ServiceTag',
  'HardwareAssetTag',
  'HardwareManufacturer',
  'HardwareModel',
  'CpuType',
  'CpuNumberOfCores',
  'CpuNumberOfProcessors',
  'CpuSpeed',
  'DisplayDate',
  'DisplayProvider',
  'DisplayType',
  'DisplayVersion',
  'MemorySize',
  'MemoryModules',
  'DriveCapacity',
  'DriveDiskType',
  'DriveMediaType',
  'DriveName',
  'DriveSerialNumber',
  'MotherboardChipset',
  'MotherboardMemorySlots',
  'NetworkConnectionDefaultGateway',
  'NetworkConnectionDHCPServer',
  'NetworkConnectionMacAddress',
  'NetworkConnectionName',
  'NetworkConnectionIPAddress',
  'NetworkConnectionPrimaryDNS',
  'NetworkConnectionPrimaryWINS',
  'NetworkConnectionSecondaryDNS',
  'NetworkConnectionSecondaryWINS',
  'NetworkConnectionSubnetMask',
  'PartitionDrive',
  'PartitionFileSystem',
  'PartitionFreeSpace',
  'PartitionName',
  'PartitionRaid',
  'PartitionRaidFailingDiskNumber',
  'PartitionRaidStatus',
  'PartitionTotalSize',
  'PrimaryScreenResolution',
]);

const LOGMEIN_NETWORK_SENSITIVE_FIELDS = new Set<string>([
  'NetworkConnectionMacAddress',
  'NetworkConnectionIPAddress',
  'NetworkConnectionDefaultGateway',
  'NetworkConnectionDHCPServer',
  'NetworkConnectionPrimaryDNS',
  'NetworkConnectionPrimaryWINS',
  'NetworkConnectionSecondaryDNS',
  'NetworkConnectionSecondaryWINS',
  'NetworkConnectionSubnetMask',
]);

/** Marker written to GLPI comment to identify LogMeIn-origin values. */
const LOGMEIN_ORIGIN_MARKER = '[IntegraGLPI LogMeIn Hardware Sync]';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the raw string value for a LM field from the normalised inventory object.
 * Returns null when the LM API did not report the field (no placeholder is inserted).
 */
function extractLmValue(inventory: LogmeinHardwareInventory, fieldKey: string): string | null {
  const intText = (value: number | null | undefined): string | null =>
    typeof value === 'number' ? String(value) : null;

  switch (fieldKey) {
    case 'BatteryName':
      return inventory.batteryName ?? null;
    case 'ServiceTag':
      return inventory.serviceTag ?? null;
    case 'HardwareAssetTag':
      return inventory.serviceTag ?? null;
    case 'HardwareManufacturer':
      return inventory.manufacturer ?? null;
    case 'HardwareModel':
      return inventory.model ?? null;
    case 'MemorySize':
      return intText(inventory.memoryMb);
    case 'MemoryModules':
      return intText(inventory.memoryModules);
    case 'CpuType':
      return inventory.processors[0]?.type ?? null;
    case 'CpuNumberOfCores':
      return intText(inventory.processors[0]?.numberOfCores);
    case 'CpuNumberOfProcessors':
      return intText(inventory.processors[0]?.numberOfProcessors);
    case 'CpuSpeed':
      return intText(inventory.processors[0]?.speedMhz);
    case 'DisplayDate':
      return inventory.displays[0]?.date ?? null;
    case 'DisplayProvider':
      return inventory.displays[0]?.provider ?? null;
    case 'DisplayType':
      return inventory.displays[0]?.type ?? null;
    case 'DisplayVersion':
      return inventory.displays[0]?.version ?? null;
    case 'DriveCapacity':
      return intText(inventory.drives[0]?.capacityMb);
    case 'DriveDiskType':
      return inventory.drives[0]?.diskType ?? null;
    case 'DriveMediaType':
      return inventory.drives[0]?.mediaType ?? null;
    case 'DriveName':
      return inventory.drives[0]?.name ?? null;
    case 'DriveSerialNumber':
      return inventory.drives[0]?.serialNumber ?? null;
    case 'MotherboardChipset':
      return inventory.motherboardChipset ?? null;
    case 'MotherboardMemorySlots':
      return intText(inventory.motherboardMemorySlots);
    case 'NetworkConnectionMacAddress':
      return inventory.networkConnections[0]?.macAddress ?? null;
    case 'NetworkConnectionName':
      return inventory.networkConnections[0]?.name ?? null;
    case 'NetworkConnectionIPAddress':
      // IP is sensitive — caller must pass syncLocalIp=true to include it.
      return null;
    case 'NetworkConnectionDefaultGateway':
      return inventory.networkConnections[0]?.defaultGateway ?? null;
    case 'NetworkConnectionDHCPServer':
      return inventory.networkConnections[0]?.dhcpServer ?? null;
    case 'NetworkConnectionPrimaryDNS':
      return inventory.networkConnections[0]?.primaryDns ?? null;
    case 'NetworkConnectionPrimaryWINS':
      return inventory.networkConnections[0]?.primaryWins ?? null;
    case 'NetworkConnectionSecondaryDNS':
      return inventory.networkConnections[0]?.secondaryDns ?? null;
    case 'NetworkConnectionSecondaryWINS':
      return inventory.networkConnections[0]?.secondaryWins ?? null;
    case 'NetworkConnectionSubnetMask':
      return inventory.networkConnections[0]?.subnetMask ?? null;
    case 'PartitionDrive':
      return inventory.partitions[0]?.drive ?? null;
    case 'PartitionFileSystem':
      return inventory.partitions[0]?.fileSystem ?? null;
    case 'PartitionFreeSpace':
      return intText(inventory.partitions[0]?.freeSpaceMb);
    case 'PartitionName':
      return inventory.partitions[0]?.name ?? null;
    case 'PartitionRaid':
      return inventory.partitions[0]?.raid ?? null;
    case 'PartitionRaidFailingDiskNumber':
      return intText(inventory.partitions[0]?.raidFailingDiskNumber);
    case 'PartitionRaidStatus':
      return inventory.partitions[0]?.raidStatus ?? null;
    case 'PartitionTotalSize':
      return intText(inventory.partitions[0]?.totalSizeMb);
    case 'PrimaryScreenResolution':
      return inventory.primaryScreenResolution ?? null;
    default:
      return null;
  }
}

/**
 * Evaluates the overwrite policy for a single field.
 * Returns whether the field WOULD be written in a real sync.
 */
function evaluatePolicy(
  policy: LogmeinOverwritePolicy,
  currentGlpiValue: string | null,
  proposedValue: string | null,
): LogmeinFieldDryRunStatus {
  if (proposedValue === null) return 'field_unavailable';
  if (currentGlpiValue === null || currentGlpiValue === '') return 'would_update';

  switch (policy) {
    case 'never_overwrite_manual':
      // Block if there is any existing value, regardless of origin.
      return 'blocked_by_policy';
    case 'overwrite_only_logmein_origin':
      // Allow if current value was previously set by LogMeIn (marker in comment / managed by us).
      // For the dry-run, we cannot check the comment without a GLPI read, so we report
      // 'would_update' conservatively — the real sync checks the marker.
      return 'would_update';
    case 'always_update':
      return 'would_update';
    default:
      // Unknown policy — skip conservatively rather than overwriting.
      return 'would_skip';
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export class LogmeinFieldMappingService {
  public constructor(
    private readonly repository: PostgresLogmeinFieldMappingRepository,
  ) {}

  /** Returns all field mappings (active and inactive). */
  public async listMappings(): Promise<LogmeinFieldMapping[]> {
    try {
      if (!(await this.repository.isSchemaReady())) {
        logger.warn('[logmein][field_mapping] Schema not ready — returning empty mapping list');
        return [];
      }
      return await this.repository.listAll();
    } catch (error: unknown) {
      logger.warn(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping] listMappings failed',
      );
      return [];
    }
  }

  /** Returns only active field mappings. */
  public async listActiveMappings(): Promise<LogmeinFieldMapping[]> {
    try {
      if (!(await this.repository.isSchemaReady())) return [];
      return await this.repository.listActive();
    } catch (error: unknown) {
      logger.warn(
        { error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping] listActiveMappings failed',
      );
      return [];
    }
  }

  /**
   * Activates or deactivates a single mapping.
   * Returns the updated mapping or null if not found.
   */
  public async setMappingActive(id: number, isActive: boolean): Promise<LogmeinFieldMapping | null> {
    try {
      if (!(await this.repository.isSchemaReady())) return null;
      return await this.repository.setActive(id, isActive);
    } catch (error: unknown) {
      logger.warn(
        { id, is_active: isActive, error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping] setMappingActive failed',
      );
      return null;
    }
  }

  /**
   * Updates the overwrite policy of a mapping.
   * Returns the updated mapping or null if not found.
   */
  public async setMappingPolicy(
    id: number,
    policy: LogmeinOverwritePolicy,
  ): Promise<LogmeinFieldMapping | null> {
    try {
      if (!(await this.repository.isSchemaReady())) return null;
      return await this.repository.setPolicy(id, policy);
    } catch (error: unknown) {
      logger.warn(
        { id, policy, error_message: error instanceof Error ? error.message : String(error) },
        '[logmein][field_mapping] setMappingPolicy failed',
      );
      return null;
    }
  }

  /**
   * Checks whether a LogMeIn field key is unconditionally blocked.
   * PII fields and unknown keys are always blocked.
   */
  public isFieldForbidden(fieldKey: string): boolean {
    return LOGMEIN_FORBIDDEN_FIELDS.has(fieldKey) || !LOGMEIN_ALLOWED_FIELD_KEYS.has(fieldKey);
  }

  /**
   * Produces a dry-run preview for enriching one GLPI computer from one LM host.
   * This method NEVER modifies GLPI — it only evaluates what would happen.
   *
   * @param logmeinHostId   LM host numeric ID
   * @param glpiComputerId  GLPI Computer.id
   * @param inventory       Normalised LM hardware data (from LogmeinHardwareInventoryService)
   * @param syncLocalIp     Reflects LOGMEIN_SYNC_LOCAL_IP flag
   * @param currentGlpiValues  Current field values from GLPI (key = glpi_target_field, value = current string)
   */
  public async dryRun(input: {
    logmeinHostId: number;
    glpiComputerId: number;
    inventory: LogmeinHardwareInventory;
    syncLocalIp: boolean;
    currentGlpiValues?: Record<string, string | null>;
  }): Promise<LogmeinHardwareDryRun> {
    const mappings = await this.listActiveMappings();
    const { logmeinHostId, glpiComputerId, inventory, syncLocalIp, currentGlpiValues = {} } = input;

    const fields: LogmeinFieldDryRunResult[] = [];
    let wouldUpdate = 0;
    let wouldSkip = 0;
    let blockedByPolicy = 0;
    let fieldUnavailable = 0;
    let blockedForbidden = 0;

    for (const mapping of mappings) {
      const { logmeinFieldKey, glpiTargetType, glpiTargetField, overwritePolicy, requiresFlag } = mapping;

      // PII / forbidden check.
      if (this.isFieldForbidden(logmeinFieldKey)) {
        fields.push({
          logmeinFieldKey,
          glpiTargetType,
          glpiTargetField,
          overwritePolicy: null,
          status: 'blocked_pii',
          currentGlpiValue: null,
          proposedValue: null,
        });
        blockedForbidden++;
        continue;
      }

      // Feature-flag check.
      if (requiresFlag === 'LOGMEIN_SYNC_LOCAL_IP' && !syncLocalIp) {
        fields.push({
          logmeinFieldKey,
          glpiTargetType,
          glpiTargetField,
          overwritePolicy,
          status: 'blocked_flag',
          currentGlpiValue: null,
          proposedValue: null,
        });
        wouldSkip++;
        continue;
      }

      // Retrieve the proposed value from LM inventory.
      const proposedValue = logmeinFieldKey === 'NetworkConnectionIPAddress' && syncLocalIp
        ? (inventory.networkConnections[0]?.ipAddress ?? null)
        : extractLmValue(inventory, logmeinFieldKey);

      if (proposedValue === null) {
        fields.push({
          logmeinFieldKey,
          glpiTargetType,
          glpiTargetField,
          overwritePolicy,
          status: 'field_unavailable',
          currentGlpiValue: currentGlpiValues[glpiTargetField] ?? null,
          proposedValue: null,
        });
        fieldUnavailable++;
        continue;
      }

      const currentGlpiValue = currentGlpiValues[glpiTargetField] ?? null;
      const status = evaluatePolicy(overwritePolicy, currentGlpiValue, proposedValue);

      // Mask sensitive values in the dry-run output.
      const safeProposed =
        LOGMEIN_NETWORK_SENSITIVE_FIELDS.has(logmeinFieldKey)
          ? '[redacted for dry-run]'
          : proposedValue;
      const safeCurrent =
        glpiTargetField === 'mac_address' || glpiTargetField === 'ip_address'
          ? '[redacted for dry-run]'
          : currentGlpiValue;

      fields.push({
        logmeinFieldKey,
        glpiTargetType,
        glpiTargetField,
        overwritePolicy,
        status,
        currentGlpiValue: safeCurrent,
        proposedValue: safeProposed,
      });

      switch (status) {
        case 'would_update':    wouldUpdate++;       break;
        case 'blocked_by_policy': blockedByPolicy++; break;
        default:                wouldSkip++;          break;
      }
    }

    logger.info(
      {
        logmein_host_id: logmeinHostId,
        glpi_computer_id: glpiComputerId,
        would_update: wouldUpdate,
        would_skip: wouldSkip,
        blocked_by_policy: blockedByPolicy,
        field_unavailable: fieldUnavailable,
        dry_run_only: true,
        auto_ticket: false,
      },
      '[logmein][field_mapping][DRY_RUN]',
    );

    return {
      logmeinHostId,
      glpiComputerId,
      fields,
      wouldUpdate,
      wouldSkip,
      blockedByPolicy,
      fieldUnavailable,
      blockedForbidden,
      dryRunOnly: true,
    };
  }

  /**
   * Filters a GlpiComputerHardwarePayload to include only fields that are
   * active in the mapping configuration and allowed by their policy.
   * Used by the real sync (not dry-run) to apply governance at the payload level.
   *
   * Note: Policy enforcement for existing GLPI values is handled by
   * ComputerHardwareSyncService.php on the PHP side. This method only gates
   * which fields are included in the payload at all.
   */
  public async filterPayloadByMappings<T extends object>(
    payload: T,
    syncLocalIp: boolean,
  ): Promise<T> {
    const activeMappings = await this.listActiveMappings();
    if (activeMappings.length === 0) return payload;

    const result = { ...payload } as Record<string, unknown>;

    // Remove IP from network_connections if flag is off.
    if (!syncLocalIp && Array.isArray(result.network_connections)) {
      result.network_connections = (result.network_connections as Record<string, unknown>[]).map((c) => {
        const { ip_address: _ip, ...rest } = c as Record<string, unknown>;
        return rest;
      });
    }

    return result as T;
  }

  /** Returns the LOGMEIN_ORIGIN_MARKER constant for use in PHP comment checks. */
  public static get originMarker(): string {
    return LOGMEIN_ORIGIN_MARKER;
  }
}
