import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { LogmeinReadonlyContextService } from '../src/domain/services/LogmeinReadonlyContextService.js';

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('V6-E3 LogMeIn read-only governance', () => {
  it('keeps LogMeIn adapter read-only with disabled and unconfigured fallbacks', async () => {
    const disabled = new LogmeinReadonlyContextService({ enabled: false });
    await expect(disabled.listHostsByGroup('group-a')).resolves.toMatchObject({
      ok: false,
      status: 'disabled',
      hosts: [],
    });

    const unconfigured = new LogmeinReadonlyContextService({ enabled: true });
    await expect(unconfigured.listHostsByGroup('group-a')).resolves.toMatchObject({
      ok: false,
      status: 'unconfigured',
      message: 'CONFIG_REQUIRED_FOR_LOGMEIN_CREDENTIALS',
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        hosts: [{
          id: 'host-1',
          group_name: 'Cliente token=hidden',
          host_name: 'notebook cliente@example.com',
          equipment_tag: 'ETQ-1234',
          status: 'online',
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new LogmeinReadonlyContextService({
      enabled: true,
      baseUrl: 'https://logmein.example.invalid/api?token=secret',
      token: 'secret-token',
      timeoutMs: 50,
    });

    const result = await service.listHostsByGroup('group-a');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/groups/group-a/hosts'),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.status).toBe('available');
    expect(result.hosts[0]?.groupName).not.toContain('hidden');
    expect(result.hosts[0]?.hostName).toContain('[EMAIL]');

    vi.unstubAllGlobals();
  });

  it('creates only additive idempotent tables for local cache, mapping and governance review', async () => {
    const migration = compact(await readProjectFile('schema-migrations/042_logmein_readonly_governance.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_group_maps');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_asset_cache');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_logmein_sync_audit');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS glpi_plugin_integaglpi_governance_reviews');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS');
    expect(migration).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
    expect(migration).not.toContain('glpi_tickets');
    expect(migration).not.toContain('glpi_users');
  });

  it('wires plugin RBAC, CSRF, audit and ticket context without remote access controls', async () => {
    const permission = await readProjectFile('../integaglpi/src/Service/SecurityPermissionService.php');
    const audit = await readProjectFile('../integaglpi/src/Service/SecurityAuditService.php');
    const service = await readProjectFile('../integaglpi/src/Service/LogmeinGovernanceService.php');
    const front = await readProjectFile('../integaglpi/front/logmein.mapping.php');
    const template = await readProjectFile('../integaglpi/templates/logmein_mapping.php');
    const ticketContext = await readProjectFile('../integaglpi/src/Service/TicketContextService.php');
    const ticketTab = await readProjectFile('../integaglpi/templates/ticket_tab.php');
    const menu = await readProjectFile('../integaglpi/src/GestaoGroupMenu.php');

    expect(permission).toContain('RIGHT_VIEW_LOGMEIN_CONTEXT');
    expect(permission).toContain('RIGHT_MANAGE_LOGMEIN_MAPPING');
    expect(permission).toContain('enforceEntityScope');
    expect(audit).toContain('LOGMEIN_CONTEXT_VIEWED');
    expect(audit).toContain('LOGMEIN_MAPPING_CREATED');
    expect(audit).toContain('LOGMEIN_MAPPING_UPDATED');
    expect(audit).toContain('LOGMEIN_MAPPING_DISABLED');
    expect(service).toContain('technician_confirmation_required');
    expect(service).toContain('memory_write_requires_confirmation');
    expect(service).toContain('Plugin::getRuntimeConfigValue(\'LOGMEIN_INTEGRATION_ENABLED\')');
    expect(service).toContain('SecurityPermissionService::enforceEntityScope($entityId)');
    expect(service).toContain('$entityId = $this->findMappingEntityId($mappingId);');
    expect(service).toContain('SecurityPermissionService::enforceEntityScope($entityId)');
    expect(service).toContain('entity_scope_denied');
    expect(service.indexOf('SecurityPermissionService::enforceEntityScope($entityId)')).toBeLessThan(
      service.indexOf('$exists = $this->mappingExists($groupId, $entityId);'),
    );
    expect(service.indexOf('$entityId = $this->findMappingEntityId($mappingId);')).toBeLessThan(
      service.indexOf('UPDATE " . self::GROUP_MAP_TABLE'),
    );
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(front).toContain('RIGHT_MANAGE_LOGMEIN_MAPPING');
    expect(template).toContain('não executa sessão remota');
    expect(ticketContext).toContain('LogmeinGovernanceService');
    expect(ticketTab).toContain('Contexto LogMeIn read-only');
    expect(ticketTab).toContain('Sem sessão remota, sem comando');
    expect(menu).toContain('logmein.mapping.php');
    expect(`${front}\n${template}\n${service}\n${ticketTab}`).not.toMatch(/Iniciar acesso remoto|start session|remote execution|RMM|shell_exec|exec\(|curl_setopt\([^;]+CURLOPT_POST/i);
  });

  it('documents governance, RACI, monthly permission review and required crisis runbooks', async () => {
    const doc = await readProjectFile('../docs/v6_governance_release_logmein.md');

    for (const required of [
      'Release Checklist',
      'Release Notes',
      'Matriz RACI',
      'Owners por processo',
      'Revisão mensal de permissões',
      'Change Enablement',
      'Meta API fora',
      'Redis fora',
      'Postgres lento/fora',
      'GLPI indisponível',
      'Ollama fora',
      'worker Node travado',
      'LogMeIn indisponível',
      'rollback emergencial',
    ]) {
      expect(doc).toContain(required);
    }
    expect(doc).toContain('read-only');
    expect(doc).toContain('confirmação técnica');
    expect(doc).not.toMatch(/token\s*[:=]\s*\w+/i);
  });
});
