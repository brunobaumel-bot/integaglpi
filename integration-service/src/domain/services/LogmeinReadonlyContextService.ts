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
  }): Promise<void>;
  listHostsByGroup(groupExternalId: string, limit: number): Promise<LogmeinHostContext[]>;
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

export class LogmeinReadonlyContextService {
  private static syncInProgress = false;

  public constructor(
    private readonly config: LogmeinReadonlyConfig,
    private readonly auditService?: AuditService,
    private readonly repository?: LogmeinReadonlyCacheRepository,
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
    if (LogmeinReadonlyContextService.syncInProgress) {
      await this.audit('LOGMEIN_SYNC_FAILED', 'failed', {
        endpoint,
        reason: 'sync_in_progress',
      });

      return this.syncFallback('sync_in_progress', 'LOGMEIN_SYNC_IN_PROGRESS', endpoint);
    }

    LogmeinReadonlyContextService.syncInProgress = true;
    await this.repository.insertSyncAudit({ status: 'started', groupsImported: 0, hostsImported: 0 });
    await this.audit('LOGMEIN_SYNC_STARTED', 'success', { endpoint });

    try {
      const snapshot = await this.fetchHostsWithGroups();
      const imported = await this.repository.upsertHosts(snapshot);
      await this.repository.insertSyncAudit({
        status: 'completed',
        groupsImported: imported.groupsImported,
        hostsImported: imported.hostsImported,
      });
      await this.audit('LOGMEIN_SYNC_COMPLETED', 'success', {
        endpoint,
        groups_imported: imported.groupsImported,
        hosts_imported: imported.hostsImported,
      });

      return {
        ok: true,
        status: 'completed',
        message: '',
        groupsImported: imported.groupsImported,
        hostsImported: imported.hostsImported,
        endpoint,
      };
    } catch (error: unknown) {
      const errorMessage = sanitizeText(error instanceof Error ? error.message : String(error), 240);
      await this.repository.insertSyncAudit({
        status: 'failed',
        groupsImported: 0,
        hostsImported: 0,
        errorMessageSanitized: errorMessage,
      });
      await this.audit('LOGMEIN_SYNC_FAILED', 'failed', {
        endpoint,
        error_type: this.errorType(error),
      });

      return {
        ok: false,
        status: 'failed',
        message: 'Contexto de ativo temporariamente indisponível.',
        groupsImported: 0,
        hostsImported: 0,
        endpoint,
      };
    } finally {
      LogmeinReadonlyContextService.syncInProgress = false;
    }
  }

  private async fetchHostsWithGroups(): Promise<{
    groups: Array<{ externalId: string; name: string }>;
    hosts: LogmeinHostContext[];
    sourceSnapshotHash: string;
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
    const equipmentTag = this.extractEquipmentTag([
      record.equipment_tag,
      record.tag,
      record.assetTag,
      record.description,
      record.Description,
      record.hostDescription,
      record.hostdescription,
      hostName,
    ]);
    const status = this.normalizeStatus(record.status ?? record.hostStatus ?? record.isHostOnline ?? record.isOnline ?? record.HostState);

    return {
      externalId,
      groupExternalId,
      groupName,
      hostName,
      equipmentTag,
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

  private extractEquipmentTag(values: unknown[]): string {
    for (const value of values) {
      const clean = sanitizeText(value, 240);
      const match = clean.match(/(?<!\d)(\d{4})(?!\d)/);
      if (match) {
        return match[1];
      }
    }

    return '';
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
