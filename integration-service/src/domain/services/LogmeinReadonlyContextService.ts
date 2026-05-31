import { createHash } from 'node:crypto';

import type { AuditService } from './AuditService.js';

export interface LogmeinReadonlyConfig {
  enabled: boolean;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export interface LogmeinHostContext {
  externalId: string;
  groupName: string;
  hostName: string;
  equipmentTag: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeenAt: string | null;
}

export interface LogmeinReadonlyResult {
  ok: boolean;
  status: 'disabled' | 'unconfigured' | 'available' | 'unavailable';
  message: string;
  hosts: LogmeinHostContext[];
}

const DEFAULT_TIMEOUT_MS = 5_000;

function sanitizeText(value: unknown, max = 160): string {
  return String(value ?? '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/(?:\+?\d[\s().-]*){10,16}/g, '[TELEFONE]')
    .replace(/\b(?:token|secret|bearer|authorization|password|api_key)\b\s*[:=]\s*["']?[^"',\s}]+["']?/gi, '[SEGREDO_REMOVIDO]')
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

export class LogmeinReadonlyContextService {
  public constructor(
    private readonly config: LogmeinReadonlyConfig,
    private readonly auditService?: AuditService,
  ) {}

  public async listHostsByGroup(groupExternalId: string): Promise<LogmeinReadonlyResult> {
    if (!this.config.enabled) {
      return this.fallback('disabled', 'Contexto de ativo temporariamente indisponível.');
    }
    if (!this.config.baseUrl || !this.config.token) {
      return this.fallback('unconfigured', 'CONFIG_REQUIRED_FOR_LOGMEIN_CREDENTIALS');
    }

    const groupId = sanitizeText(groupExternalId, 120);
    if (groupId === '') {
      return this.fallback('unavailable', 'Contexto de ativo temporariamente indisponível.');
    }

    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/groups/${encodeURIComponent(groupId)}/hosts`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.token}`,
        },
      });
      if (!response.ok) {
        await this.audit('LOGMEIN_SYNC_FAILED', 'failed', { http_status: response.status, endpoint: sanitizeUrl(endpoint) });
        return this.fallback('unavailable', 'Contexto de ativo temporariamente indisponível.');
      }

      const body = await response.json() as { hosts?: unknown[] };
      const hosts = Array.isArray(body.hosts)
        ? body.hosts.slice(0, 20).map((item) => this.normalizeHost(item)).filter((host): host is LogmeinHostContext => host !== null)
        : [];
      await this.audit('LOGMEIN_SYNC_COMPLETED', 'success', {
        endpoint: sanitizeUrl(endpoint),
        group_hash: this.hash(groupId),
        host_count: hosts.length,
      });

      return { ok: true, status: 'available', message: '', hosts };
    } catch (error: unknown) {
      await this.audit('LOGMEIN_SYNC_FAILED', 'failed', { error_type: this.errorType(error), endpoint: sanitizeUrl(endpoint) });
      return this.fallback('unavailable', 'Contexto de ativo temporariamente indisponível.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeHost(value: unknown): LogmeinHostContext | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const externalId = sanitizeText(record.id ?? record.external_id, 120);
    if (externalId === '') {
      return null;
    }
    const status = String(record.status ?? '').toLowerCase();

    return {
      externalId,
      groupName: sanitizeText(record.group_name ?? record.groupName, 120),
      hostName: sanitizeText(record.host_name ?? record.hostName ?? record.name, 160),
      equipmentTag: sanitizeText(record.equipment_tag ?? record.tag, 80),
      status: status === 'online' || status === 'offline' ? status : 'unknown',
      lastSeenAt: sanitizeText(record.last_seen_at ?? record.lastSeenAt, 80) || null,
    };
  }

  private fallback(status: LogmeinReadonlyResult['status'], message: string): LogmeinReadonlyResult {
    return { ok: false, status, message, hosts: [] };
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
    return 'transport';
  }
}
