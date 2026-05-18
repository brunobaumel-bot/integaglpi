import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readAttendanceCenterService(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Service/AttendanceCenterService.php', import.meta.url), 'utf8');
}

async function readCentralTemplate(): Promise<string> {
  return readFile(new URL('../../integaglpi/templates/central.php', import.meta.url), 'utf8');
}

async function readOperationLogPage(): Promise<string> {
  return readFile(new URL('../../integaglpi/front/operation.log.php', import.meta.url), 'utf8');
}

async function readAuditPage(): Promise<string> {
  return readFile(new URL('../../integaglpi/front/audit.php', import.meta.url), 'utf8');
}

async function readAuditTemplate(): Promise<string> {
  return readFile(new URL('../../integaglpi/templates/audit.php', import.meta.url), 'utf8');
}

async function readOperationalAuditRenderer(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Renderer/OperationalAuditRenderer.php', import.meta.url), 'utf8');
}

async function readSetup(): Promise<string> {
  return readFile(new URL('../../integaglpi/setup.php', import.meta.url), 'utf8');
}

async function readRoutingSafetyPage(): Promise<string> {
  return readFile(new URL('../../integaglpi/front/routing.safety.php', import.meta.url), 'utf8');
}

async function readRoutingSafetyTemplate(): Promise<string> {
  return readFile(new URL('../../integaglpi/templates/routing_safety.php', import.meta.url), 'utf8');
}

async function readTicketTabTemplate(): Promise<string> {
  return readFile(new URL('../../integaglpi/templates/ticket_tab.php', import.meta.url), 'utf8');
}

async function readPluginConfigService(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Service/PluginConfigService.php', import.meta.url), 'utf8');
}

async function readConfigTemplate(): Promise<string> {
  return readFile(new URL('../../integaglpi/templates/config.php', import.meta.url), 'utf8');
}

async function readIntegrationServiceClient(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Service/IntegrationServiceClient.php', import.meta.url), 'utf8');
}

async function readQualityDashboardPage(): Promise<string> {
  return readFile(new URL('../../integaglpi/front/quality.dashboard.php', import.meta.url), 'utf8');
}

async function readQualityDashboardService(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Service/QualityDashboardService.php', import.meta.url), 'utf8');
}

async function readQualityDashboardTemplate(): Promise<string> {
  return readFile(new URL('../../integaglpi/templates/quality_dashboard.php', import.meta.url), 'utf8');
}

async function readQualityDashboardRenderer(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Renderer/QualityDashboardRenderer.php', import.meta.url), 'utf8');
}

async function readConversationRepository(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/External/Repository/ConversationRepository.php', import.meta.url), 'utf8');
}

async function readCentralAction(): Promise<string> {
  return readFile(new URL('../../integaglpi/front/central.action.php', import.meta.url), 'utf8');
}

async function readPluginRight(): Promise<string> {
  return readFile(new URL('../../integaglpi/inc/right.class.php', import.meta.url), 'utf8');
}

describe('PHP Attendance Center pre-ticket conversations', () => {
  it('allows pre-ticket statuses in the central list and message loading', async () => {
    const source = await readAttendanceCenterService();

    expect(source).toContain("'collecting_contact_profile'");
    expect(source).toContain("'awaiting_entity_selection'");
    expect(source).toContain('private const PRE_TICKET_STATUSES');
    expect(source).toContain('findByConversationId($conversationId)');
    expect(source).toContain('ticket_required');
  });

  it('renders pre-ticket conversations without showing Ticket #0', async () => {
    const source = await readCentralTemplate();

    expect(source).toContain("__('Pré-Ticket', 'glpiintegaglpi')");
    expect(source).toContain("ticketDisplayLabel(row, ticketId)");
    expect(source).toContain("tid > 0 ? '#' + tid : 'Pré-Ticket'");
    expect(source).toContain('loadSelectedMessages(true)');
    expect(source).not.toContain("if (!ticketNum) {\n            return;");
  });

  it('uses real GLPI entity options instead of free entity id/name fields', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();

    expect(service).toContain('loadGlpiEntityOptions');
    expect(service).toContain("'FROM' => 'glpi_entities'");
    expect(service).toContain('canUseEntity($id)');
    expect(service).toContain('haveAccessToEntity');
    expect(template).toContain('$glpiEntities');
    expect(template).toContain('box.querySelector(\'[name="glpi_entity_id"]\')');
    expect(template).toContain('js-integaglpi-entity-id');
    expect(template).toContain('name="glpi_entity_id"');
    expect(template).toContain("payload.set('glpi_entity_id', String(entityId))");
    expect(template).toContain('value="" disabled selected');
    expect(template).toContain('Salvar entidade e criar chamado');
    expect(template).toContain('atualizar a memória do contato');
    expect(template).toContain('<select');
    expect(template).not.toContain('Entity::dropdown');
    expect(template).not.toContain('placeholder="ID da entidade"');
    expect(template).not.toContain('js-integaglpi-entity-name');
  });

  it('offers entity selection when contact profile collection is already complete', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();

    expect(service).toContain('isProfileCollectionComplete');
    expect(service).toContain("$effectiveStatus === 'collecting_contact_profile' && $profileComplete");
    expect(service).toContain("(string) ($value['step'] ?? '') === 'complete'");
    expect(template).toContain('$profileCollectionComplete');
    expect(template).toContain("$effectiveStatus === 'collecting_contact_profile' && $profileCollectionComplete");
  });

  it('uses deterministic entity-selection idempotency and disables duplicate clicks', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();
    const action = await readFile(new URL('../../integaglpi/front/central.action.php', import.meta.url), 'utf8');

    expect(action).toContain("isset($_POST['idempotency_key']) ? (string) $_POST['idempotency_key'] : null");
    expect(service).toContain('normalizeEntitySelectionIdempotencyKey');
    expect(service).toContain("'idempotency_key' => $this->normalizeEntitySelectionIdempotencyKey");
    expect(template).toContain('buildEntitySelectionIdempotencyKey');
    expect(template).toContain("payload.set('idempotency_key', buildEntitySelectionIdempotencyKey");
    expect(template).toContain("entityButton.dataset.requestInProgress === '1'");
    expect(template).toContain('Criando chamado...');
    expect(service).toContain('A criação pode ter sido concluída no GLPI');
  });

  it('polls entity-selection status and avoids blocking the UI for the GLPI ticket timeout', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();
    const action = await readFile(new URL('../../integaglpi/front/central.action.php', import.meta.url), 'utf8');
    const client = await readIntegrationServiceClient();

    expect(action).toContain("'entity_status'");
    expect(action).toContain('$service->getConversationEntityStatus($conversationId)');
    expect(service).toContain('getConversationEntityStatus');
    expect(client).toContain('ENTITY_SELECTION_TIMEOUT_SECONDS = 8');
    expect(client).toContain('getConversationEntityStatus');
    expect(template).toContain('pollEntitySelectionStatus');
    expect(template).toContain("body.status === 'processing'");
    expect(template).toContain('window.setTimeout(function ()');
    expect(service).toContain('A criação pode ter sido concluída no GLPI');
  });

  it('keeps entity-selection duration based on finished_at instead of legacy updated_at', async () => {
    const repository = await readConversationRepository();

    expect(repository).toContain('esa.finished_at AS entity_attempt_finished_at');
    expect(repository).toContain('EXTRACT(EPOCH FROM (esa.finished_at - esa.created_at))::int');
    expect(repository).toContain('END AS entity_attempt_duration_seconds');
  });

  it('uses the real solution_actions ticket_id column in console queries', async () => {
    const repository = await readConversationRepository();

    expect(repository).toContain('FROM glpi_plugin_integaglpi_solution_actions s');
    expect(repository).toContain('WHERE s.ticket_id = c.glpi_ticket_id');
    expect(repository).not.toContain('s.glpi_ticket_id');
  });

  it('allows scoped local entity edits with memory and audit without moving existing GLPI tickets', async () => {
    const service = await readAttendanceCenterService();
    const action = await readCentralAction();
    const template = await readCentralTemplate();
    const repository = await readConversationRepository();

    expect(action).toContain("'update_entity'");
    expect(action).toContain('$service->updateConversationEntity');
    expect(service).toContain('public function updateConversationEntity');
    expect(service).toContain('findGlpiEntityOption($glpiEntityId)');
    expect(service).toContain('O ticket GLPI existente não foi movido');
    expect(repository).toContain('public function updateConversationEntity');
    expect(repository).toContain('glpi_plugin_integaglpi_contact_entity_memory');
    expect(repository).toContain('CONVERSATION_ENTITY_UPDATED');
    expect(template).toContain('js-integaglpi-update-entity');
    expect(template).toContain("payload.set('action', isEntityUpdate ? 'update_entity' : 'confirm_entity')");
    expect(template).toContain('Alterar entidade da conversa/memória');
  });

  it('exposes findable plugin profile rights labels for operations areas', async () => {
    const right = await readPluginRight();

    expect(right).toContain('Console');
    expect(right).toContain('Configurações');
    expect(right).toContain('Mensagens');
    expect(right).toContain('Templates');
    expect(right).toContain('Contratos e Horas');
    expect(right).toContain('IA Supervisora');
  });

  it('shows specific solve outcomes instead of the old generic plugin error', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();

    expect(service).toContain('Ticket solucionado no GLPI, mas houve falha ao avisar o cliente pelo WhatsApp.');
    expect(service).toContain('Solução criada, mas não foi possível atualizar o status do ticket por permissão GLPI.');
    expect(service).toContain('Chamado já estava solucionado ou fechado.');
    expect(service).toContain('friendlySolveExceptionMessage');
    expect(template).toContain("result.body.message || 'Chamado solucionado'");
    expect(service).not.toContain('Unable to solve this ticket right now');
  });

  it('shows entity-selection attempt diagnostics without server command execution', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();
    const config = await readConfigTemplate();
    const client = await readIntegrationServiceClient();
    const repository = await readConversationRepository();

    expect(repository).toContain('glpi_plugin_integaglpi_entity_selection_attempts');
    expect(repository).toContain('entity_attempt_status');
    expect(service).toContain('entityAttemptStatusLabel');
    expect(service).toContain('ambiguous_reconciliation');
    expect(template).toContain('Última tentativa');
    expect(template).toContain('entity_attempt_error_sanitized');
    expect(config).toContain('Diagnóstico somente leitura');
    expect(config).toContain('Últimas tentativas de entidade');
    expect(client).toContain('PATH_DIAGNOSTICS');
    expect(client).toContain('getDiagnostics');
    for (const forbidden of [/\bshell_exec\s*\(/, /\bexec\s*\(/, /\bsystem\s*\(/, /\bpassthru\s*\(/, /certbot/, /docker\s/, /pg_dump/, /\bgit\s/]) {
      expect(config).not.toMatch(forbidden);
      expect(client).not.toMatch(forbidden);
    }
  });

  it('renders friendly statuses and next action hints in the Central', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();

    expect(service).toContain('STATUS_LABELS');
    expect(service).toContain('nextAction');
    expect(service).toContain("'awaiting_entity_selection' => 'Aguardando seleção de entidade'");
    expect(service).toContain('Selecione a entidade para criar o chamado');
    expect(template).toContain('friendlyStatus(row)');
    expect(template).toContain('nextActionLabel(row, ticketId > 0)');
    expect(template).toContain('data-next-action');
    expect(template).toContain('Próxima ação');
  });

  it('classifies Central PostgreSQL failures without exposing secrets and has a schema fallback', async () => {
    const service = await readAttendanceCenterService();
    const template = await readCentralTemplate();

    expect(service).toContain('classifyCentralLoadException');
    expect(service).toContain('loadMinimalCentralFallback');
    expect(service).toContain('Credenciais do PostgreSQL externo foram recusadas.');
    expect(service).toContain('Schema externo incompleto para a Central.');
    expect(service).toContain('sanitizeDiagnosticText');
    expect(service).toContain('password|passwd|pwd|token|secret|key');
    expect(template).toContain('$centralErrorDiagnostic');
    expect(template).toContain('Diagnóstico admin:');
  });

  it('keeps the operational audit page rich without stale menu classes', async () => {
    const operationLogPage = await readOperationLogPage();
    const auditPage = await readAuditPage();
    const template = await readAuditTemplate();
    const renderer = await readOperationalAuditRenderer();

    expect(operationLogPage).toContain("require __DIR__ . '/audit.php'");
    expect(auditPage).toContain('OperationalAuditRenderer');
    expect(auditPage).toContain('OperationLogMenu');
    expect(template).toContain('Saúde Operacional');
    expect(template).toContain('Chamados em risco operacional WhatsApp');
    expect(template).toContain('dead_letter_rows');
    expect(template).toContain('Ver auditoria filtrada');
    expect(renderer).toContain('getHealthFilterUrl');
    expect(auditPage).not.toContain('AuditMenu');
  });

  it('registers routing safety as a real menu and page', async () => {
    const setup = await readSetup();
    const page = await readRoutingSafetyPage();
    const template = await readRoutingSafetyTemplate();

    expect(setup).toContain('RoutingSafetyMenu::class');
    expect(page).toContain('RoutingSafetyService');
    expect(template).toContain('Filas e Roteamento');
    expect(template).toContain('Fallback');
    expect(template).toContain('Eventos recentes');
  });

  it('keeps the production ticket context while preserving 8.1 profile and attachment UI', async () => {
    const source = await readTicketTabTemplate();

    expect(source).toContain('Risco operacional WhatsApp');
    expect(source).toContain('Diagnostico tecnico');
    expect(source).toContain('Ultimos eventos operacionais da conversa mais recente');
    expect(source).toContain('Perfil do contato usado no chamado');
    expect(source).toContain('Entidade memorizada');
    expect(source).toContain('js-integaglpi-tab-reply-file');
  });

  it('renders WhatsApp 24h window guidance and delivery status without Meta token storage', async () => {
    const service = await readAttendanceCenterService();
    const central = await readCentralTemplate();
    const ticketTab = await readTicketTabTemplate();

    expect(service).toContain('buildWhatsappWindow');
    expect(service).toContain('Janela aberta até %s');
    expect(service).toContain('Janela fechada — use template');
    expect(central).toContain('whatsapp_window');
    expect(central).toContain('delivery_status_label');
    expect(ticketTab).toContain('Janela WhatsApp 24h');
    expect(ticketTab).toContain('Status WhatsApp');
    expect(ticketTab).toContain('meta_error_message_sanitized');
  });

  it('implements Console 2.0 server-side filters, pagination, masking, and read-only diagnostics', async () => {
    const service = await readAttendanceCenterService();
    const repository = await readConversationRepository();
    const central = await readCentralTemplate();
    const renderer = await readFile(new URL('../../integaglpi/src/Renderer/CentralRenderer.php', import.meta.url), 'utf8');

    expect(service).toContain('DEFAULT_LIMIT = 25');
    expect(service).toContain('MAX_LIMIT = 50');
    expect(service).toContain("$filters['allowed_entity_ids'] = $allowedEntityIds");
    expect(service).toContain('masked_phone');
    expect(service).toContain('risk_badges');
    expect(service).toContain('loadReadOnlyDiagnostics');
    expect(repository).toContain('findAttendanceTechnicianIds');
    expect(repository).toContain('allowed_entity_ids');
    expect(repository).toContain('window_status');
    expect(repository).toContain('delivery_filter');
    expect(repository).toContain('operational_state');
    expect(repository).toContain('appendOperationalStateWhere');
    expect(central).toContain('Console Operacional 2.0');
    expect(central).toContain('name="technician_id"');
    expect(central).toContain('name="entity_id"');
    expect(central).toContain('name="window_status"');
    expect(central).toContain('name="inactivity"');
    expect(central).toContain('name="delivery"');
    expect(central).toContain('name="operational_state"');
    expect(central).toContain('data-masked-phone');
    expect(central).toContain('js-integaglpi-central-diagnostics-readonly');
    expect(central).toContain('Diagnóstico somente leitura');
    expect(central).toContain('data-can-reply');
    expect(renderer).toContain('technician_id');
    expect(renderer).toContain('operational_state');
    for (const forbidden of [/\bshell_exec\s*\(/, /\bexec\s*\(/, /\bsystem\s*\(/, /\bpassthru\s*\(/, /certbot/, /docker\s/, /pg_dump/, /\bgit\s/]) {
      expect(central).not.toMatch(forbidden);
    }
  });

  it('keeps Template Manager local/manual without Meta Template API calls', async () => {
    const configService = await readPluginConfigService();
    const configTemplate = await readConfigTemplate();

    expect(configService).toContain('getLocalTemplates');
    expect(configService).toContain('saveLocalTemplate');
    expect(configService).toContain('local_template_catalog_json');
    expect(configTemplate).toContain('Templates locais');
    expect(configTemplate).toContain('não consulta a API da Meta');
    expect(configTemplate).toContain('não envia templates automaticamente');
    expect(configTemplate).not.toContain('META_ACCESS_TOKEN');
    expect(configTemplate).not.toContain('graph.facebook.com');
  });

  it('implements a read-only Quality Dashboard with date limits, entity scope, and no server commands', async () => {
    const setup = await readSetup();
    const page = await readQualityDashboardPage();
    const service = await readQualityDashboardService();
    const template = await readQualityDashboardTemplate();
    const renderer = await readQualityDashboardRenderer();
    const client = await readIntegrationServiceClient();

    expect(setup).toContain('QualityDashboardMenu::class');
    expect(page).toContain('Plugin::requireQualityDashboardRead()');
    expect(service).toContain('MAX_RANGE_DAYS = 30');
    expect(service).toContain('loadEntityOptions');
    expect(service).toContain('haveAccessToEntity');
    expect(service).toContain('getQualityDashboard');
    expect(service).toContain('loadReopenReasons');
    expect(service).toContain('ExternalDatabase::getConnection($this->pluginConfigService->getConnectionConfig())');
    expect(service).toContain("unset($row['last_message_excerpt'])");
    expect(client).toContain('PATH_QUALITY_DASHBOARD');
    expect(template).toContain('Dashboard read-only');
    expect(template).toContain('cache Redis');
    expect(template).toContain('Exportação CSV permanece bloqueada');
    expect(template).toContain('Abrir Console filtrado');
    expect(template).toContain('Reaberturas por motivo');
    expect(template).toContain('Inatividade e autoclose');
    expect(template).toContain('Contratos em alerta');
    expect(template).toContain('Última interação');
    expect(template).not.toContain('last_message_excerpt');
    expect(renderer).toContain('getConsoleUrl');
    for (const write of [/\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /\bDROP\b/i, /\bTRUNCATE\b/i]) {
      expect(page).not.toMatch(write);
      expect(service).not.toMatch(write);
      expect(template).not.toMatch(write);
      expect(renderer).not.toMatch(write);
    }
    for (const forbidden of [/\bshell_exec\s*\(/, /\bexec\s*\(/, /\bsystem\s*\(/, /\bpassthru\s*\(/, /certbot/, /docker\s/, /pg_dump/, /\bgit\s/]) {
      expect(page).not.toMatch(forbidden);
      expect(service).not.toMatch(forbidden);
      expect(template).not.toMatch(forbidden);
      expect(renderer).not.toMatch(forbidden);
    }
  });
});
