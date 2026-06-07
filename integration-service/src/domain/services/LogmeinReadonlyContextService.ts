import { createHash } from 'node:crypto';

import type { AuditService } from './AuditService.js';

export interface LogmeinReadonlyConfig {
  enabled: boolean;
  baseUrl?: string;
  companyId?: string;
  psk?: string;
  timeoutMs?: number;
}

export interface LogmeinHostContext {
  externalId: string;
  groupExternalId: string;
  groupName: string;
  hostName: string;
  equipmentTag: string;
  glpiEntityCandidateId?: number | null;
  tagQuality?: 'valid' | 'invalid' | 'missing';
  tagSource?: 'custom_field' | 'fallback' | 'none';
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: string | null;
}

export interface LogmeinReadonlyResult {
  ok: boolean;
  status: 'disabled' | 'unconfigured' | 'available' | 'unavailable' | 'migration_required';
  message: string;
  hosts: LogmeinHostContext[];
}

export interface LogmeinSyncResult {
  ok: boolean;
  status: 'disabled' | 'unconfigured' | 'completed' | 'failed' | 'migration_required' | 'sync_in_progress';
  message: string;
  groupsImported: number;
  hostsImported: number;
  endpoint: string;
  /** Wall-clock milliseconds for the completed/failed sync. 0 for early-exit results. */
  durationMs: number;
}

/** Thresholds used to compute alert flags in a health summary. */
export const LOGMEIN_HEALTH_THRESHOLDS = {
  tagCoverageWarningPercent: 85,
  cacheStaleWarningHours: 24,
  cacheStaleCriticalHours: 48,
  consecutiveFailuresWarning: 2,
} as const;

export interface LogmeinHealthSummary {
  ok: boolean;
  status: 'ok' | 'warning' | 'critical' | 'unavailable';
  lastSyncTimestamp: string | null;
  lastSyncStatus: 'completed' | 'failed' | 'never' | null;
  lastSyncDurationMs: number | null;
  groupsImported: number;
  hostsImported: number;
  lastSyncErrorSanitized: string | null;
  totalHosts: number;
  tagsValid: number;
  tagsInvalid: number;
  hostsWithoutTag: number;
  groupsWithoutEntity: number;
  cacheAgeHours: number | null;
  tagCoveragePercent: number | null;
  consecutiveFailures: number;
  alerts: {
    syncFailing: boolean;
    cacheStale: boolean;
    lowTagCoverage: boolean;
    groupsWithoutEntity: boolean;
  };
  thresholds: typeof LOGMEIN_HEALTH_THRESHOLDS;
  readOnly: true;
}

/**
 * Optional lock adapter for cross-process sync exclusion.
 * The implementation (e.g. Redis SET NX PX) is injected; the domain only sees this interface.
 * If not provided the service falls back to the in-process static flag.
 */
export interface LogmeinSyncLockAdapter {
  /** Try ONCE to acquire the lock. Returns true if acquired. Never retries. */
  tryAcquire(): Promise<boolean>;
  /** Release the lock. Best-effort; errors must be swallowed. */
  release(): Promise<void>;
}

export interface LogmeinReadonlyCacheRepository {
  isSchemaReady(): Promise<boolean>;
  upsertHosts(input: {
    groups: Array<{ externalId: string; name: string }>;
    hosts: LogmeinHostContext[];
    sourceSnapshotHash: string;
  }): Promise<{ groupsImported: number; hostsImported: number }>;
  insertSyncAudit(input: {
    status: 'started' | 'completed' | 'failed';
    groupsImported: number;
    hostsImported: number;
    errorMessageSanitized?: string | null;
    durationMs?: number | null;
  }): Promise<void>;
  listHostsByGroup(groupExternalId: string, limit: number): Promise<LogmeinHostContext[]>;
  findHostByEquipmentTag?(equipmentTag: string): Promise<LogmeinHostContext | null>;
  /** Optional — present in PostgresLogmeinReadonlyRepository but mocks may omit it. */
  getHealthSummary?(): Promise<LogmeinHealthSummary>;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_BASE_URL = 'https://secure.logmein.com/public-api/v2';
const HOSTS_WITH_GROUPS_PATH = '/hostswithgroups';

function sanitizeText(value: unknown, max = 160): string {
  return String(value ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/(?:\+?\d[\s().-]*){10,16}/g, '[TELEFONE]')
    .replace(/\b(?:token|secret|bearer|authorization|password|api_key|psk|companyid)\b\s*[:=]\s*["']?[^"',\s}]+["']?/gi, '[SEGREDO_REMOVIDO]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid_url]';
  }
}

function normalizeEndpoint(baseUrl: string | undefined): string {
  const cleanBase = (baseUrl && baseUrl.trim() !== '' ? baseUrl : DEFAULT_BASE_URL).replace(/\/+$/, '');
  return cleanBase.endsWith(HOSTS_WITH_GROUPS_PATH) ? cleanBase : `${cleanBase}${HOSTS_WITH_GROUPS_PATH}`;
}

function selectArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function selectRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }

  return {};
}

function firstText(record: Record<string, unknown>, keys: string[], max = 160): string {
  for (const key of keys) {
    const value = sanitizeText(record[key], max);
    if (value !== '') {
      return value;
    }
  }

  return '';
}

const SYNC_LOCK_KEY = 'logmein_sync';

export class LogmeinReadonlyContextService {
  private static syncInProgress = false;

  public constructor(
    private readonly config: LogmeinReadonlyConfig,
    private readonly auditService?: AuditService,
    private readonly repository?: LogmeinReadonlyCacheRepository,
    private readonly syncLock?: LogmeinSyncLockAdapter,
  ) {}

  public async listHostsByGroup(groupExternalId: string): Promise<LogmeinReadonlyResult> {
    if (!this.config.enabled) {
      return this.fallback('disabled', 'Contexto de ativo temporariamente indisponível.');
    }

    const groupId = sanitizeText(groupExternalId, 120);
    if (groupId === '') {
      return this.fallback('unavailable', 'Contexto de ativo temporariamente indisponível.');
    }

    if (this.repository) {
      if (!await this.repository.isSchemaReady()) {
        return this.fallback('migration_required', 'MIGRATION_042_REQUIRED');
      }
      const hosts = await this.repository.listHostsByGroup(groupId, 20);
      return {
        ok: hosts.length > 0,
        status: hosts.length > 0 ? 'available' : 'unavailable',
        message: hosts.length > 0 ? '' : 'Contexto de ativo temporariamente indisponível.',
        hosts,
      };
    }

    if (!this.hasCredentials()) {
      return this.fallback('unconfigured', 'CONFIG_REQUIRED_FOR_LOGMEIN_CREDENTIALS');
    }

    try {
      const snapshot = await this.fetchHostsWithGroups();
      return {
        ok: true,
        status: 'available',
        message: '',
        hosts: snapshot.hosts.filter((host) => host.groupExternalId === groupId).slice(0, 20),
      };
    } catch (error: unknown) {
      await this.audit('LOGMEIN_SYNC_FAILED', 'failed', {
        error_type: this.errorType(error),
        endpoint: sanitizeUrl(this.endpoint()),
      });

      return this.fallback('unavailable', 'Contexto de ativo temporariamente indisponível.');
    }
  }

  public async syncHostsWithGroups(): Promise<LogmeinSyncResult> {
    const endpoint = sanitizeUrl(this.endpoint());
    if (!this.config.enabled) {
      return this.syncFallback('disabled', 'LOGMEIN_INTEGRATION_DISABLED', endpoint);
    }
    if (!this.hasCredentials()) {
      return this.syncFallback('unconfigured', 'CONFIG_REQUIRED_FOR_LOGMEIN_CREDENTIALS', endpoint);
    }
    if (!this.repository || !await this.repository.isSchemaReady()) {
      return this.syncFallback('migration_required', 'MIGRATION_042_REQUIRED', endpoint);
    }

    // Step 1: Redis cross-process lock (try once, no retry).
    const redisLockAcquired = this.syncLock !== undefined ? await this.syncLock.tryAcquire() : true;
    if (!redisLockAcquired) {
      await this.audit('LOGMEIN_SYNC_CONCURRENCY_BLOCKED', 'failed', {
        endpoint,
        reason: 'redis_lock_busy',
        lock_key: SYNC_LOCK_KEY,
      });
      return this.syncFallback('sync_in_progress', 'LOGMEIN_SYNC_IN_PROGRESS', endpoint);
    }

    // Step 2: In-process static flag guard.
    if (LogmeinReadonlyContextService.syncInProgress) {
      if (this.syncLock && redisLockAcquired) {
        await this.syncLock.release().catch(() => undefined);
      }
      await this.audit('LOGMEIN_SYNC_CONCURRENCY_BLOCKED', 'failed', {
        endpoint,
        reason: 'in_process_flag_set',
        lock_key: SYNC_LOCK_KEY,
      });
      return this.syncFallback('sync_in_progress', 'LOGMEIN_SYNC_IN_PROGRESS', endpoint);
    }

    LogmeinReadonlyContextService.syncInProgress = true;
    const startMs = Date.now();
    await this.repository.insertSyncAudit({ status: 'started', groupsImported: 0, hostsImported: 0 });
    await this.audit('LOGMEIN_SYNC_STARTED', 'success', { endpoint });

    try {
      const snapshot = await this.fetchHostsWithGroups();
      const imported = await this.repository.upsertHosts(snapshot);
      const durationMs = Date.now() - startMs;
      if (snapshot.customFieldsReadCount > 0) {
        await this.audit('LOGMEIN_CUSTOMFIELD_READ', 'success', {
          endpoint,
          custom_fields_read: snapshot.customFieldsReadCount,
          fields_used: ['Etiqueta', 'Patrimônio', 'GLPI_ID', 'Cliente', 'Entidade'],
        });
      }
      await this.repository.insertSyncAudit({
        status: 'completed',
        groupsImported: imported.groupsImported,
        hostsImported: imported.hostsImported,
        durationMs,
      });
      await this.audit('LOGMEIN_SYNC_COMPLETED', 'success', {
        endpoint,
        groups_imported: imported.groupsImported,
        hosts_imported: imported.hostsImported,
        duration_ms: durationMs,
      });

      return {
        ok: true,
        status: 'completed',
        message: '',
        groupsImported: imported.groupsImported,
        hostsImported: imported.hostsImported,
        endpoint,
        durationMs,
      };
    } catch (error: unknown) {
      const durationMs = Date.now() - startMs;
      const errorMessage = sanitizeText(error instanceof Error ? error.message : String(error), 240);
      await this.repository.insertSyncAudit({
        status: 'failed',
        groupsImported: 0,
        hostsImported: 0,
        errorMessageSanitized: errorMessage,
        durationMs,
      });
      await this.audit('LOGMEIN_SYNC_FAILED', 'failed', {
        endpoint,
        error_type: this.errorType(error),
        duration_ms: durationMs,
      });

      return {
        ok: false,
        status: 'failed',
        message: 'Contexto de ativo temporariamente indisponível.',
        groupsImported: 0,
        hostsImported: 0,
        endpoint,
        durationMs,
      };
    } finally {
      LogmeinReadonlyContextService.syncInProgress = false;
      if (this.syncLock && redisLockAcquired) {
        await this.syncLock.release().catch(() => undefined);
      }
    }
  }

  /** Returns a health summary for monitoring/alerting. Never throws. */
  public async getHealthSummary(): Promise<LogmeinHealthSummary> {
    if (!this.config.enabled) {
      return this.buildEmptyHealthSummary('unavailable');
    }
    if (!this.repository?.getHealthSummary) {
      return this.buildEmptyHealthSummary('unavailable');
    }
    try {
      return await this.repository.getHealthSummary();
    } catch {
      return this.buildEmptyHealthSummary('unavailable');
    }
  }

  private buildEmptyHealthSummary(status: LogmeinHealthSummary['status']): LogmeinHealthSummary {
    return {
      ok: status === 'ok',
      status,
      lastSyncTimestamp: null,
      lastSyncStatus: null,
      lastSyncDurationMs: null,
      groupsImported: 0,
      hostsImported: 0,
      lastSyncErrorSanitized: null,
      totalHosts: 0,
      tagsValid: 0,
      tagsInvalid: 0,
      hostsWithoutTag: 0,
      groupsWithoutEntity: 0,
      cacheAgeHours: null,
      tagCoveragePercent: null,
      consecutiveFailures: 0,
      alerts: { syncFailing: false, cacheStale: false, lowTagCoverage: false, groupsWithoutEntity: false },
      thresholds: LOGMEIN_HEALTH_THRESHOLDS,
      readOnly: true,
    };
  }

  private async fetchHostsWithGroups(): Promise<{
    groups: Array<{ externalId: string; name: string }>;
    hosts: LogmeinHostContext[];
    sourceSnapshotHash: string;
    customFieldsReadCount: number;
  }> {
    const endpoint = this.endpoint();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: this.basicAuthHeader(),
        },
      });
      if (!response.ok) {
        throw new Error(`LOGMEIN_HTTP_${response.status}`);
      }

      const body = await response.json() as unknown;
      const { groups, hosts } = this.normalizeSnapshot(body);
      return {
        groups,
        hosts,
        sourceSnapshotHash: this.hash(JSON.stringify({ groups, hosts })),
        customFieldsReadCount: hosts.filter((host) => host.tagSource === 'custom_field').length,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeSnapshot(body: unknown): {
    groups: Array<{ externalId: string; name: string }>;
    hosts: LogmeinHostContext[];
  } {
    const record = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const dataRecord = selectRecord(record.data, record.Data);
    const rawGroups = selectArray(
      record.groups,
      record.Groups,
      record.hostGroups,
      record.HostGroups,
      dataRecord.groups,
      dataRecord.Groups,
      dataRecord.hostGroups,
      dataRecord.HostGroups,
    );
    const rawHosts = selectArray(
      record.hosts,
      record.Hosts,
      dataRecord.hosts,
      dataRecord.Hosts,
      record.items,
      dataRecord.items,
      Array.isArray(body) ? body : undefined,
    );
    const rawHostGroups = selectArray(
      record.hostsGroups,
      record.hostgroups,
      record.HostsGroups,
      record.host_groups,
      dataRecord.hostsGroups,
      dataRecord.hostgroups,
      dataRecord.HostsGroups,
      dataRecord.host_groups,
    );
    const groups = new Map<string, string>();
    const hostsByExternalId = new Map<string, LogmeinHostContext>();

    for (const item of rawGroups) {
      const groupRecord = selectRecord(item);
      const externalId = firstText(groupRecord, ['id', 'groupid', 'groupId', 'groupID', 'group_id', 'externalId', 'GroupID'], 120);
      const name = firstText(groupRecord, ['name', 'groupname', 'groupName', 'group_name', 'description', 'GroupName'], 160);
      if (externalId !== '') {
        groups.set(externalId, name || externalId);
      }
    }

    for (const item of rawHostGroups) {
      const groupRecord = selectRecord(item);
      const externalId = firstText(groupRecord, ['id', 'groupid', 'groupId', 'groupID', 'group_id', 'externalId', 'GroupID'], 120);
      const name = firstText(groupRecord, ['name', 'groupname', 'groupName', 'group_name', 'description', 'GroupName'], 160);
      if (externalId !== '') {
        groups.set(externalId, name || externalId);
      }

      const nestedHosts = selectArray(groupRecord.hosts, groupRecord.Hosts, groupRecord.items);
      for (const nestedHost of nestedHosts) {
        const nestedRecord = selectRecord(nestedHost);
        const host = this.normalizeHost({
          ...nestedRecord,
          groupid: nestedRecord.groupid ?? nestedRecord.groupId ?? nestedRecord.groupID ?? externalId,
          groupname: nestedRecord.groupname ?? nestedRecord.groupName ?? name,
        }, groups);
        if (host) {
          hostsByExternalId.set(host.externalId, host);
        }
      }
    }

    for (const item of rawHosts) {
      const host = this.normalizeHost(item, groups);
      if (!host) {
        continue;
      }
      hostsByExternalId.set(host.externalId, host);
      if (host.groupExternalId !== '') {
        groups.set(host.groupExternalId, host.groupName || groups.get(host.groupExternalId) || host.groupExternalId);
      }
    }

    return {
      groups: [...groups.entries()].map(([externalId, name]) => ({ externalId, name })),
      hosts: [...hostsByExternalId.values()],
    };
  }

  private normalizeHost(value: unknown, groupNames: Map<string, string> = new Map()): LogmeinHostContext | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const externalId = firstText(record, ['id', 'hostId', 'hostid', 'host_id', 'externalId', 'HostID'], 120);
    if (externalId === '') {
      return null;
    }

    const groupExternalId = firstText(record, ['groupid', 'groupId', 'groupID', 'group_id', 'groupExternalId', 'GroupID'], 120);
    const groupName = firstText(record, ['groupname', 'groupName', 'group_name', 'group', 'GroupName'], 120)
      || (groupExternalId !== '' ? groupNames.get(groupExternalId) ?? '' : '')
      || groupExternalId;
    const hostName = firstText(record, ['host_name', 'hostName', 'hostname', 'hostDescription', 'hostdescription', 'name', 'description', 'Description'], 160);
    const customFieldTag = this.extractEquipmentTagFromCustomFields(this.extractCustomFields(record));
    const explicitTag = this.extractEquipmentTag([
      record.equipment_tag,
      record.tag,
      record.assetTag,
    ]);
    const fallbackTag = this.extractEquipmentTag([
      record.description,
      record.Description,
      record.hostDescription,
      record.hostdescription,
      hostName,
    ], false);
    const selectedTag = customFieldTag.value !== '' ? customFieldTag : explicitTag.value !== '' ? explicitTag : fallbackTag;
    const status = this.normalizeStatus(record.status ?? record.hostStatus ?? record.isHostOnline ?? record.isOnline ?? record.HostState);

    return {
      externalId,
      groupExternalId,
      groupName,
      hostName,
      equipmentTag: selectedTag.value,
      tagQuality: selectedTag.quality,
      tagSource: selectedTag.source,
      status,
      lastSeenAt: firstText(record, ['last_seen_at', 'lastSeenAt', 'hostStateChangeDate', 'HostStateChangeDate'], 80) || null,
    };
  }

  private normalizeStatus(value: unknown): LogmeinHostContext['status'] {
    if (value === true) {
      return 'online';
    }
    if (value === false) {
      return 'offline';
    }
    const status = String(value ?? '').toLowerCase();
    if (['online', 'available', 'connected'].includes(status)) {
      return 'online';
    }
    if (['offline', 'unavailable', 'disconnected'].includes(status)) {
      return 'offline';
    }

    return 'unknown';
  }

  private extractEquipmentTag(values: unknown[], allowInvalid = true): { value: string; quality: LogmeinHostContext['tagQuality']; source: LogmeinHostContext['tagSource'] } {
    for (const value of values) {
      const clean = sanitizeText(value, 240);
      if (clean === '') {
        continue;
      }
      const match = clean.match(/(?<!\d)(\d{4})(?!\d)/);
      if (match) {
        return { value: match[1], quality: 'valid', source: 'fallback' };
      }
      const invalidCandidate = clean.match(/[A-Za-z0-9_-]{3,24}/);
      if (allowInvalid && invalidCandidate) {
        return { value: invalidCandidate[0], quality: 'invalid', source: 'fallback' };
      }
    }

    return { value: '', quality: 'missing', source: 'none' };
  }

  private extractEquipmentTagFromCustomFields(fields: Record<string, string>): { value: string; quality: LogmeinHostContext['tagQuality']; source: LogmeinHostContext['tagSource'] } {
    for (const fieldName of ['etiqueta', 'patrimonio', 'glpi_id']) {
      const clean = sanitizeText(fields[fieldName], 80);
      if (clean === '') {
        continue;
      }

      return {
        value: clean,
        quality: /^\d{4}$/.test(clean) ? 'valid' : 'invalid',
        source: 'custom_field',
      };
    }

    return { value: '', quality: 'missing', source: 'none' };
  }

  private extractCustomFields(record: Record<string, unknown>): Record<string, string> {
    const fields: Record<string, string> = {};
    const objectFields = selectRecord(record.customFields, record.customfields, record.CustomFields, record.custom_fields);
    for (const [name, value] of Object.entries(objectFields)) {
      const normalizedName = this.normalizeCustomFieldName(name);
      const cleanValue = sanitizeText(value, 120);
      if (normalizedName !== '' && cleanValue !== '') {
        fields[normalizedName] = cleanValue;
      }
    }

    for (const item of selectArray(record.customFields, record.customfields, record.CustomFields, record.custom_fields, record.fields, record.Fields)) {
      const field = selectRecord(item);
      const normalizedName = this.normalizeCustomFieldName(firstText(field, ['name', 'fieldName', 'field_name', 'label', 'key', 'Name'], 80));
      const cleanValue = firstText(field, ['value', 'fieldValue', 'field_value', 'text', 'Value'], 120);
      if (normalizedName !== '' && cleanValue !== '') {
        fields[normalizedName] = cleanValue;
      }
    }

    return fields;
  }

  private normalizeCustomFieldName(value: string): string {
    return sanitizeText(value, 80)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private fallback(status: LogmeinReadonlyResult['status'], message: string): LogmeinReadonlyResult {
    return { ok: false, status, message, hosts: [] };
  }

  private syncFallback(status: LogmeinSyncResult['status'], message: string, endpoint: string): LogmeinSyncResult {
    return {
      ok: false,
      status,
      message,
      groupsImported: 0,
      hostsImported: 0,
      endpoint,
      durationMs: 0,
    };
  }

  private endpoint(): string {
    return normalizeEndpoint(this.config.baseUrl);
  }

  private hasCredentials(): boolean {
    return Boolean(this.config.companyId?.trim()) && Boolean(this.config.psk?.trim());
  }

  private basicAuthHeader(): string {
    const companyId = this.config.companyId?.trim() ?? '';
    const psk = this.config.psk?.trim() ?? '';
    return `Basic ${Buffer.from(`${companyId}:${psk}`).toString('base64')}`;
  }

  private async audit(eventType: string, status: 'success' | 'failed', payload: Record<string, unknown>): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity: status === 'success' ? 'info' : 'warning',
      source: 'LogmeinReadonlyContextService',
      payload: {
        ...payload,
        read_only: true,
        no_remote_execution: true,
      },
    });
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private errorType(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout/i.test(message)) {
      return 'timeout';
    }
    if (/LOGMEIN_HTTP_/i.test(message)) {
      return 'http';
    }
    return 'transport';
  }
}
