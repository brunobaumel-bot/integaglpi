/**
 * LogmeinHardwareInventoryService
 *
 * Fetches hardware inventory data from the LogMeIn Central v1 API:
 *   GET  /public-api/v1/inventory/hardware/fields   – list available fields
 *   POST /public-api/v1/inventory/hardware/reports  – create async report
 *   GET  /public-api/v1/inventory/hardware/reports/{token} – fetch result
 *
 * Design rules:
 *  - All calls are read-only (GET / passive POST report).
 *  - Respects 1-call/min rate limit + retryDelay from 429 responses.
 *  - Returns null for every field not present in the API response.
 *  - Never fills placeholders ("N/A", "unknown", 0).
 *  - No direct MariaDB access.
 *  - Failures never block the WhatsApp webhook.
 *
 * Feature flags (both default false):
 *   LOGMEIN_HARDWARE_INVENTORY_ENABLED  – enables the adapter
 *   LOGMEIN_SYNC_LOCAL_IP               – includes local IP in the PHP bridge payload
 */

import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { GlpiComputerHardwarePayload } from '../../adapters/glpi/glpiTypes.js';
import type { LogmeinDisplayInfo, LogmeinHardwareDryRun, LogmeinPartitionInfo } from '../../adapters/glpi/glpiTypes.js';
import { logger } from '../../infra/logger/logger.js';
import type { LogmeinReadonlyConfig } from './LogmeinReadonlyContextService.js';
import type { LogmeinFieldMappingService } from './LogmeinFieldMappingService.js';

const BASE_V1 = 'https://secure.logmein.com/public-api/v1';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 10_000;
const RATE_LIMIT_FALLBACK_DELAY_MS = 62_000;

// ── Normalised hardware model ────────────────────────────────────────────────

export interface LogmeinDrive {
  name: string | null;
  capacityMb: number | null;
  serialNumber: string | null;
  mediaType: string | null;
  diskType: string | null;
}

export interface LogmeinNetworkConnection {
  name: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  defaultGateway: string | null;
  dhcpServer: string | null;
  primaryDns: string | null;
  primaryWins: string | null;
  secondaryDns: string | null;
  secondaryWins: string | null;
  subnetMask: string | null;
}

export interface LogmeinProcessor {
  type: string | null;
  numberOfCores: number | null;
  numberOfProcessors: number | null;
  speedMhz: number | null;
}

export interface LogmeinHardwareInventory {
  hostId: number;
  serviceTag: string | null;
  manufacturer: string | null;
  model: string | null;
  memoryMb: number | null;
  memoryModules: number | null;
  batteryName: string | null;
  motherboardChipset: string | null;
  motherboardMemorySlots: number | null;
  primaryScreenResolution: string | null;
  processors: LogmeinProcessor[];
  drives: LogmeinDrive[];
  displays: LogmeinDisplayInfo[];
  partitions: LogmeinPartitionInfo[];
  networkConnections: LogmeinNetworkConnection[];
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function safeString(value: unknown, max = 240): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return s === '' ? null : s.slice(0, max);
}

function safePositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/**
 * Sums memory sizes from the LM API memories array.
 * LM v1 reports API returns memories as Array<{size:number,...}>, not a single object.
 * Returns null when no memory data is available.
 */
function sumMemoryMb(memories: unknown): number | null {
  if (!Array.isArray(memories) || memories.length === 0) return null;
  const total = (memories as Record<string, unknown>[]).reduce(
    (sum, m) => sum + (safePositiveInt(m.size) ?? 0),
    0,
  );
  return total > 0 ? total : null;
}

function memoryModuleCount(memories: unknown): number | null {
  if (!Array.isArray(memories) || memories.length === 0) return null;
  return memories.length;
}

function parseProcessor(raw: Record<string, unknown>): LogmeinProcessor {
  return {
    type: safeString(raw.type, 200),
    numberOfCores: safePositiveInt(raw.numberOfCores),
    numberOfProcessors: safePositiveInt(raw.numberOfProcessors),
    speedMhz: safePositiveInt(raw.speed),
  };
}

function parseDrive(raw: Record<string, unknown>): LogmeinDrive {
  return {
    name: safeString(raw.name, 200),
    capacityMb: safePositiveInt(raw.capacity),
    serialNumber: safeString(raw.serialNumber, 80),
    mediaType: safeString(raw.mediaType, 80),
    diskType: safeString(raw.diskType, 80),
  };
}

function parseNetworkConnection(raw: Record<string, unknown>): LogmeinNetworkConnection {
  // IP is kept for mapping purposes but MUST be handled as sensitive data by callers.
  return {
    name: safeString(raw.name, 200),
    macAddress: safeString(raw.macAddress, 20),
    ipAddress: safeString(raw.ipAddress, 45),
    defaultGateway: safeString(raw.defaultGateway, 45),
    dhcpServer: safeString(raw.dhcpServer, 45),
    primaryDns: safeString(raw.primaryDns ?? raw.primaryDNS, 45),
    primaryWins: safeString(raw.primaryWins ?? raw.primaryWINS, 45),
    secondaryDns: safeString(raw.secondaryDns ?? raw.secondaryDNS, 45),
    secondaryWins: safeString(raw.secondaryWins ?? raw.secondaryWINS, 45),
    subnetMask: safeString(raw.subnetMask, 45),
  };
}

function parseDisplay(raw: Record<string, unknown>): LogmeinDisplayInfo {
  return {
    date: safeString(raw.date, 80),
    provider: safeString(raw.provider, 120),
    type: safeString(raw.type, 120),
    version: safeString(raw.version, 120),
  };
}

function parsePartition(raw: Record<string, unknown>): LogmeinPartitionInfo {
  return {
    drive: safeString(raw.drive, 80),
    fileSystem: safeString(raw.fileSystem, 80),
    freeSpaceMb: safePositiveInt(raw.freeSpace),
    name: safeString(raw.name, 120),
    raid: safeString(raw.raid, 80),
    raidFailingDiskNumber: safePositiveInt(raw.raidFailingDiskNumber),
    raidStatus: safeString(raw.raidStatus, 80),
    totalSizeMb: safePositiveInt(raw.totalSize),
  };
}

function selectFirstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (Array.isArray(value)) {
      const first = value[0];
      if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
        return first as Record<string, unknown>;
      }
    }
  }

  return {};
}

function normalizeHostInventory(hostId: number, data: Record<string, unknown>): LogmeinHardwareInventory {
  const hw = (data.hardwareInfo ?? {}) as Record<string, unknown>;
  const processors = Array.isArray(data.processors)
    ? (data.processors as Record<string, unknown>[]).map(parseProcessor)
    : [];
  const drives = Array.isArray(data.drives)
    ? (data.drives as Record<string, unknown>[]).map(parseDrive)
    : [];
  const nets = Array.isArray(data.networkConnections)
    ? (data.networkConnections as Record<string, unknown>[]).map(parseNetworkConnection)
    : [];
  const displays = Array.isArray(data.displays)
    ? (data.displays as Record<string, unknown>[]).map(parseDisplay)
    : [];
  const partitions = Array.isArray(data.partitions)
    ? (data.partitions as Record<string, unknown>[]).map(parsePartition)
    : [];
  const batteries = Array.isArray(data.batteries) ? data.batteries as Record<string, unknown>[] : [];
  const motherboard = selectFirstRecord(data.motherboard, data.motherboards, data.motherboardInfo);
  // LM v1 reports API returns memories as Array<{size:number,...}> — sum all modules.
  const memMb = sumMemoryMb(data.memories);

  return {
    hostId,
    serviceTag: safeString(data.serviceTag ?? hw.assetTag, 80),
    manufacturer: safeString(hw.manufacturer, 120),
    model: safeString(hw.model, 120),
    memoryMb: memMb,
    memoryModules: memoryModuleCount(data.memories),
    batteryName: safeString(batteries[0]?.name, 120),
    motherboardChipset: safeString(motherboard.chipset, 160),
    motherboardMemorySlots: safePositiveInt(motherboard.memorySlots),
    primaryScreenResolution: safeString(data.primaryScreenResolution, 80),
    processors,
    drives,
    displays,
    partitions,
    networkConnections: nets,
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

export class LogmeinHardwareInventoryService {
  private readonly config: LogmeinReadonlyConfig;
  private readonly timeoutMs: number;

  public constructor(
    config: LogmeinReadonlyConfig,
    private readonly fieldMappingService?: LogmeinFieldMappingService,
  ) {
    this.config = config;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * High-level method: fetch hardware inventory for a host and enrich the
   * corresponding GLPI Computer via the PHP bridge.
   * Graceful: never throws; returns {ok: false} on any error.
   */
  public async enrichGlpiComputerFromLogmein(input: {
    logmeinHostId: number;
    glpiComputerId: number;
    glpiClient: GlpiClient;
    pluginBaseUrl: string;
    apiKey: string;
    syncLocalIp?: boolean;
  }): Promise<{ ok: boolean; status: string }> {
    try {
      const inventory = await this.fetchHardwareInventoryForHosts([input.logmeinHostId]);
      const hw = inventory.get(input.logmeinHostId);
      if (!hw) {
        return { ok: false, status: 'no_hardware_data' };
      }

      const payload = await this.toGlpiHardwarePayload(hw, input.syncLocalIp === true);

      const result = await input.glpiClient.syncComputerHardware(
        input.glpiComputerId,
        payload,
        { pluginBaseUrl: input.pluginBaseUrl, apiKey: input.apiKey },
      );

      return { ok: result.ok, status: result.ok ? 'enriched' : (result.error ?? 'bridge_error') };
    } catch (error: unknown) {
      logger.warn(
        {
          logmein_host_id: input.logmeinHostId,
          glpi_computer_id: input.glpiComputerId,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[logmein][hw_enrich] Unexpected error in enrichGlpiComputerFromLogmein',
      );
      return { ok: false, status: 'unexpected_error' };
    }
  }

  /**
   * Builds the GLPI bridge payload from normalised LogMeIn inventory and applies
   * field-mapping governance when configured.
   */
  public async toGlpiHardwarePayload(
    hw: LogmeinHardwareInventory,
    syncLocalIp: boolean,
  ): Promise<GlpiComputerHardwarePayload> {
    let payload: GlpiComputerHardwarePayload = {
      service_tag: hw.serviceTag ?? undefined,
      manufacturer: hw.manufacturer ?? undefined,
      model: hw.model ?? undefined,
      memory_mb: hw.memoryMb ?? undefined,
      processors: hw.processors.map((p) => ({
        type: p.type,
        number_of_cores: p.numberOfCores,
        number_of_processors: p.numberOfProcessors,
        speed_mhz: p.speedMhz,
      })),
      drives: hw.drives.map((d) => ({
        name: d.name,
        capacity_mb: d.capacityMb,
        serial_number: d.serialNumber,
      })),
      // IP only when explicitly allowed — MAC is hardware metadata, not PII.
      network_connections: hw.networkConnections.map((n) => ({
        name: n.name,
        mac_address: n.macAddress,
        ip_address: syncLocalIp === true ? n.ipAddress : undefined,
      })),
    };

    // Apply field mapping governance if available.
    if (this.fieldMappingService) {
      payload = await this.fieldMappingService.filterPayloadByMappings(payload, syncLocalIp);
    }

    return payload;
  }

  /**
   * Dry-run preview: returns what would be synced for this host/computer pair
   * without modifying GLPI. Requires fieldMappingService to be provided.
   * Graceful: returns a report with all fields 'would_skip' when not configured.
   */
  public async dryRunHardwareSync(input: {
    logmeinHostId: number;
    glpiComputerId: number;
    syncLocalIp: boolean;
    currentGlpiValues?: Record<string, string | null>;
  }): Promise<LogmeinHardwareDryRun> {
    const inventory = await this.fetchHardwareInventoryForHosts([input.logmeinHostId]);
    const hw = inventory.get(input.logmeinHostId);

    const emptyResult: LogmeinHardwareDryRun = {
      logmeinHostId: input.logmeinHostId,
      glpiComputerId: input.glpiComputerId,
      fields: [],
      wouldUpdate: 0,
      wouldSkip: 0,
      blockedByPolicy: 0,
      fieldUnavailable: 1,
      blockedForbidden: 0,
      dryRunOnly: true,
    };

    if (!hw) return emptyResult;
    if (!this.fieldMappingService) {
      logger.warn('[logmein][hw_dry_run] No fieldMappingService — dry-run returns empty result');
      return emptyResult;
    }

    return this.fieldMappingService.dryRun({
      logmeinHostId: input.logmeinHostId,
      glpiComputerId: input.glpiComputerId,
      inventory: hw,
      syncLocalIp: input.syncLocalIp,
      currentGlpiValues: input.currentGlpiValues,
    });
  }

  /** Lists all available hardware inventory fields from the API. */
  public async fetchAvailableFields(): Promise<string[]> {
    const response = await this.get('/inventory/hardware/fields');
    if (!response.ok) {
      logger.warn({ status: response.status }, '[logmein][hw_fields] Fields endpoint unavailable');
      return [];
    }
    const body = await response.json() as unknown;
    if (!Array.isArray(body)) return [];
    return (body as unknown[]).filter((f): f is string => typeof f === 'string');
  }

  /**
   * Fetches full hardware inventory for a batch of host IDs.
   * Respects rate limit, retries on 429, polls until ready.
   * Returns null entries for hosts with no data rather than throwing.
   */
  public async fetchHardwareInventoryForHosts(
    hostIds: number[],
    fields?: string[],
  ): Promise<Map<number, LogmeinHardwareInventory | null>> {
    if (hostIds.length === 0) return new Map();

    const token = await this.createReport(hostIds, fields);
    if (token === null) return new Map(hostIds.map((id) => [id, null]));

    const result = await this.pollReport(token);
    if (result === null) return new Map(hostIds.map((id) => [id, null]));

    const out = new Map<number, LogmeinHardwareInventory | null>();
    for (const hostId of hostIds) {
      const raw = (result as Record<string, Record<string, unknown>>)[String(hostId)];
      out.set(hostId, raw ? normalizeHostInventory(hostId, raw) : null);
    }
    return out;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async createReport(hostIds: number[], fields?: string[]): Promise<string | null> {
    const body: Record<string, unknown> = { hostIds };
    if (fields && fields.length > 0) body.fields = fields;

    let response = await this.post('/inventory/hardware/reports', body);
    if (response.status === 429) {
      const delay = await this.extractRetryDelay(response);
      logger.warn({ delay_ms: delay }, '[logmein][hw_report] Rate limited — waiting');
      await sleep(delay);
      response = await this.post('/inventory/hardware/reports', body);
    }

    // Handle invalid hostIds: LM API returns HTTP 400 with the offending IDs.
    // Filter them out and retry once with only the valid subset.
    // Invalid hosts map to null in the result — batch continues gracefully.
    if (response.status === 400) {
      const errData = (await this.safeJson(response)) as Record<string, unknown>;
      const invalidIds = Array.isArray(errData.hostIds)
        ? (errData.hostIds as unknown[]).filter((id): id is number => typeof id === 'number')
        : [];
      if (invalidIds.length > 0 && invalidIds.length < hostIds.length) {
        logger.warn(
          { invalid_count: invalidIds.length, total: hostIds.length },
          '[logmein][hw_report] SKIP_INVALID_LOGMEIN_HOST — invalid hostIds filtered, retrying',
        );
        const validIds = hostIds.filter((id) => !invalidIds.includes(id));
        response = await this.post('/inventory/hardware/reports', { ...body, hostIds: validIds });
      }
    }

    if (!response.ok) {
      logger.warn({ status: response.status }, '[logmein][hw_report] Report creation failed');
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    const token = typeof data.token === 'string' ? data.token.trim() : null;
    if (!token) {
      logger.warn('[logmein][hw_report] No token in report creation response');
      return null;
    }
    return token;
  }

  private async pollReport(token: string): Promise<Record<string, unknown> | null> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const response = await this.get(`/inventory/hardware/reports/${token}`);

      if (response.status === 404) {
        logger.warn({ attempt }, '[logmein][hw_poll] Report not ready / expired');
        continue;
      }
      if (response.status === 429) {
        const delay = await this.extractRetryDelay(response);
        logger.warn({ delay_ms: delay, attempt }, '[logmein][hw_poll] Rate limited');
        await sleep(delay);
        continue;
      }
      if (!response.ok) {
        logger.warn({ status: response.status, attempt }, '[logmein][hw_poll] Unexpected error');
        return null;
      }

      const data = await response.json() as Record<string, unknown>;
      const hosts = data.hosts as Record<string, unknown> | undefined;
      if (hosts && Object.keys(hosts).length > 0) {
        return hosts;
      }
    }

    logger.warn({ attempts: MAX_POLL_ATTEMPTS }, '[logmein][hw_poll] Max poll attempts reached');
    return null;
  }

  private basicAuthHeader(): string {
    const { companyId = '', psk = '' } = this.config;
    return `Basic ${Buffer.from(`${companyId}:${psk}`).toString('base64')}`;
  }

  private async get(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${BASE_V1}${path}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: this.basicAuthHeader() },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${BASE_V1}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: this.basicAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async extractRetryDelay(response: Response): Promise<number> {
    try {
      const data = await response.json() as Record<string, unknown>;
      const delay = Number(data.retryDelay);
      if (Number.isFinite(delay) && delay > 0) {
        return Math.min(delay * 1_000 + 2_000, RATE_LIMIT_FALLBACK_DELAY_MS);
      }
    } catch { /* ignore */ }
    return RATE_LIMIT_FALLBACK_DELAY_MS;
  }

  /** Safely parse JSON from a response without throwing on malformed body. */
  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
