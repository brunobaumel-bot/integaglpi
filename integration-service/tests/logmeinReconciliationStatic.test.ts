/**
 * V7 LogMeIn remote-access reconciliation — static assertions.
 *
 * Phase: integaglpi_v7_logmein_remote_access_evidence_reconciliation_001
 *
 * Verifies:
 * - read-only allowlist policy (POST reports only, no connection/RMM endpoints)
 * - session-ID idempotency
 * - IP and technician hashing (no plaintext)
 * - feature flag OFF by default
 * - matching confidence logic
 * - regularization queue statuses
 * - GLPI task requires human confirmation
 * - no auto WhatsApp, no ranking, no punitive metrics
 * - all forbidden endpoints absent
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
  classifyReportHttpStatus,
  FORBIDDEN_ENDPOINTS,
  ForbiddenEndpointError,
  MATCH_STATUSES,
  LogmeinReconciliationService,
  RECONCILIATION_ALLOWED_PATHS,
  RECONCILIATION_FALLBACK_PATH,
  RECONCILIATION_REPORT_PATH,
  REPORT_ERROR_CATEGORIES,
} from '../src/domain/services/LogmeinReconciliationService.js';
import { createLogmeinReconciliationSyncController } from '../src/controllers/createLogmeinReconciliationController.js';
import { PostgresLogmeinReconciliationRepository } from '../src/repositories/postgres/PostgresLogmeinReconciliationRepository.js';

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('V7 LogMeIn remote-access reconciliation', () => {
  // ── 1. Constants and policy ───────────────────────────────────────────────
  it('uses only the allowlisted POST report endpoint', () => {
    expect(RECONCILIATION_REPORT_PATH).toBe('/public-api/v1/reports/remote-access-with-groups');
    // Must NOT be a connection/action endpoint.
    expect(RECONCILIATION_REPORT_PATH).not.toMatch(/connection|execute|deploy|run|start/i);
  });

  it('exports FORBIDDEN_ENDPOINTS covering connection and RMM patterns', () => {
    const combined = FORBIDDEN_ENDPOINTS.join('\n');
    expect(combined).toContain('/hosts/');
    expect(combined).toContain('/connection');
    expect(combined).toContain('/start-session');
  });

  it('exports all required match statuses', () => {
    const required = [
      'pending_user_review',
      'no_ticket_found',
      'no_entity_mapping',
      'matched_ticket',
      'ignored_duplicate',
      'out_of_scope',
      'resolved',
    ];
    for (const s of required) {
      expect((MATCH_STATUSES as readonly string[]).includes(s)).toBe(true);
    }
  });

  // ── 2. Feature flag default off ──────────���────────────────────────────────
  it('returns disabled when reconciliationEnabled is false', async () => {
    const service = new LogmeinReconciliationService({
      enabled: false,
      reconciliationEnabled: false,
      companyId: 'c',
      psk: 'p',
    });
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe('disabled');
    expect(result.durationMs).toBe(0);
  });

  it('returns unconfigured when credentials are missing', async () => {
    const service = new LogmeinReconciliationService({
      enabled: true,
      reconciliationEnabled: true,
    });
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe('unconfigured');
  });

  // ── 3. Concurrency lock blocks duplicate sync ─────────────────────────────
  it('blocks concurrent reconciliation sync via Redis lock', async () => {
    const lockBusy = {
      tryAcquire: vi.fn(async () => false),
      release: vi.fn(async () => undefined),
    };
    const auditEvents: string[] = [];
    const auditService = {
      recordAuditEventSafe: vi.fn(async (e: { eventType: string }) => { auditEvents.push(e.eventType); }),
    };
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(),
      upsertQueueItem: vi.fn(),
      getEntityForGroup: vi.fn(async () => null),
      getEquipmentTagForHost: vi.fn(async () => null),
      listQueue: vi.fn(),
      resolveQueueItem: vi.fn(),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p' },
      auditService as never,
      repository as never,
      lockBusy,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe('sync_in_progress');
    expect(auditEvents).toContain('LOGMEIN_SESSION_SYNC_STARTED');
    expect(lockBusy.release).not.toHaveBeenCalled();
    expect(repository.upsertSession).not.toHaveBeenCalled();
  });

  // ── 4. Sync with happy-path mock ──���───────────────────────────────────────
  it('fetches sessions, hashes IP and technician, upserts to ledger', async () => {
    const upsertedSessions: unknown[] = [];
    const queueItems: unknown[] = [];
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(async (s: unknown) => { upsertedSessions.push(s); return { inserted: true }; }),
      upsertQueueItem: vi.fn(async (...args: unknown[]) => { queueItems.push(args); }),
      getEntityForGroup: vi.fn(async () => 42),
      getEquipmentTagForHost: vi.fn(async () => '1234'),
      listQueue: vi.fn(),
      resolveQueueItem: vi.fn(),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            sessionId: 'session-001',
            hostId: 'host-abc',
            groupId: 'group-xyz',
            groupName: 'Cliente Teste',
            hostName: 'DESKTOP-TEST-4567',
            startTime: '2024-01-10T10:00:00Z',
            endTime: '2024-01-10T10:30:00Z',
            duration: 1800,
            userIp: '192.168.1.100',           // must be hashed, not stored
            userId: 'tech@example.com',         // must be hashed, not stored
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2024-01-10T00:00:00Z'),
      new Date('2024-01-10T23:59:59Z'),
    );

    expect(result.ok).toBe(true);
    expect(result.sessionsFound).toBe(1);
    expect(result.sessionsInserted).toBe(1);

    // Verify session shape.
    const session = upsertedSessions[0] as Record<string, unknown>;
    expect(session.sessionId).toBe('session-001');
    expect(session.hostExternalId).toBe('host-abc');
    expect(session.groupExternalId).toBe('group-xyz');
    expect(session.durationSeconds).toBe(1800);
    expect(session.equipmentTag).toBe('1234');
    expect(session.glpiEntityId).toBe(42);

    // IP must NOT be stored.
    expect(JSON.stringify(session)).not.toContain('192.168.1');
    expect(JSON.stringify(session)).not.toContain('100');

    // Technician stored only as hash (64-char hex), never plaintext.
    expect(session.technicianHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(session)).not.toContain('tech@example.com');

    // Confidence: medium (entity matched + tag present).
    expect(session.matchConfidence).toBe('medium');
    expect(session.matchStatus).toBe('pending_user_review');

    vi.unstubAllGlobals();
  });

  it('assigns no_entity_mapping when group has no entity', async () => {
    const sessions: unknown[] = [];
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(async (s: unknown) => { sessions.push(s); return { inserted: true }; }),
      upsertQueueItem: vi.fn(async () => undefined),
      getEntityForGroup: vi.fn(async () => null),  // no mapping
      getEquipmentTagForHost: vi.fn(async () => null),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ sessionId: 's-002', hostId: 'h-1', groupId: 'g-1', startTime: '2024-01-01T00:00:00Z', endTime: '2024-01-01T00:10:00Z', duration: 600 }] }),
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    await service.syncRemoteAccessSessions();
    const session = sessions[0] as Record<string, unknown>;
    expect(session.matchStatus).toBe('no_entity_mapping');
    expect(session.matchConfidence).toBe('none');
    vi.unstubAllGlobals();
  });

  it('skips duplicate sessions (ON CONFLICT DO NOTHING)', async () => {
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(async () => ({ inserted: false })), // simulate duplicate
      upsertQueueItem: vi.fn(async () => undefined),
      getEntityForGroup: vi.fn(async () => 5),
      getEquipmentTagForHost: vi.fn(async () => null),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ sessionId: 's-003', hostId: 'h-1', groupId: 'g-1', startTime: '2024-01-01T00:00:00Z', endTime: '2024-01-01T00:05:00Z', duration: 300 }] }),
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );
    expect(result.sessionsInserted).toBe(0);
    expect(result.sessionsSkippedDuplicate).toBe(1);
    expect(repository.upsertQueueItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  // ── 5. Repository schema check ────────────────────────────────────────────
  it('PostgresLogmeinReconciliationRepository has all required methods', () => {
    const repo = new PostgresLogmeinReconciliationRepository({ query: vi.fn() });
    expect(typeof repo.isSchemaReady).toBe('function');
    expect(typeof repo.upsertSession).toBe('function');
    expect(typeof repo.upsertQueueItem).toBe('function');
    expect(typeof repo.getEntityForGroup).toBe('function');
    expect(typeof repo.getEquipmentTagForHost).toBe('function');
    expect(typeof repo.listQueue).toBe('function');
    expect(typeof repo.resolveQueueItem).toBe('function');
    expect(typeof repo.insertReconciliationAudit).toBe('function');
  });

  // ── 6. HTTP fetch uses POST on allowlisted endpoint only ──────────────────
  it('fetch call uses POST method (passive report) on reports endpoint', async () => {
    const fetchCalls: unknown[] = [];
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(async () => ({ inserted: false })),
      upsertQueueItem: vi.fn(async () => undefined),
      getEntityForGroup: vi.fn(async () => null),
      getEquipmentTagForHost: vi.fn(async () => null),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, opts: unknown) => {
      fetchCalls.push({ url, opts });
      return { ok: true, json: async () => ({ items: [] }) };
    }));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    await service.syncRemoteAccessSessions();

    const call = fetchCalls[0] as { url: string; opts: { method: string } };
    // URL must contain the allowlisted reports path.
    expect(String(call.url)).toContain('/public-api/v1/reports');
    // Method must be POST (passive report — allowlisted).
    expect(call.opts.method).toBe('POST');
    // Must NOT contain connection/action paths.
    expect(String(call.url)).not.toMatch(/connection|execute|deploy|run-script|start-session/i);
    // Authorization header must not be logged (just verify it exists).
    const headers = (call.opts as Record<string, unknown>).headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic\s+[A-Za-z0-9+/=]+$/);

    vi.unstubAllGlobals();
  });

  // ── FIX blocker 1: hardened endpoint allowlist ────────────────────────────
  it('exports an allowlist of report paths and a ForbiddenEndpointError', () => {
    expect(RECONCILIATION_ALLOWED_PATHS).toContain('/public-api/v1/reports/remote-access-with-groups');
    expect(RECONCILIATION_ALLOWED_PATHS).toContain('/public-api/v1/reports/remote-access');
    // The allowlist must NOT contain any action/connection path.
    for (const p of RECONCILIATION_ALLOWED_PATHS) {
      expect(p).not.toMatch(/connection|start-session|execute|deploy|run-script/i);
    }
    expect(typeof ForbiddenEndpointError).toBe('function');
  });

  it('ignores a malicious baseUrl path and always POSTs to an allowlisted report path', async () => {
    const fetchCalls: { url: string; opts: { method: string } }[] = [];
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(async () => ({ inserted: false })),
      upsertQueueItem: vi.fn(async () => undefined),
      getEntityForGroup: vi.fn(async () => null),
      getEquipmentTagForHost: vi.fn(async () => null),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, opts: unknown) => {
      fetchCalls.push({ url: String(url), opts: opts as { method: string; body?: string } });
      return { ok: true, json: async () => ({ items: [] }) };
    }));

    // Hostile config: baseUrl carries a connection action path + query + hash.
    const service = new LogmeinReconciliationService(
      {
        enabled: true,
        reconciliationEnabled: true,
        companyId: 'c',
        psk: 'p',
        timeoutMs: 100,
        baseUrl: 'https://secure.logmein.com/public-api/v1/hosts/123/connection?foo=bar#frag',
      },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );

    // Sync must succeed AND the URL must be the allowlisted report path — NOT the
    // connection path the config tried to inject.
    expect(result.ok).toBe(true);
    const calledUrl = fetchCalls[0]?.url ?? '';
    expect(calledUrl).toBe('https://secure.logmein.com/public-api/v1/reports/remote-access-with-groups');
    expect(calledUrl).not.toContain('/hosts/');
    expect(calledUrl).not.toContain('/connection');
    expect(calledUrl).not.toContain('foo=bar');
    expect(calledUrl).not.toContain('frag');
    expect(fetchCalls[0]?.opts.method).toBe('POST');
    const calledBody = JSON.parse(fetchCalls[0]?.opts.body ?? '{}');
    expect(calledBody).toMatchObject({
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-01T00:30:00.000Z',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-01T00:30:00.000Z',
    });

    vi.unstubAllGlobals();
  });

  it('rejects a non-https baseUrl (no plaintext exfiltration of credentials)', async () => {
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(async () => ({ inserted: false })),
      upsertQueueItem: vi.fn(async () => undefined),
      getEntityForGroup: vi.fn(async () => null),
      getEquipmentTagForHost: vi.fn(async () => null),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      {
        enabled: true,
        reconciliationEnabled: true,
        companyId: 'c',
        psk: 'p',
        timeoutMs: 100,
        baseUrl: 'http://evil.example.com',  // non-https
      },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );

    // Sync fails safely; fetch is never called against the http origin.
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('the source code composes the endpoint from origin + allowlisted path only', async () => {
    const reconcSvc = await readProjectFile('src/domain/services/LogmeinReconciliationService.ts');
    // reportEndpoint must validate against the allowlist and reject forbidden paths.
    expect(reconcSvc).toContain('RECONCILIATION_ALLOWED_PATHS.includes(path)');
    expect(reconcSvc).toContain('ForbiddenEndpointError');
    expect(reconcSvc).toContain("parsed.protocol !== 'https:'");
    // Must reduce base to origin: protocol + host.
    expect(reconcSvc).toContain('parsed.protocol}//${parsed.host}');
    // The old gap (returning baseUrl when it contains /public-api/v1) must be gone.
    expect(reconcSvc).not.toContain("if (base.includes('/public-api/v1')) return base;");
  });

  // ── FIX blocker 2: GLPI task duplicate prevention ─────────────────────────
  it('PHP enforces GLPI task duplicate prevention against glpi_tickettasks', async () => {
    const phpFront = await readProjectFile('../integaglpi/front/logmein.reconciliation.php');
    const phpTemplate = await readProjectFile('../integaglpi/templates/logmein_reconciliation.php');

    // Backend: queries glpi_tickettasks for the session marker before creating.
    expect(phpFront).toContain('LOGMEIN-SESSION-REF:');
    expect(phpFront).toContain("'FROM'  => 'glpi_tickettasks'");
    expect(phpFront).toContain("['LIKE', '%' . $taskMarker . '%']");
    expect(phpFront).toContain('$duplicate = true');
    expect(phpFront).toContain('Tarefa já vinculada a esta sessão remota');
    expect(phpFront).toContain('create_task_duplicate_blocked');
    // Backend persists glpi_task_id back to the queue via resolve endpoint.
    expect(phpFront).toContain("'task_id'   => $taskId");
    expect(phpFront).toContain('/reconciliation/queue/');
    // item_id must be required for the create_task flow.
    expect(phpFront).toContain("$queueItemId   = (int) (\$_POST['item_id'] ?? 0)");
    // Still a private task, no public follow-up.
    expect(phpFront).toContain("'is_private'");
    expect(phpFront).not.toContain('ITILFollowup');

    // UI: button hidden / replaced when a task is already linked.
    expect(phpTemplate).toContain('$hasLinkedTask');
    expect(phpTemplate).toContain("\$itemTaskId     = (int) (\$item['glpiTaskId'] ?? 0)");
    expect(phpTemplate).toContain('Tarefa já vinculada');
    // Modal only rendered when no task is linked yet.
    expect(phpTemplate).toContain('!$hasLinkedTask');
    // item_id hidden field present in the create_task modal.
    expect(phpTemplate).toContain('name="item_id"');
  });

  // ── 7. Static file assertions ─��───────────────────────────────────────────
  it('all new files preserve read-only policy and safety contracts', async () => {
    const reconcSvc = await readProjectFile('src/domain/services/LogmeinReconciliationService.ts');
    const reconcRepo = await readProjectFile('src/repositories/postgres/PostgresLogmeinReconciliationRepository.ts');
    const reconcCtrl = await readProjectFile('src/controllers/createLogmeinReconciliationController.ts');
    const migration = await readProjectFile('schema-migrations/043_logmein_remote_access_ledger.sql');
    const phpFront = await readProjectFile('../integaglpi/front/logmein.reconciliation.php');
    const phpTemplate = await readProjectFile('../integaglpi/templates/logmein_reconciliation.php');
    const phpService = await readProjectFile('../integaglpi/src/Service/SecurityAuditService.php');

    // Allowlisted endpoint.
    expect(reconcSvc).toContain(RECONCILIATION_REPORT_PATH);
    expect(reconcSvc).toContain('method: \'POST\'');
    // Forbidden endpoints listed.
    for (const ep of FORBIDDEN_ENDPOINTS) {
      expect(reconcSvc).toContain(ep);
    }
    // No remote execution.
    expect(reconcSvc).toContain('remote_execution: false');
    expect(reconcSvc).toContain('post_action_only_reports: true');
    // IP hashed.
    expect(reconcSvc).toContain('void rawIp');
    // Technician hash.
    expect(reconcSvc).toContain('sha256(rawUser)');
    expect(reconcSvc).not.toMatch(/rawUser\s*,/);
    // Session ID unique — constraint in migration, idempotency in repository.
    expect(migration).toContain('UNIQUE (session_id)');
    expect(reconcRepo).toContain('ON CONFLICT (session_id) DO NOTHING');
    // Migration additive.
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS');
    expect(migration).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
    // Queue statuses validated.
    expect(reconcCtrl).toContain('MATCH_STATUSES');
    expect(reconcCtrl).toContain('status(400)');
    // No connection endpoint in controllers.
    expect(reconcCtrl).not.toMatch(/connection|start-session|execute|deploy|run-script/i);
    // PHP: RBAC + CSRF.
    expect(phpFront).toContain('isCsrfValid($_POST)');
    expect(phpFront).toContain('RIGHT_MANAGE_LOGMEIN_RECONCILIATION');
    // PHP: Task is private note, no public follow-up.
    expect(phpFront).toContain("'is_private'");
    expect(phpFront).not.toContain('ITILFollowup');
    // Template: no IP display, no nominal technician.
    expect(phpTemplate).toContain('Técnicos não aparecem nominalmente');
    expect(phpTemplate).toContain('IP do técnico: nunca exibido');
    expect(phpTemplate).toContain('LOGMEIN_RECONCILIATION_ENABLED=false');
    // Audit events present.
    expect(phpService).toContain('LOGMEIN_SESSION_SYNC_STARTED');
    expect(phpService).toContain('LOGMEIN_SESSION_SYNC_COMPLETED');
    expect(phpService).toContain('LOGMEIN_SESSION_SYNC_FAILED');
    expect(phpService).toContain('LOGMEIN_SESSION_MATCHED');
    expect(phpService).toContain('LOGMEIN_SESSION_REGULARIZATION_CREATED');
    expect(phpService).toContain('LOGMEIN_SESSION_REGULARIZATION_RESOLVED');
    expect(phpService).toContain('SECURITY_LOGMEIN_RECONCILIATION_ACTION');
    // No ranking/leaderboard.
    const combined = `${reconcSvc}\n${reconcRepo}\n${reconcCtrl}\n${phpFront}\n${phpTemplate}`;
    expect(combined).not.toMatch(/ranking|leaderboard|produtividade.*t[eé]cnico/i);
    // No automatic WhatsApp.
    expect(combined).not.toMatch(/sendOutbound|sendWhatsApp|auto.*send/i);
    // No automatic billing code (prohibition text is fine).
    expect(combined).not.toMatch(/triggerBilling|processBilling|chargeClient|auto.*invoice/i);
    // No actual fetch/curl calls to forbidden endpoints.
    // (FORBIDDEN_ENDPOINTS array may list them as documentation — that's correct.)
    expect(combined).not.toMatch(/fetch\s*\([^)]*(?:connection|start-session|execute-remote|run-script)/i);
    expect(combined).not.toMatch(/curl_setopt[^;]*(?:\/hosts\/[a-zA-Z0-9-]+\/connection)/i);
  });

  // ── Report-error classification (HTTP 500 fix) ─────────────────────────────
  it('classifies report HTTP status codes into sanitized categories', () => {
    expect(classifyReportHttpStatus(400)).toBe(REPORT_ERROR_CATEGORIES.HTTP_400);
    expect(classifyReportHttpStatus(401)).toBe(REPORT_ERROR_CATEGORIES.HTTP_401_403);
    expect(classifyReportHttpStatus(403)).toBe(REPORT_ERROR_CATEGORIES.HTTP_401_403);
    expect(classifyReportHttpStatus(500)).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
    expect(classifyReportHttpStatus(502)).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
    expect(classifyReportHttpStatus(503)).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
  });

  it('persists report fallback metadata in reconciliation audit payload_json', async () => {
    const repoSource = await readProjectFile('src/repositories/postgres/PostgresLogmeinReconciliationRepository.ts');
    for (const key of [
      'report_error',
      'report_status_code',
      'primary_status_code',
      'fallback_status_code',
      'fallback_used',
      'report_path_label',
      'chunk_minutes',
      'overlap_minutes',
      'max_retries',
      'lookback_hours',
      'cooldown_seconds',
    ]) {
      expect(repoSource).toContain(key);
    }
    expect(repoSource).not.toMatch(/authorization|bearer|psk|raw_payload|headers/i);
  });

  it('wires reconciliation timing env vars in buildDependencies', async () => {
    const depsSource = await readProjectFile('src/buildDependencies.ts');
    expect(depsSource).toContain('LOGMEIN_RECONCILIATION_LOOKBACK_HOURS');
    expect(depsSource).toContain('LOGMEIN_RECONCILIATION_CHUNK_MINUTES');
    expect(depsSource).toContain('LOGMEIN_RECONCILIATION_OVERLAP_MINUTES');
    expect(depsSource).toContain('LOGMEIN_RECONCILIATION_MAX_RETRIES');
    expect(depsSource).toContain('LOGMEIN_RECONCILIATION_CIRCUIT_COOLDOWN_SECONDS');
    expect(depsSource).toMatch(/lookbackHoursRaw[\s\S]*LOGMEIN_RECONCILIATION_LOOKBACK_HOURS/);
  });

  function makeRepoMock() {
    return {
      isSchemaReady: vi.fn(async () => true),
      upsertSession: vi.fn(async () => ({ inserted: true })),
      upsertQueueItem: vi.fn(async () => undefined),
      getEntityForGroup: vi.fn(async () => 42),
      getEquipmentTagForHost: vi.fn(async () => '1234'),
      insertReconciliationAudit: vi.fn(async () => undefined),
    };
  }

  function report500(errorCode = 'provider-500') {
    return {
      ok: false,
      status: 500,
      text: async () => `)]}', {"errorCode":"${errorCode}","message":"Provider unavailable","psk":"psk-LEAK"}`,
    };
  }

  it('falls back from primary HTTP 500 to fallback report with zero sessions as success', async () => {
    const repository = makeRepoMock();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(report500('primary-zero-1'))
      .mockResolvedValueOnce(report500('primary-zero-2'))
      .mockResolvedValueOnce(report500('primary-zero-3'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'company-id', psk: 'psk-secret', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.sessionsFound).toBe(0);
    expect(result.sessionsInserted).toBe(0);
    expect(result.primaryStatusCode).toBe(500);
    expect(result.fallbackStatusCode).toBe(200);
    expect(result.fallbackUsed).toBe(true);
    expect(result.reportError).toBeNull();
    const completedAudit = repository.insertReconciliationAudit.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((payload) => payload.status === 'completed');
    expect(completedAudit?.primaryStatusCode).toBe(500);
    expect(completedAudit?.fallbackStatusCode).toBe(200);
    expect(completedAudit?.fallbackUsed).toBe(true);
    expect(completedAudit?.reportPathLabel).toBe('fallback');
    expect(completedAudit?.reportError).toBeNull();
    expect(completedAudit?.retriesPerformed).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(RECONCILIATION_REPORT_PATH);
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(RECONCILIATION_FALLBACK_PATH);
    expect(JSON.stringify(result)).not.toContain('psk-LEAK');
    expect(JSON.stringify(result)).not.toContain('secret_token');
    expect(repository.upsertSession).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('falls back from primary HTTP 500 and imports sessions returned by fallback', async () => {
    const repository = makeRepoMock();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(report500('primary-import-1'))
      .mockResolvedValueOnce(report500('primary-import-2'))
      .mockResolvedValueOnce(report500('primary-import-3'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              sessionId: 'sess-fallback-1',
              hostId: 'host-1',
              groupId: 'group-1',
              startTime: '2026-05-31T10:00:00Z',
              endTime: '2026-05-31T10:30:00Z',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T00:30:00Z'),
    );

    expect(result.ok).toBe(true);
    expect(result.sessionsFound).toBe(1);
    expect(result.sessionsInserted).toBe(1);
    expect(result.primaryStatusCode).toBe(500);
    expect(result.fallbackStatusCode).toBe(200);
    expect(result.fallbackUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(repository.upsertSession).toHaveBeenCalledTimes(1);
    expect(repository.upsertQueueItem).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('returns a sanitized error when primary and fallback both fail without leaking body or token', async () => {
    const repository = makeRepoMock();
    const auditEvents: { type: string; payload: Record<string, unknown> }[] = [];
    const auditService = {
      recordAuditEventSafe: vi.fn(async (e: { eventType: string; payload?: Record<string, unknown> }) => {
        auditEvents.push({ type: e.eventType, payload: e.payload ?? {} });
      }),
    };
    // Report APIs return HTTP 500 with bodies that must NEVER be surfaced.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(report500('primary-fail-1'))
      .mockResolvedValueOnce(report500('primary-fail-2'))
      .mockResolvedValueOnce(report500('primary-fail-3'))
      .mockResolvedValueOnce(report500('fallback-fail-1'))
      .mockResolvedValueOnce(report500('fallback-fail-2'))
      .mockResolvedValueOnce(report500('fallback-fail-3'));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'company-id', psk: 'psk-secret', timeoutMs: 100 },
      auditService as never,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.reportError).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
    expect(result.reportStatusCode).toBe(500);
    expect(result.primaryStatusCode).toBe(500);
    expect(result.fallbackStatusCode).toBe(500);
    expect(result.fallbackUsed).toBe(true);
    const failedAudit = repository.insertReconciliationAudit.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((payload) => payload.status === 'failed');
    expect(failedAudit?.reportError).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
    expect(failedAudit?.reportStatusCode).toBe(500);
    expect(failedAudit?.primaryStatusCode).toBe(500);
    expect(failedAudit?.fallbackStatusCode).toBe(500);
    expect(failedAudit?.fallbackUsed).toBe(true);
    expect(failedAudit?.reportPathLabel).toBe('fallback');
    expect(failedAudit?.retriesPerformed).toBe(4);
    expect(JSON.stringify(failedAudit ?? {})).not.toContain('psk-LEAK');
    expect(JSON.stringify(failedAudit ?? {})).not.toContain('psk-FALLBACK-LEAK');
    expect(JSON.stringify(failedAudit ?? {})).not.toContain('secret_token');
    // Message is operator-friendly and sanitized — no token, no raw body.
    expect(result.message).toContain('HTTP 5xx');
    expect(JSON.stringify(result)).not.toContain('psk-LEAK');
    expect(JSON.stringify(result)).not.toContain('psk-FALLBACK-LEAK');
    expect(JSON.stringify(result)).not.toContain('secret_token');
    expect(fetchMock).toHaveBeenCalledTimes(6);
    // Audit FAILED event present with sanitized context only.
    const failed = auditEvents.find((e) => e.type === 'LOGMEIN_SESSION_SYNC_FAILED');
    expect(failed).toBeDefined();
    expect(failed?.payload.report_error).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
    expect(failed?.payload.status_code).toBe(500);
    expect(failed?.payload.report_path_label).toBe('fallback');
    expect(failed?.payload.primary_status_code).toBe(500);
    expect(failed?.payload.fallback_status_code).toBe(500);
    expect(failed?.payload.fallback_used).toBe(true);
    // No raw body / token in the audit payload.
    expect(JSON.stringify(failed?.payload ?? {})).not.toContain('psk-LEAK');
    expect(JSON.stringify(failed?.payload ?? {})).not.toContain('psk-FALLBACK-LEAK');
    expect(JSON.stringify(failed?.payload ?? {})).not.toContain('secret_token');

    vi.unstubAllGlobals();
  });

  it('opens a temporary circuit breaker after repeated primary and fallback 5xx failures', async () => {
    const warmupRepository = makeRepoMock();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })));
    await new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      warmupRepository as never,
    ).syncRemoteAccessSessions();
    vi.unstubAllGlobals();

    for (let run = 0; run < 2; run++) {
      vi.stubGlobal('fetch', vi.fn(async () => report500(`breaker-${run}`)));
      const service = new LogmeinReconciliationService(
        { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
        undefined,
        makeRepoMock() as never,
      );
      const result = await service.syncRemoteAccessSessions();
      expect(result.ok).toBe(false);
      expect(result.reportError).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
      vi.unstubAllGlobals();
    }

    const blockedFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) }));
    vi.stubGlobal('fetch', blockedFetch);
    const blocked = await new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      makeRepoMock() as never,
    ).syncRemoteAccessSessions();
    expect(blocked.status).toBe('circuit_open');
    expect(blocked.message).toContain('cooldown');
    expect(blockedFetch).not.toHaveBeenCalled();
    const serviceClass = LogmeinReconciliationService as unknown as {
      circuitOpenUntilMs: number;
      consecutiveProvider5xxFailures: number;
    };
    serviceClass.circuitOpenUntilMs = 0;
    serviceClass.consecutiveProvider5xxFailures = 0;
    vi.unstubAllGlobals();
  });

  it('returns reconciliation metadata from the sync controller response', async () => {
    const service = {
      syncRemoteAccessSessions: vi.fn(async () => ({
        ok: false,
        status: 'failed',
        message: 'Relatório LogMeIn indisponível.',
        sessionsFound: 0,
        sessionsInserted: 0,
        sessionsSkippedDuplicate: 0,
        windowFrom: '2026-06-01',
        windowTo: '2026-06-01',
        durationMs: 12,
        reportError: REPORT_ERROR_CATEGORIES.HTTP_500,
        reportStatusCode: 500,
        reportReason: null,
        primaryStatusCode: 500,
        fallbackStatusCode: 500,
        fallbackUsed: true,
        lookbackHours: 1,
        lookbackDays: null,
        chunkMinutes: 15,
        overlapMinutes: 5,
        maxRetries: 1,
        cooldownSeconds: 60,
        circuitOpenUntil: null,
      })),
    };
    const responseBody: Record<string, unknown>[] = [];
    const response: {
      status: ReturnType<typeof vi.fn>;
      json: ReturnType<typeof vi.fn>;
    } = {
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);
    response.json.mockImplementation((body: Record<string, unknown>) => {
        responseBody.push(body);
        return response;
    });

    await createLogmeinReconciliationSyncController(service as never)(
      { body: {} } as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(503);
    expect(responseBody[0]?.report_error).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
    expect(responseBody[0]?.report_status_code).toBe(500);
    expect(responseBody[0]?.primary_status_code).toBe(500);
    expect(responseBody[0]?.fallback_status_code).toBe(500);
    expect(responseBody[0]?.fallback_used).toBe(true);
    expect(responseBody[0]?.lookback_hours).toBe(1);
    expect(responseBody[0]?.chunk_minutes).toBe(15);
    expect(responseBody[0]?.overlap_minutes).toBe(5);
    expect(responseBody[0]?.max_retries).toBe(1);
    expect(responseBody[0]?.cooldown_seconds).toBe(60);
    expect(JSON.stringify(responseBody[0])).not.toMatch(/token|bearer|psk-secret/i);
  });

  it('treats HTTP 200 with zero sessions as success, not error', async () => {
    const repository = makeRepoMock();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.sessionsFound).toBe(0);
    expect(result.sessionsInserted).toBe(0);
    expect(result.reportError).toBeNull();
    expect(result.primaryStatusCode).toBe(200);
    expect(result.fallbackStatusCode).toBeNull();
    expect(result.fallbackUsed).toBe(false);
    expect(result.message).toContain('nenhuma sessão remota');
    // No session was upserted.
    expect(repository.upsertSession).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('splits larger report windows into smaller chunks with overlap while preserving idempotency', async () => {
    const repository = makeRepoMock();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ sessionId: 'same-session', hostId: 'h-1', startTime: '2026-06-01T10:00:00Z' }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    ).syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T05:00:00Z'),
    );

    const completedAudit = repository.insertReconciliationAudit.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((payload) => payload.status === 'completed');
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(completedAudit?.chunksRequested).toBeGreaterThan(1);
    expect(completedAudit?.chunkMinutes).toBe(120);
    expect(completedAudit?.overlapMinutes).toBe(10);
    expect(repository.upsertSession).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('supports 15 minute chunks, 5 minute overlap, and one-hour lookback from config', async () => {
    const repository = makeRepoMock();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      {
        enabled: true,
        reconciliationEnabled: true,
        companyId: 'c',
        psk: 'p',
        timeoutMs: 100,
        lookbackDays: 7,
        lookbackHours: 1,
        chunkMinutes: 15,
        overlapMinutes: 5,
        maxRetries: 1,
        circuitCooldownSeconds: 60,
      },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    const startedAudit = repository.insertReconciliationAudit.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((payload) => payload.status === 'started');
    const completedAudit = repository.insertReconciliationAudit.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((payload) => payload.status === 'completed');
    expect(result.lookbackHours).toBe(1);
    expect(result.lookbackDays).toBeNull();
    expect(result.chunkMinutes).toBe(15);
    expect(result.overlapMinutes).toBe(5);
    expect(result.maxRetries).toBe(1);
    expect(result.cooldownSeconds).toBe(60);
    expect(startedAudit?.lookbackHours).toBe(1);
    expect(startedAudit?.lookbackDays).toBeNull();
    expect(completedAudit?.chunkMinutes).toBe(15);
    expect(completedAudit?.overlapMinutes).toBe(5);
    expect(completedAudit?.maxRetries).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    vi.unstubAllGlobals();
  });

  it('caps overlap below chunk size and preserves safe defaults for invalid timing values', async () => {
    const repository = makeRepoMock();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) })));

    const service = new LogmeinReconciliationService(
      {
        enabled: true,
        reconciliationEnabled: true,
        companyId: 'c',
        psk: 'p',
        timeoutMs: 100,
        chunkMinutes: Number.NaN,
        overlapMinutes: 999,
        maxRetries: Number.NaN,
        circuitCooldownSeconds: Number.NaN,
      },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions(
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-01T05:00:00Z'),
    );
    const completedAudit = repository.insertReconciliationAudit.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((payload) => payload.status === 'completed');

    expect(result.chunkMinutes).toBe(120);
    expect(result.overlapMinutes).toBe(119);
    expect(result.maxRetries).toBe(2);
    expect(result.cooldownSeconds).toBe(900);
    expect(completedAudit?.chunkMinutes).toBe(120);
    expect(completedAudit?.overlapMinutes).toBe(119);
    expect(completedAudit?.maxRetries).toBe(2);
    expect(completedAudit?.cooldownSeconds).toBe(900);

    vi.unstubAllGlobals();
  });

  it('imports sessions and populates the queue when the API returns valid sessions', async () => {
    const repository = makeRepoMock();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          {
            sessionId: 'sess-1',
            hostId: 'host-1',
            groupId: 'group-1',
            startTime: '2026-05-31T10:00:00Z',
            endTime: '2026-05-31T10:30:00Z',
          },
        ],
      }),
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.sessionsFound).toBe(1);
    expect(result.sessionsInserted).toBe(1);
    expect(repository.upsertSession).toHaveBeenCalledTimes(1);
    expect(repository.upsertQueueItem).toHaveBeenCalledTimes(1);
    // Never persists raw IP / technician in plaintext (technician is hashed).
    const upsertArg = repository.upsertSession.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(upsertArg)).not.toMatch(/userIp|user_ip|clientIp/i);

    vi.unstubAllGlobals();
  });

  it('returns LOGMEIN_REPORT_PARSE_FAILED when the report body is not valid JSON', async () => {
    const repository = makeRepoMock();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.reportError).toBe(REPORT_ERROR_CATEGORIES.PARSE_FAILED);
    expect(result.fallbackUsed).toBe(false);

    vi.unstubAllGlobals();
  });

  it("strips the GoTo/LogMeIn )]}' anti-hijack guard before parsing a successful report", async () => {
    const repository = makeRepoMock();
    const sessionJson = JSON.stringify({
      items: [{
        sessionId: 'guard-1',
        hostId: 'h-1',
        groupId: 'g-1',
        startTime: '2026-05-31T10:00:00Z',
        endTime: '2026-05-31T10:20:00Z',
      }],
    });
    // Real LogMeIn reports prefix the body with the anti-hijack guard.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => `)]}',\n${sessionJson}`,
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    // Guard stripped → JSON parsed → session imported (NOT a parse failure).
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.sessionsFound).toBe(1);
    expect(result.reportError).toBeNull();
    expect(repository.upsertSession).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('captures a sanitized diagnostic reason from the 500 body without leaking secrets', async () => {
    const repository = makeRepoMock();
    // The 500 body carries a useful error reason AND a credential that must be stripped.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      // text() is what extractSanitizedErrorReason reads.
      text: async () => JSON.stringify({
        error: 'Unknown report type remote-access-with-groups',
        psk: 'psk-LEAKED-VALUE',
        message: 'Report definition not found',
      }),
    })));

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    expect(result.ok).toBe(false);
    expect(result.reportError).toBe(REPORT_ERROR_CATEGORIES.HTTP_500);
    // The diagnostic reason surfaces the useful upstream message...
    expect(result.reportReason).toContain('Unknown report type');
    expect(result.reportReason).toContain('Report definition not found');
    // ...but the leaked credential is stripped and never present anywhere.
    expect(JSON.stringify(result)).not.toContain('psk-LEAKED-VALUE');
    expect(result.reportReason ?? '').not.toContain('psk-LEAKED-VALUE');

    vi.unstubAllGlobals();
  });

  it('classifies a 401/403 report response distinctly from 500', async () => {
    const repository = makeRepoMock();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    expect(result.ok).toBe(false);
    expect(result.reportError).toBe(REPORT_ERROR_CATEGORIES.HTTP_401_403);
    expect(result.reportStatusCode).toBe(403);
    expect(result.message).toContain('401/403');
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('does not retry or fallback aggressively on non-auth 4xx report responses', async () => {
    const repository = makeRepoMock();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 409, text: async () => '{"message":"conflict"}' }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReconciliationService(
      { enabled: true, reconciliationEnabled: true, companyId: 'c', psk: 'p', timeoutMs: 100 },
      undefined,
      repository as never,
    );
    const result = await service.syncRemoteAccessSessions();

    expect(result.ok).toBe(false);
    expect(result.reportError).toBe(REPORT_ERROR_CATEGORIES.HTTP_400);
    expect(result.reportStatusCode).toBe(409);
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
