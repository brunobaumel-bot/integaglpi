import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readRel(pathFromRepo: string): Promise<string> {
  return readFile(resolve(repoRoot, pathFromRepo), 'utf8');
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('PHP contract hours backoffice (static)', () => {
  it('keeps contract hours schema additive and scoped to IntegraGLPI tables', async () => {
    const migration = compactSql(await readRel('integration-service/schema-migrations/016_contract_hours.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_entity_contracts');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hour_adjustments');
    expect(migration).toContain('id BIGSERIAL PRIMARY KEY');
    expect(migration).toContain('glpi_entity_id BIGINT NOT NULL');
    expect(migration).toContain('glpi_contract_id BIGINT NULL');
    expect(migration).toContain('allocated_hours NUMERIC(10,2) NOT NULL');
    expect(migration).toContain("source IN ('manual_adjustment', 'glpi_task_actiontime', 'supervisor_review')");
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migration).not.toContain('glpi_contracts');
  });

  it('keeps init-db aligned for new environments', async () => {
    const initDb = compactSql(await readRel('integration-service/init-db.sql'));

    expect(initDb).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_entity_contracts');
    expect(initDb).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_hour_adjustments');
    expect(initDb).toContain('glpi_intega_entity_contracts_entity_active_idx');
    expect(initDb).toContain('glpi_intega_hour_adjust_contract_created_idx');
  });

  it('registers menu/front permissions and CSRF guarded writes', async () => {
    const setup = await readRel('integaglpi/setup.php');
    const plugin = await readRel('integaglpi/src/Plugin.php');
    const front = await readRel('integaglpi/front/contracts.hours.php');

    expect(setup).toContain('ContractsHoursMenu::class');
    expect(plugin).toContain('getContractHoursUrl');
    expect(plugin).toContain('canContractRead');
    expect(plugin).toContain('canContractUpdate');
    expect(front).toContain('Plugin::requireContractRead()');
    expect(front).toContain('Plugin::requireContractUpdate()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
  });

  it('casts contract permission helpers to real booleans', async () => {
    const plugin = await readRel('integaglpi/src/Plugin.php');
    const renderer = await readRel('integaglpi/src/Renderer/ContractHoursRenderer.php');

    expect(plugin).toContain('public static function canContractRead(): bool');
    expect(plugin).toContain('return self::hasRightBool(self::RIGHT_NAME, READ);');
    expect(plugin).toContain('public static function canContractUpdate(): bool');
    expect(plugin).toContain('return self::hasRightBool(self::RIGHT_NAME, UPDATE);');
    expect(plugin).toContain('private static function hasRightBool(string $rightName, int $right): bool');
    expect(plugin).toContain('return (bool) Session::haveRight($rightName, $right);');
    expect(plugin).not.toContain('canContractUpdate(): bool\n    {\n        return Session::haveRight');
    expect(plugin).not.toContain('return Session::haveRight(self::RIGHT_NAME, UPDATE);');
    expect(renderer).toContain('public function canUpdate(): bool');
    expect(renderer).toContain("method_exists(Plugin::class, 'canContractUpdate')");
    expect(renderer).toContain('return false;');
    expect(renderer).toContain('catch (\\Throwable $exception)');
    expect(renderer).not.toContain('public function canUpdate(): bool\n    {\n        return Plugin::canContractUpdate();');
  });

  it('keeps contract page read-only for alerts and excludes WhatsApp as billable source', async () => {
    const template = await readRel('integaglpi/templates/contracts_hours.php');
    const service = await readRel('integaglpi/src/Service/ContractHoursService.php');

    expect(template).toContain('Contratos e Horas');
    expect(template).toContain('não usa tempo de conversa WhatsApp como consumo técnico');
    expect(template).toContain('Alertas são apenas internos');
    expect(template).toContain('não possui permissão para criar, editar ou ajustar contratos');
    expect(template).toContain("$errorDiagnostic = trim((string) ($data['error_diagnostic'] ?? ''))");
    expect(template).toContain("$flashDiagnostic = trim((string) ($flash['diagnostic'] ?? ''))");
    expect(service).toContain('glpi_tickettasks');
    expect(service).toContain('actiontime');
    expect(service).toContain("'manual_adjustment'");
    expect(template).not.toContain('payload_json');
    expect(template).not.toContain('access_token');
    expect(template).not.toContain('x-api-key');
  });

  it('keeps pagination and entity scoped repository queries', async () => {
    const repository = await readRel('integaglpi/src/External/Repository/ContractHoursRepository.php');
    const service = await readRel('integaglpi/src/Service/ContractHoursService.php');
    const pluginConfigService = await readRel('integaglpi/src/Service/PluginConfigService.php');

    expect(repository).toContain('LIMIT :limit OFFSET :offset');
    expect(repository).toContain('glpi_entity_id');
    expect(repository).toContain('bindValue');
    expect(pluginConfigService).toContain('public function getConnectionConfig(): array');
    expect(service).toContain('ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())');
    expect(service).not.toContain('getExternalDbConfig');
    expect(service).toContain('Session::getActiveEntities');
    expect(service).toContain('Session::haveAccessToEntity');
    expect(service).toContain("min((int) ($query['limit'] ?? 25), 50)");
  });

  it('requires scoped contract loading before updating an existing contract', async () => {
    const service = await readRel('integaglpi/src/Service/ContractHoursService.php');
    const saveContractStart = service.indexOf('private function saveContract(array $post, int $userId): array');
    const scopedLoad = service.indexOf('$existingContract = $this->getScopedContract($id);', saveContractStart);
    const repositorySave = service.indexOf('$this->getRepository()->saveContract($payload, $id > 0 ? $id : null);', saveContractStart);
    const setActiveStart = service.indexOf('private function setContractActive');
    const addAdjustmentStart = service.indexOf('private function addAdjustment');

    expect(saveContractStart).toBeGreaterThanOrEqual(0);
    expect(scopedLoad).toBeGreaterThan(saveContractStart);
    expect(repositorySave).toBeGreaterThan(saveContractStart);
    expect(scopedLoad).toBeLessThan(repositorySave);
    expect(service.slice(setActiveStart, addAdjustmentStart)).toContain('$this->getScopedContract');
    expect(service.slice(addAdjustmentStart)).toContain('$this->getScopedContract');
  });

  it('uses a scoped GLPI entity selector and derives entity names server-side', async () => {
    const template = await readRel('integaglpi/templates/contracts_hours.php');
    const service = await readRel('integaglpi/src/Service/ContractHoursService.php');

    expect(template).toContain('data-contract-entity-picker');
    expect(template).toContain('data-entity-filter');
    expect(template).toContain('name="glpi_entity_id"');
    expect(template).toContain('data-entity-name-output');
    expect(template).not.toContain('name="glpi_entity_name"');
    expect(service).toContain('private function loadGlpiEntityOptions(): array');
    expect(service).toContain('private function findGlpiEntityOption(int $entityId): ?array');
    expect(service).toContain("if ($entityId <= 0 || !$this->canUseEntity($entityId))");
    expect(service).toContain("'glpi_entity_name' => (string) $entityOption['name']");
  });

  it('normalizes contract boolean fields before PostgreSQL persistence', async () => {
    const template = await readRel('integaglpi/templates/contracts_hours.php');
    const service = await readRel('integaglpi/src/Service/ContractHoursService.php');
    const repository = await readRel('integaglpi/src/External/Repository/ContractHoursRepository.php');

    expect(template).toContain('type="hidden" name="is_active" value="0"');
    expect(template).toContain('type="checkbox" name="is_active" value="1"');
    expect(service).toContain('private function normalizeBool(mixed $value): bool');
    expect(service).toContain("'is_active' => $this->normalizeBool($post['is_active'] ?? false)");
    expect(repository).toContain("bindValue(':is_active', (bool) ($payload['is_active'] ?? true), PDO::PARAM_BOOL)");
  });

  it('classifies contract load and save failures without exposing raw storage details to operators', async () => {
    const service = await readRel('integaglpi/src/Service/ContractHoursService.php');

    expect(service).toContain('friendlyStorageExceptionMessage');
    expect(service).toContain('logContractThrowable');
    expect(service).toContain('buildThrowableDiagnostic');
    expect(service).toContain("'operation' => $operation");
    expect(service).toContain("'exception_class' => $this->sanitizeExceptionClass($exception)");
    expect(service).toContain("'relative_file' => $this->relativeThrowableFile($exception->getFile())");
    expect(service).toContain("'line' => $exception->getLine()");
    expect(service).toContain("'sanitized_message' => $this->sanitizeThrowableMessage($exception->getMessage())");
    expect(service).toContain('previous_exception_class');
    expect(service).toContain('previous_sanitized_message');
    expect(service).toContain('formatAdminThrowableDiagnostic');
    expect(service).toContain('canSeeAdminDiagnostic');
    expect(service).toContain('erro PHP interno em Contratos/Horas');
    expect(service).toContain('sanitizeThrowableMessage');
    expect(service).toContain('storageExceptionForClassification');
    expect(service).toContain('$exception->getPrevious() === null');
    expect(service).toContain("$sqlState === '42P01'");
    expect(service).toContain("$sqlState === '42703'");
    expect(service).toContain("$sqlState === '22P02'");
    expect(service).toContain('extractSqlState');
    expect(service).toContain('extractMissingRelation');
    expect(service).toContain('extractMissingColumn');
    expect(service).toContain('sanitizeStorageIdentifier');
    expect(service).toContain('SQLSTATE %s');
    expect(service).toContain('permissão insuficiente no PostgreSQL externo');
    expect(service).toContain('tabela de contratos/horas ausente');
    expect(service).toContain('coluna esperada não existe');
    expect(service).toContain('valor inválido recebido do formulário');
    expect(service).toContain('referência inválida no schema de contratos/horas');
    expect(service).not.toContain('erro operacional mapeado como %s');
    expect(service).not.toContain('mapeado como Error');
    expect(service).not.toContain('erro operacional não classificado');
    expect(service).not.toContain("__('Não foi possível salvar a operação de contrato agora.', 'glpiintegaglpi')");
  });

  it('blocks entity reassignment on existing contracts and keeps task actiontime reads guarded', async () => {
    const service = await readRel('integaglpi/src/Service/ContractHoursService.php');

    expect(service).toContain('Contrato existente não pode trocar de entidade');
    expect(service).toContain('(int) ($existingContract[\'glpi_entity_id\'] ?? 0) !== $entityId');
    expect(service).toContain('method_exists($DB, \'request\')');
    expect(service).toContain('$DB->request([');
    expect(service).not.toContain('$DB->query($sql)');
  });

  it('keeps routing entries consolidated under Configuração while registering both classes', async () => {
    const setup = await readRel('integaglpi/setup.php');
    const configuracaoGroupMenu = await readRel('integaglpi/src/ConfiguracaoGroupMenu.php');
    const monitoramentoGroupMenu = await readRel('integaglpi/src/MonitoramentoGroupMenu.php');
    const menuStart = setup.indexOf('$PLUGIN_HOOKS[Hooks::MENU_TOADD]');
    const menuEnd = setup.indexOf("$PLUGIN_HOOKS['config_page']", menuStart);
    const menuBlock = setup.slice(menuStart, menuEnd);

    expect(menuBlock).toContain('MonitoramentoGroupMenu::class');
    expect(menuBlock).not.toContain('RoutingSafetyMenu::class');
    expect(menuBlock).not.toContain('RoutingOptionsMenu::class');
    expect(monitoramentoGroupMenu).not.toContain("'filas_roteamento'");
    expect(monitoramentoGroupMenu).not.toContain('Filas e Roteamento');
    expect(configuracaoGroupMenu).toContain("'filas_roteamento'");
    expect(configuracaoGroupMenu).toContain('Rotas, Filas e Parâmetros');
    expect(configuracaoGroupMenu).toContain('Plugin::getRoutingOptionsAdminUrl()');
    expect(configuracaoGroupMenu).toContain("'roteamento_seguro'");
    expect(configuracaoGroupMenu).toContain('Roteamento Seguro');
    expect(configuracaoGroupMenu).toContain('Plugin::getRoutingSafetyUrl()');
    expect(setup).toContain('\\Plugin::registerClass(RoutingSafetyMenu::class);');
    expect(setup).toContain('\\Plugin::registerClass(RoutingOptionsMenu::class);');
  });

  it('integrates contracts and hours with supervisor backoffice without changing ticket flows', async () => {
    const renderer = await readRel('integaglpi/src/Renderer/SupervisorBackofficeRenderer.php');
    const supervisorTemplate = await readRel('integaglpi/templates/supervisor_backoffice.php');

    expect(renderer).toContain('getContractHoursUrl');
    expect(supervisorTemplate).toContain('Contratos e Horas');
    expect(supervisorTemplate).toContain('$this->getContractHoursUrl()');
  });
});
