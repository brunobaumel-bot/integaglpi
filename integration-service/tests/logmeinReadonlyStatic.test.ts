import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { LogmeinReadonlyContextService } from '../src/domain/services/LogmeinReadonlyContextService.js';
import { PostgresLogmeinReadonlyRepository } from '../src/repositories/postgres/PostgresLogmeinReadonlyRepository.js';

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
        groups: [{ id: 'group-a', name: 'Cliente token=hidden' }],
        hosts: [{
          id: 'host-1',
          groupId: 'group-a',
          groupName: 'Cliente token=hidden',
          description: 'notebook 1234 cliente@example.com',
          isHostOnline: true,
        }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new LogmeinReadonlyContextService({
      enabled: true,
      baseUrl: 'https://secure.logmein.com/public-api/v2',
      companyId: 'company-id',
      psk: 'psk-secret',
      timeoutMs: 50,
    });

    const result = await service.listHostsByGroup('group-a');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://secure.logmein.com/public-api/v2/hostswithgroups',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic\s+[A-Za-z0-9+/=]+$/),
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');
    expect(result.status).toBe('available');
    expect(result.hosts[0]?.groupName).not.toContain('hidden');
    expect(result.hosts[0]?.hostName).toContain('[EMAIL]');
    expect(result.hosts[0]?.equipmentTag).toBe('1234');

    vi.unstubAllGlobals();
  });

  it('syncs hostswithgroups into local cache without LogMeIn write methods', async () => {
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 1, hostsImported: 1 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        groups: [{ id: 'group-a', name: 'N3 Cliente' }],
        hosts: [{ id: 'host-1', groupId: 'group-a', groupName: 'N3 Cliente', description: 'TAG 4567', status: 'online' }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReadonlyContextService({
      enabled: true,
      baseUrl: 'https://secure.logmein.com/public-api/v2',
      companyId: 'company-id',
      psk: 'psk-secret',
      timeoutMs: 50,
    }, undefined, repository);

    const result = await service.syncHostsWithGroups();

    expect(result.ok).toBe(true);
    expect(result.groupsImported).toBe(1);
    expect(result.hostsImported).toBe(1);
    expect(repository.upsertHosts).toHaveBeenCalledWith(expect.objectContaining({
      hosts: [expect.objectContaining({ equipmentTag: '4567' })],
    }));
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET' });
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('body');

    vi.unstubAllGlobals();
  });

  it('resolves lowercase groupid hosts through the groups map and imports groups above zero', async () => {
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 2, hostsImported: 3 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        groups: [
          { groupid: 'g-1', groupname: 'DCTECH' },
          { groupID: 'g-2', GroupName: 'Cliente B' },
        ],
        hosts: [
          { id: 'host-1', groupid: 'g-1', description: 'SERVIDOR POWERCOM DOMINIO 4567', isHostOnline: true },
          { id: 'host-2', groupID: 'g-2', description: 'NOTEBOOK 9999', isHostOnline: false },
          { id: 'host-3', groupid: 'g-1', description: 'DESKTOP SEM TAG', status: 'unknown' },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReadonlyContextService({
      enabled: true,
      baseUrl: 'https://secure.logmein.com/public-api/v2',
      companyId: 'company-id',
      psk: 'psk-secret',
      timeoutMs: 50,
    }, undefined, repository);

    const result = await service.syncHostsWithGroups();

    expect(result.groupsImported).toBe(2);
    expect(repository.upsertHosts).toHaveBeenCalledWith(expect.objectContaining({
      groups: expect.arrayContaining([
        { externalId: 'g-1', name: 'DCTECH' },
        { externalId: 'g-2', name: 'Cliente B' },
      ]),
      hosts: expect.arrayContaining([
        expect.objectContaining({ groupExternalId: 'g-1', groupName: 'DCTECH', equipmentTag: '4567' }),
        expect.objectContaining({ groupExternalId: 'g-2', groupName: 'Cliente B', equipmentTag: '9999' }),
      ]),
    }));

    vi.unstubAllGlobals();
  });

  it('normalizes nested hostsGroups payloads with numeric group ids', async () => {
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 2, hostsImported: 2 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        hostsGroups: [
          {
            groupId: 101,
            groupName: 'DCTECH',
            hosts: [
              { hostId: 501, hostDescription: 'SERVIDOR POWERCOM DOMINIO 1234', isOnline: true },
            ],
          },
          {
            groupid: 102,
            name: 'Cliente C',
            hosts: [
              { id: 502, description: 'NOTEBOOK CLIENTE 5678', isHostOnline: false },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReadonlyContextService({
      enabled: true,
      baseUrl: 'https://secure.logmein.com/public-api/v2',
      companyId: 'company-id',
      psk: 'psk-secret',
      timeoutMs: 50,
    }, undefined, repository);

    await expect(service.syncHostsWithGroups()).resolves.toMatchObject({ ok: true, groupsImported: 2 });
    expect(repository.upsertHosts).toHaveBeenCalledWith(expect.objectContaining({
      groups: expect.arrayContaining([
        { externalId: '101', name: 'DCTECH' },
        { externalId: '102', name: 'Cliente C' },
      ]),
      hosts: expect.arrayContaining([
        expect.objectContaining({ externalId: '501', groupExternalId: '101', groupName: 'DCTECH', equipmentTag: '1234' }),
        expect.objectContaining({ externalId: '502', groupExternalId: '102', groupName: 'Cliente C', equipmentTag: '5678' }),
      ]),
    }));

    vi.unstubAllGlobals();
  });

  it('prefers read-only LogMeIn custom fields for the 4 digit asset tag and audits custom field reads', async () => {
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 1, hostsImported: 2 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const auditService = {
      recordAuditEventSafe: vi.fn(async () => undefined),
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        groups: [{ id: 'group-a', name: 'Cliente A' }],
        hosts: [
          {
            id: 'host-1',
            groupId: 'group-a',
            description: 'descricao sem etiqueta 9999',
            customFields: [{ name: 'Etiqueta', value: '1234' }],
          },
          {
            id: 'host-2',
            groupId: 'group-a',
            description: 'fallback 8888',
            customFields: { Patrimônio: 'ABC-12' },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new LogmeinReadonlyContextService({
      enabled: true,
      baseUrl: 'https://secure.logmein.com/public-api/v2',
      companyId: 'company-id',
      psk: 'psk-secret',
      timeoutMs: 50,
    }, auditService as never, repository);

    await expect(service.syncHostsWithGroups()).resolves.toMatchObject({ ok: true });
    expect(repository.upsertHosts).toHaveBeenCalledWith(expect.objectContaining({
      hosts: expect.arrayContaining([
        expect.objectContaining({ externalId: 'host-1', equipmentTag: '1234', tagQuality: 'valid', tagSource: 'custom_field' }),
        expect.objectContaining({ externalId: 'host-2', equipmentTag: 'ABC-12', tagQuality: 'invalid', tagSource: 'custom_field' }),
      ]),
    }));
    expect(auditService.recordAuditEventSafe).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'LOGMEIN_CUSTOMFIELD_READ',
      payload: expect.objectContaining({ read_only: true, no_remote_execution: true }),
    }));

    vi.unstubAllGlobals();
  });

  it('lists synchronized groups from asset cache rather than mappings table', async () => {
    const service = await readProjectFile('../integaglpi/src/Service/LogmeinGovernanceService.php');
    expect(service).toContain('FROM " . self::ASSET_CACHE_TABLE');
    expect(service).toContain('logmein_group_external_id,');
    expect(service).toContain('COUNT(*) AS hosts_count');
    expect(service).toContain('COUNT(DISTINCT NULLIF(logmein_group_external_id');
    const listCachedGroupsBody = service.slice(
      service.indexOf('public function listCachedGroups()'),
      service.indexOf('public function listHostsPreview('),
    );
    expect(listCachedGroupsBody).toContain('self::ASSET_CACHE_TABLE');
    expect(listCachedGroupsBody).not.toContain('self::GROUP_MAP_TABLE');
  });

  it('blocks concurrent LogMeIn sync attempts with controlled status', async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const repository = {
      isSchemaReady: vi.fn(async () => true),
      upsertHosts: vi.fn(async () => ({ groupsImported: 1, hostsImported: 1 })),
      insertSyncAudit: vi.fn(async () => undefined),
      listHostsByGroup: vi.fn(async () => []),
    };
    const fetchMock = vi.fn(async () => {
      await fetchGate;
      return {
        ok: true,
        json: async () => ({
          groups: [{ id: 'group-a', name: 'N3 Cliente' }],
          hosts: [{ id: 'host-1', groupId: 'group-a', groupName: 'N3 Cliente', description: 'TAG 4567', status: 'online' }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new LogmeinReadonlyContextService({
      enabled: true,
      baseUrl: 'https://secure.logmein.com/public-api/v2',
      companyId: 'company-id',
      psk: 'psk-secret',
      timeoutMs: 50,
    }, undefined, repository);

    const first = service.syncHostsWithGroups();
    const second = await service.syncHostsWithGroups();
    releaseFetch();
    const firstResult = await first;

    expect(second).toMatchObject({ ok: false, status: 'sync_in_progress' });
    expect(firstResult).toMatchObject({ ok: true, status: 'completed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('upserts LogMeIn hosts in batches of at most 100 rows', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repository = new PostgresLogmeinReadonlyRepository({ query });
    const hosts = Array.from({ length: 205 }, (_, index) => ({
      externalId: `host-${index}`,
      groupExternalId: `group-${index % 3}`,
      groupName: `Grupo ${index % 3}`,
      hostName: `Host ${index}`,
      equipmentTag: String(1000 + index).slice(0, 4),
      status: 'online' as const,
      lastSeenAt: null,
    }));

    const result = await repository.upsertHosts({
      groups: [
        { externalId: 'group-0', name: 'Grupo 0' },
        { externalId: 'group-1', name: 'Grupo 1' },
        { externalId: 'group-2', name: 'Grupo 2' },
      ],
      hosts,
      sourceSnapshotHash: 'snapshot-hash',
    });

    expect(result.hostsImported).toBe(205);
    expect(result.groupsImported).toBe(3);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.map((call) => (call[1] as unknown[]).length)).toEqual([800, 800, 40]);
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
    const client = await readProjectFile('../integaglpi/src/Service/IntegrationServiceClient.php');
    const ticketContext = await readProjectFile('../integaglpi/src/Service/TicketContextService.php');
    const ticketTab = await readProjectFile('../integaglpi/templates/ticket_tab.php');
    const menu = await readProjectFile('../integaglpi/src/GestaoGroupMenu.php');
    const nodeService = await readProjectFile('src/domain/services/LogmeinReadonlyContextService.ts');
    const controller = await readProjectFile('src/controllers/createLogmeinReadonlyController.ts');
    const app = await readProjectFile('src/app.ts');
    const saveMappingBody = service.slice(
      service.indexOf('public function saveMapping('),
      service.indexOf('public function disableMapping('),
    );

    expect(permission).toContain('RIGHT_VIEW_LOGMEIN_CONTEXT');
    expect(permission).toContain('RIGHT_MANAGE_LOGMEIN_MAPPING');
    expect(permission).toContain('enforceEntityScope');
    expect(audit).toContain('LOGMEIN_CONTEXT_VIEWED');
    expect(audit).toContain('LOGMEIN_MAPPING_CREATED');
    expect(audit).toContain('LOGMEIN_MAPPING_UPDATED');
    expect(audit).toContain('LOGMEIN_MAPPING_DISABLED');
    expect(service).toContain('technician_confirmation_required');
    expect(service).toContain('memory_write_requires_confirmation');
    expect(service).toContain('extractEquipmentTags');
    expect(service).toContain('listCachedGroups');
    expect(service).toContain('listAllowedEntities');
    expect(service).toContain('entityExists($entityId)');
    expect(service).toContain('getCacheSummary');
    expect(service).toContain('syncReadonlyCatalog');
    expect(service).toContain('getInventoryQualityReport');
    expect(service).toContain('classifyEquipmentTag');
    expect(service).toContain('Plugin::getRuntimeConfigValue(\'LOGMEIN_INTEGRATION_ENABLED\')');
    expect(service).toContain('Selecione uma entidade GLPI existente.');
    expect(service).toContain('SecurityPermissionService::enforceEntityScope($entityId)');
    expect(service).toContain('$entityId = $this->findMappingEntityId($mappingId);');
    expect(service).toContain('SecurityPermissionService::enforceEntityScope($entityId)');
    expect(service).toContain('entity_scope_denied');
    expect(saveMappingBody.indexOf('entityExists($entityId)')).toBeLessThan(
      saveMappingBody.indexOf('SecurityPermissionService::enforceEntityScope($entityId)'),
    );
    expect(saveMappingBody.indexOf('SecurityPermissionService::enforceEntityScope($entityId)')).toBeLessThan(
      saveMappingBody.indexOf('$exists = $this->mappingExists($groupId, $entityId);'),
    );
    expect(service.indexOf('$entityId = $this->findMappingEntityId($mappingId);')).toBeLessThan(
      service.indexOf('UPDATE " . self::GROUP_MAP_TABLE'),
    );
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(front).toContain('$entityOptions = $service->listAllowedEntities();');
    expect(front).toContain('$inventoryQualityReport = $service->getInventoryQualityReport();');
    expect(front).toContain('sync_logmein');
    expect(front).toContain('RIGHT_MANAGE_LOGMEIN_MAPPING');
    expect(template).toContain('Sincronizar grupos do LogMeIn');
    expect(template).toContain('Grupo LogMeIn sincronizado');
    expect(template).toContain('name="glpi_entity_id"');
    expect(template).toContain('data-entity-select');
    expect(template).toContain('data-entity-filter');
    expect(template).toContain('Digite para buscar uma entidade GLPI');
    expect(template).toContain('A lista usa somente entidades reais dentro do escopo GLPI da sessão atual.');
    expect(template).toContain('Qualidade cadastral LogMeIn');
    expect(template).toContain('Hosts sem etiqueta');
    expect(template).toContain('Etiquetas inválidas');
    expect(template).toContain('Etiquetas duplicadas');
    expect(template).toContain('Grupos sem entidade');
    expect(template).toContain('Relatórios são agregados/sanitizados');
    expect(template).not.toMatch(/<input[^>]+name=["']glpi_entity_id["']/i);
    expect(template).toContain('Prévia de hosts do grupo');
    expect(template).toContain('Cache local:');
    expect(template).toContain('produção deve permanecer OFF por padrão');
    expect(template).toContain('não executa sessão remota');
    expect(client).toContain('/internal/glpi/logmein/sync');
    expect(ticketContext).toContain('LogmeinGovernanceService');
    expect(ticketTab).toContain('Contexto LogMeIn read-only');
    expect(ticketTab).toContain('Sem sessão remota, sem comando');
    expect(menu).toContain('logmein.mapping.php');
    expect(nodeService).toContain('hostswithgroups');
    expect(nodeService).toContain('extractCustomFields');
    expect(nodeService).toContain('extractEquipmentTagFromCustomFields');
    expect(nodeService).toContain('LOGMEIN_CUSTOMFIELD_READ');
    expect(nodeService).toContain('groupid');
    expect(nodeService).toContain('groupID');
    expect(nodeService).toContain('hostsGroups');
    expect(nodeService).toContain("method: 'GET'");
    expect(nodeService).toContain('basicAuthHeader');
    expect(nodeService).toContain('Buffer.from');
    expect(nodeService).toContain('Basic ${');
    expect(nodeService).toContain('sync_in_progress');
    expect(nodeService).not.toContain('Authorization: `CompanyID ${this.config.companyId}; PSK ${this.config.psk}`');
    const repository = await readProjectFile('src/repositories/postgres/PostgresLogmeinReadonlyRepository.ts');
    expect(repository).toContain('HOST_UPSERT_BATCH_SIZE = 100');
    expect(repository).toContain('VALUES ${values.join');
    expect(controller).toContain('read_only: true');
    expect(controller).toContain('remote_execution: false');
    expect(app).toContain('/internal/glpi/logmein/sync');
    expect(`${front}\n${template}\n${service}\n${ticketTab}`).not.toMatch(/Iniciar acesso remoto|start session|remote execution|RMM|shell_exec|exec\(|curl_setopt\([^;]+CURLOPT_POST/i);
    expect(nodeService).not.toMatch(/method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i);
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
