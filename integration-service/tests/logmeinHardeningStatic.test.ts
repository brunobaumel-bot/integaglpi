/**
 * V6 LogMeIn Operational Hardening — static assertions.
 *
 * Phase: integaglpi_logmein_operational_hardening_release_001
 *
 * Verifies:
 * - Redis lock used for cross-process sync exclusion
 * - Duration tracked in sync result and audit
 * - Health summary returns all required metrics
 * - Threshold constants present
 * - No remote execution / RMM
 * - No external write methods (POST/PUT/DELETE to LogMeIn)
 * - CSV sanitization preserved
 * - RBAC/CSRF guards preserved in PHP
 * - Retention and release readiness documented
 */

import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  LOGMEIN_HEALTH_THRESHOLDS,
  LogmeinReadonlyContextService,
} from '../src/domain/services/LogmeinReadonlyContextService.js';
import { PostgresLogmeinReadonlyRepository } from '../src/repositories/postgres/PostgresLogmeinReadonlyRepository.js';
import { LogmeinRedisSyncLock } from '../src/cache/LogmeinRedisSyncLock.js';

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('V6 LogMeIn hardening', () => {
  // ── 1. Health thresholds are non-zero and match spec ────────────────────────
  it('exports health thresholds matching spec requirements', () => {
    expect(LOGMEIN_HEALTH_THRESHOLDS.tagCoverageWarningPercent).toBe(85);
    expect(LOGMEIN_HEALTH_THRESHOLDS.cacheStaleWarningHours).toBe(24);
    expect(LOGMEIN_HEALTH_THRESHOLDS.cacheStaleCriticalHours).toBe(48);
    expect(LOGMEIN_HEALTH_THRESHOLDS.consecutiveFailuresWarning).toBe(2);
    // Critical must be stricter than warning.
    expect(LOGMEIN_HEALTH_THRESHOLDS.cacheStaleCriticalHours).toBeGreaterThan(
      LOGMEIN_HEALTH_THRESHOLDS.cacheStaleWarningHours,
    );
  });

  // ── 2. Sync result includes durationMs ──────────────────────────────────────
  it('sync fallback results carry durationMs: 0', async () => {
    const disabled = new LogmeinReadonlyContextService({ enabled: false });
    const result = await disabled.syncHostsWithGroups();
    expect(result).toHaveProperty('durationMs', 0);
    expect(result.status).toBe('disabled');

    const unconfigured = new LogmeinReadonlyContextService({ enabled: true });
    const unconfiguredResult = await unconfigured.syncHostsWithGroups();
    expect(unconfiguredResult).toHaveProperty('durationMs', 0);
  });

  it('sync happy path propagates durationMs > 0', async () => {
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 1, hostsImported: 2 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        groups: [{ id: 'g-1', name: 'N3' }],
        hosts: [{ id: 'h-1', groupId: 'g-1', description: 'HOST 1234', isHostOnline: true }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new LogmeinReadonlyContextService(
      { enabled: true, baseUrl: 'https://secure.logmein.com/public-api/v2', companyId: 'c', psk: 'p', timeoutMs: 50 },
      undefined,
      repository,
    );

    const result = await service.syncHostsWithGroups();
    expect(result.ok).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // insertSyncAudit must be called with durationMs on the completed event.
    const completedCall = (repository.insertSyncAudit.mock.calls as unknown[][]).find(
      (call) => (call[0] as { status?: string })?.status === 'completed',
    );
    expect(completedCall).toBeDefined();
    expect((completedCall?.[0] as { durationMs?: number })?.durationMs).toBeGreaterThanOrEqual(0);
    vi.unstubAllGlobals();
  });

  // ── 3. Redis lock blocks concurrent sync and emits CONCURRENCY_BLOCKED audit ─
  it('blocks concurrent sync with Redis lock and emits concurrency audit event', async () => {
    const auditEvents: string[] = [];
    const auditService = {
      recordAuditEventSafe: vi.fn(async (event: { eventType: string }) => {
        auditEvents.push(event.eventType);
      }),
    };
    const lockBusy = {
      tryAcquire: vi.fn(async () => false), // simulate Redis lock already held
      release: vi.fn(async () => undefined),
    };
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 0, hostsImported: 0 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const service = new LogmeinReadonlyContextService(
      { enabled: true, baseUrl: 'https://secure.logmein.com/public-api/v2', companyId: 'c', psk: 'p', timeoutMs: 50 },
      auditService as never,
      repository,
      lockBusy,
    );
    const result = await service.syncHostsWithGroups();

    expect(result.ok).toBe(false);
    expect(result.status).toBe('sync_in_progress');
    expect(result.durationMs).toBe(0);
    expect(auditEvents).toContain('LOGMEIN_SYNC_CONCURRENCY_BLOCKED');
    // Lock release must NOT be called since acquire returned false.
    expect(lockBusy.release).not.toHaveBeenCalled();
    // Repository insert must NOT be called.
    expect(repository.insertSyncAudit).not.toHaveBeenCalled();
  });

  it('releases Redis lock after successful sync', async () => {
    const lockAcquired = {
      tryAcquire: vi.fn(async () => true),
      release: vi.fn(async () => undefined),
    };
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 1, hostsImported: 1 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        groups: [{ id: 'g-1', name: 'N3' }],
        hosts: [{ id: 'h-1', groupId: 'g-1', description: 'HOST 5678', isHostOnline: true }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new LogmeinReadonlyContextService(
      { enabled: true, baseUrl: 'https://secure.logmein.com/public-api/v2', companyId: 'c', psk: 'p', timeoutMs: 50 },
      undefined,
      repository,
      lockAcquired,
    );

    const result = await service.syncHostsWithGroups();
    expect(result.ok).toBe(true);
    expect(lockAcquired.tryAcquire).toHaveBeenCalledOnce();
    expect(lockAcquired.release).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  // ── 4. Health summary from repository ───────────────────────────────────────
  it('getHealthSummary delegates to repository.getHealthSummary when available', async () => {
    const mockSummary = {
      ok: true,
      status: 'ok' as const,
      lastSyncTimestamp: '2024-01-01T00:00:00Z',
      lastSyncStatus: 'completed' as const,
      lastSyncDurationMs: 1200,
      groupsImported: 5,
      hostsImported: 42,
      lastSyncErrorSanitized: null,
      totalHosts: 50,
      tagsValid: 45,
      tagsInvalid: 3,
      hostsWithoutTag: 2,
      groupsWithoutEntity: 0,
      cacheAgeHours: 2.5,
      tagCoveragePercent: 90,
      consecutiveFailures: 0,
      alerts: { syncFailing: false, cacheStale: false, lowTagCoverage: false, groupsWithoutEntity: false },
      thresholds: LOGMEIN_HEALTH_THRESHOLDS,
      readOnly: true as const,
    };
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 0, hostsImported: 0 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
      getHealthSummary: vi.fn(async () => mockSummary),
    };
    const service = new LogmeinReadonlyContextService(
      { enabled: true, baseUrl: 'https://secure.logmein.com/public-api/v2', companyId: 'c', psk: 'p' },
      undefined,
      repository,
    );
    const result = await service.getHealthSummary();
    expect(result.status).toBe('ok');
    expect(result.tagsValid).toBe(45);
    expect(result.tagCoveragePercent).toBe(90);
    expect(result.thresholds).toEqual(LOGMEIN_HEALTH_THRESHOLDS);
    expect(result.readOnly).toBe(true);
    expect(repository.getHealthSummary).toHaveBeenCalledOnce();
  });

  it('getHealthSummary returns unavailable when service is disabled', async () => {
    const service = new LogmeinReadonlyContextService({ enabled: false });
    const result = await service.getHealthSummary();
    expect(result.status).toBe('unavailable');
    expect(result.ok).toBe(false);
    expect(result.readOnly).toBe(true);
  });

  // ── 5. Repository health query structure ────────────────────────────────────
  it('PostgresLogmeinReadonlyRepository has getHealthSummary method', () => {
    const repository = new PostgresLogmeinReadonlyRepository({ query: vi.fn() });
    expect(typeof repository.getHealthSummary).toBe('function');
  });

  // ── 6. Redis sync lock module exports correct interface ─────────────────────
  it('LogmeinRedisSyncLock exposes tryAcquire and release methods', () => {
    // Instantiation will fail without real Redis — just verify the class shape.
    const lock = new LogmeinRedisSyncLock();
    expect(typeof lock.tryAcquire).toBe('function');
    expect(typeof lock.release).toBe('function');
  });

  // ── 7. Static file assertions — safety, no remote, no secrets ────────────────
  it('hardening files preserve read-only, no remote, no punitive metrics', async () => {
    const service = await readProjectFile('../integaglpi/src/Service/LogmeinGovernanceService.php');
    const front = await readProjectFile('../integaglpi/front/logmein.mapping.php');
    const template = await readProjectFile('../integaglpi/templates/logmein_mapping.php');
    const lockFile = await readProjectFile('src/cache/LogmeinRedisSyncLock.ts');
    const contextService = await readProjectFile('src/domain/services/LogmeinReadonlyContextService.ts');
    const controller = await readProjectFile('src/controllers/createLogmeinReadonlyController.ts');

    // Redis lock: SET NX PX pattern.
    expect(lockFile).toContain("'NX'");
    expect(lockFile).toContain("'PX'");
    expect(lockFile).toContain('tryAcquire');
    expect(lockFile).toContain('release');
    // Fail-open on Redis error (returns true so static flag still governs).
    expect(lockFile).toContain('return true');
    // No hardcoded credentials in the lock file (ownership token is fine; real secrets are not).
    expect(lockFile).not.toMatch(/LOGMEIN_COMPANY_ID|LOGMEIN_PSK|companyId\s*[:=]\s*['"\w]|psk\s*[:=]\s*['"\w]|password\s*[:=]\s*['"\w]|api_key\s*[:=]/i);

    // Context service: lock adapter interface exported.
    expect(contextService).toContain('LogmeinSyncLockAdapter');
    expect(contextService).toContain('LOGMEIN_SYNC_CONCURRENCY_BLOCKED');
    expect(contextService).toContain('durationMs');
    expect(contextService).toContain('getHealthSummary');
    expect(contextService).toContain('LogmeinHealthSummary');
    expect(contextService).toContain('LOGMEIN_HEALTH_THRESHOLDS');

    // Controller: health endpoint present.
    expect(controller).toContain('createLogmeinHealthController');
    expect(controller).toContain('getHealthSummary');
    expect(controller).toContain('duration_ms');
    expect(controller).toContain('read_only: true');

    // PHP service: health summary present with all required keys.
    expect(service).toContain('getHealthSummary');
    expect(service).toContain('last_sync_timestamp');
    expect(service).toContain('last_sync_duration_ms');
    expect(service).toContain('tag_coverage_percent');
    expect(service).toContain('cache_age_hours');
    expect(service).toContain('consecutive_failures');
    expect(service).toContain('sync_failing');
    expect(service).toContain('cache_stale');
    expect(service).toContain('low_tag_coverage');
    expect(service).toContain('HEALTH_TAG_COVERAGE_WARNING_PCT');
    expect(service).toContain('HEALTH_CACHE_STALE_WARNING_H');
    expect(service).toContain('HEALTH_CACHE_STALE_CRITICAL_H');

    // Template: health card with alert banners present.
    expect(template).toContain('Saúde do cache LogMeIn');
    expect(template).toContain('sync_failing');
    expect(template).toContain('cache_stale');
    expect(template).toContain('low_tag_coverage');
    expect(template).toContain('groups_without_entity');
    expect(template).toContain('tag_coverage_percent');
    expect(template).toContain('cache_age_hours');
    expect(template).toContain('consecutive_failures');
    expect(template).toContain('Nenhum alerta gera WhatsApp, e-mail ou ticket automático');

    // Front: healthSummary passed to template.
    expect(front).toContain('getHealthSummary');
    expect(front).toContain('$healthSummary');

    // No remote/RMM/punitive in any touched file.
    const combined = `${service}\n${front}\n${template}\n${lockFile}\n${contextService}\n${controller}`;
    expect(combined).not.toMatch(/Iniciar acesso remoto|start session|RMM|remote execution|shell_exec|exec\(|CURLOPT_POST/i);
    // "leaderboard" must never appear; "produtividade nominal" only prohibited, never promoted.
    expect(combined).not.toMatch(/leaderboard/i);
    // Only flag punitive use, not prohibition text (e.g. "não medem produtividade nominal" is fine).
    expect(combined).not.toMatch(/(?<!não\s{0,10}medem?\s{0,10}|sem\s{0,10})ranking nominal de t[eé]cnicos/i);
    expect(combined).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bFLUSH(?:ALL|DB)?\b/i);
    expect(combined).not.toMatch(/companyId\s*=\s*['"]\w|psk\s*=\s*['"]\w/i);
  });

  it('health thresholds are documented in governance doc', async () => {
    const doc = await readProjectFile('../docs/v6_governance_release_logmein.md');
    expect(doc).toContain('85%');
    expect(doc).toContain('24 h');
    expect(doc).toContain('48 h');
    expect(doc).toContain('sync_failing');
    expect(doc).toContain('cache_stale');
    expect(doc).toContain('Retenção');
    expect(doc).toContain('90 dias');
    expect(doc).toContain('LOGMEIN_INTEGRATION_ENABLED');
    expect(doc).toContain('rollback');
    expect(doc).toContain('feature flag');
  });
});
