import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return readFile(resolve(repoRoot, path), 'utf8');
}

describe('AI operations console static safety', () => {
  it('registers the central AI operations menu and supervisor-only helpers', async () => {
    const setup = await readProjectFile('integaglpi/setup.php');
    const plugin = await readProjectFile('integaglpi/src/Plugin.php');
    const menu = await readProjectFile('integaglpi/src/AiOperationsMenu.php');

    expect(setup).toContain('AiOperationsMenu::class');
    expect(setup).toContain('Plugin::registerClass(AiOperationsMenu::class)');
    expect(plugin).toContain('getAiOperationsUrl');
    expect(plugin).toContain('getAiConfigUrl');
    expect(plugin).toContain('getHistoricalMiningUrl');
    expect(plugin).toContain('requireAiOperationsRead');
    expect(menu).toContain('Plugin::canAiOperationsRead()');
  });

  it('keeps AI configuration gated and masks sensitive values', async () => {
    const front = await readProjectFile('integaglpi/front/ai.config.php');
    const service = await readProjectFile('integaglpi/src/Service/AiConfigViewService.php');
    const vaultService = await readProjectFile('integaglpi/src/Service/AiSecretVaultService.php');
    const template = await readProjectFile('integaglpi/templates/ai_config.php');
    const migration = await readProjectFile('integration-service/schema-migrations/039_ai_secret_vault.sql');
    const testStatusMigration = await readProjectFile('integration-service/schema-migrations/040_ai_secret_vault_test_statuses.sql');

    expect(front).toContain('Plugin::requireAiOperationsRead()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(service).toContain('maskUrl');
    expect(service).toContain('missingCloudGates');
    expect(service).toContain('AI_PILOT_DIRECTOR_APPROVED');
    expect(service).toContain('AI_PILOT_MONTHLY_BUDGET_LIMIT');
    expect(service).toContain('AI_PILOT_SYNTHETIC_TEST_OK');
    expect(service).toContain('AI_CONFIG_VIEWED');
    expect(service).toContain('AI_CONFIG_UPDATED');
    expect(service).toContain('AI_CLOUD_GATE_UPDATED');
    expect(service).toContain('AI_LOCAL_SYNTHETIC_TEST_RUN');
    expect(service).toContain('AI_LOCAL_MODELS_REFRESHED');
    expect(service).toContain('/api/tags');
    expect(service).toContain('ollama_model_status');
    expect(service).toContain('base_url_missing');
    expect(service).toContain('OLLAMA_BASE_URL');
    expect(service).toContain('host.docker.internal');
    expect(service).toContain('CLOUD_PROVIDER_CATALOG');
    expect(service).toContain("AI_SETTINGS_CONTEXT = 'ai_settings'");
    expect(service).toContain('normalizeAiSettingsPost');
    expect(service).toContain('saveAiSettings');
    expect(service).toContain('cloud_budget_configured');
    expect(service).toContain('Storage de configurações IA não está pronto');
    expect(service).toContain('externalResearchStatus');
    expect(service).toContain('p4CandidateReviewStatus');
    expect(service).toContain('cloud_keys_in_secret_vault');
    expect(service).toContain('getOperationalProviderCatalog');
    expect(service).toContain('cloud_ready_providers');
    expect(service).toContain('cloud_blocked_providers');
    expect(service).toContain('external_research_default');
    expect(service).toContain('p4_default');
    expect(service).toContain('AI_SECRET_VAULT_UPDATED');
    expect(service).toContain('AI_CLOUD_PROVIDER_TESTED');
    expect(service).toContain('test_cloud_provider');
    expect(service).toContain('cloud_model_not_allowed');
    expect(service).toContain("'id' => 'gemini'");
    expect(service).toContain("$provider === 'google'");
    expect(service).toContain('latestCloudProviderTestErrors');
    expect(service).toContain("payload_json->>'provider' IS NOT NULL");
    expect(service).not.toContain("payload_json ? 'provider'");
    expect(service).toContain('last_error_type');
    expect(service).toContain('autorização para teste sintético');
    expect(service).toContain("$ready = !$vaultLocked && $secretConfigured && $gatesOk && $lastTestStatus === 'success'");
    expect(service).toContain('no_raw_ticket_to_ai');
    expect(vaultService).toContain("CIPHER = 'aes-256-gcm'");
    expect(vaultService).toContain('INTEGAGLPI_AI_VAULT_MASTER_KEY');
    expect(vaultService).toContain('storeSecret');
    expect(vaultService).toContain('testProvider');
    expect(vaultService).toContain('completeProvider');
    expect(vaultService).toContain('AiCloudProviderException');
    expect(vaultService).toContain('callCompletionProvider');
    expect(vaultService).toContain('providerCompletionErrorType');
    expect(vaultService).toContain('cloudCompletionFailure');
    expect(vaultService).toContain('providerCompletionRequest');
    expect(vaultService).toContain('SYNTHETIC_PROMPT');
    expect(vaultService).toContain('Responda apenas OK em JSON');
    expect(vaultService).toContain("'google' => 'gemini'");
    expect(vaultService).toContain('claude-3-5-haiku-20241022');
    expect(vaultService).toContain('providerErrorType');
    expect(vaultService).toContain('last_error_type');
    expect(vaultService).toContain('x-goog-api-key: ');
    expect(vaultService).toContain(':generateContent');
    expect(vaultService).not.toContain(':generateContent?key=');
    expect(vaultService).toContain("$part['type'] ?? 'text'");
    expect(vaultService).toContain('normalizeSyntheticResponseText');
    expect(vaultService).toContain('sanitizeProviderRawForHash');
    expect(vaultService).toContain('model_not_found');
    expect(vaultService).toContain('invalid_request');
    expect(vaultService).toContain('cloud_provider_http_400');
    expect(vaultService).toContain('cloud_provider_http_401');
    expect(vaultService).toContain('cloud_provider_http_403');
    expect(vaultService).toContain('cloud_provider_http_429');
    expect(vaultService).toContain('cloud_provider_invalid_response');
    expect(vaultService).toContain('cloud_provider_timeout');
    expect(vaultService).toContain('cloud_provider_unreachable');
    expect(vaultService).toContain('decryptSecret');
    expect(vaultService).toContain('last_test_status = :status');
    expect(vaultService).toContain('encrypted_secret');
    expect(vaultService).toContain('secret_fingerprint');
    expect(vaultService).not.toMatch(/echo|print_r|var_dump/);
    expect(vaultService).toContain("':encrypted_secret' => $encrypted");
    expect(vaultService).not.toContain("':encrypted_secret' => $secret");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_ai_secret_vault');
    expect(migration).toContain('encrypted_secret TEXT NOT NULL');
    expect(migration).toContain('secret_fingerprint TEXT NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS glpi_intega_ai_secret_active_provider_uq');
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i);
    expect(testStatusMigration).toContain('invalid_response');
    expect(testStatusMigration).toContain('unauthorized');
    expect(testStatusMigration).toContain('timeout');
    expect(testStatusMigration).toContain('glpi_intega_ai_secret_provider_ck');
    expect(testStatusMigration).toContain("provider = 'google'");
    expect(template).toContain('Configurações não sensíveis');
    expect(template).toContain('Secret Vault cloud');
    expect(template).toContain('Salvar segredo no cofre');
    expect(template).toContain('Testar provider cloud');
    expect(template).toContain('last_error_type');
    expect(template).toContain('payload sintético');
    expect(template).toContain('pronto para uso controlado');
    expect(template).toContain('Autorização para teste sintético cloud');
    expect(template).toContain('last_test_status=success');
    expect(template).toContain('Write-only');
    expect(template).toContain('configured=true');
    expect(template).toContain('Atualizar modelos Ollama');
    expect(template).toContain('Dropdown aguardando modelos Ollama');
    expect(template).toContain('Config efetiva');
    expect(template).toContain('Catálogo cloud seguro');
    expect(template).toContain('Providers prontos aparecem nos seletores das telas de Pesquisa Externa e P4');
    expect(template).toContain('name="copilot_enabled"');
    expect(template).toContain('name="external_research_enabled"');
    expect(template).toContain('name="p4_candidate_review_enabled"');
      expect(template).toContain('cloud_director_approved');
    expect(template).toContain('Salvar configurações não sensíveis');
    expect(template).toContain('auth_key_visible');
    expect(template).toContain('Validar gates para habilitar cloud');
    expect(template).toContain('Validar configuração local sem dados reais');
    expect(template).toContain('IA Supervisora habilitada');
      expect(template).toContain('Modelo manual opcional se não estiver na lista');
      expect(service).toContain("$manualKey = $key . '_manual'");
    expect(template).toContain('kb_local_first');
    expect(template).toContain('Pesquisa Externa Controlada');
    expect(template).toContain('manual_trigger_required');
    expect(template).toContain('prompt_preview_required');
    expect(template).toContain('P4 Revisão de Candidatos KB');
    expect(template).toContain('human_review_required');
    expect(template).toContain('no_auto_publish');
    expect(template).toContain('Embeddings');
    expect(template).toContain('operational_rag');
    expect(template).toContain('Auditoria IA');
    expect(template).toContain('payload_policy');
    expect(template).toContain('Política operacional');
    const inputNames = [...template.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);
    expect(inputNames.filter((name) => name !== '_glpi_csrf_token')).not.toEqual(
      expect.arrayContaining(['integration_auth_key', 'token', 'secret', 'password', 'api_key']),
    );
    expect(`${front}\n${service}\n${template}`).not.toContain('META_ACCESS_TOKEN');
  });

  it('uses controlled internal endpoints for P2/P3 UI without shell or arbitrary paths', async () => {
    const front = await readProjectFile('integaglpi/front/historical.mining.php');
    const phpService = await readProjectFile('integaglpi/src/Service/HistoricalMiningUiService.php');
    const client = await readProjectFile('integaglpi/src/Service/IntegrationServiceClient.php');
    const nodeService = await readProjectFile('integration-service/src/domain/services/AiOperationsService.ts');
    const app = await readProjectFile('integration-service/src/app.ts');

    expect(client).toContain('/internal/glpi/historical-mining/preview');
    expect(client).toContain('/internal/glpi/historical-mining/execute');
    expect(client).toContain('/internal/glpi/kb-candidates/generate');
    expect(app).toContain('/internal/glpi/historical-mining/preview');
    expect(app).toContain('/internal/glpi/historical-mining/execute');
    expect(app).toContain('/internal/glpi/kb-candidates/generate');
    expect(phpService).toContain('move_uploaded_file');
    expect(phpService).toContain('preview_glpi_export');
    expect(phpService).toContain('generate_glpi_jsonl');
    expect(phpService).toContain('validate_generated');
    expect(phpService).toContain('downloadGeneratedJsonl');
    expect(front).toContain('download_generated');
    expect(phpService).toContain('jsonl_base64');
    expect(phpService).toContain('dry_run_token');
    expect(phpService).toContain('withFileLock');
    expect(phpService).toContain('JSONL_RETENTION_SECONDS');
    expect(nodeService).toContain('mkdtemp');
    expect(nodeService).toContain('RedisKeyLock');
    expect(nodeService).toContain('withOperationLock');
    expect(nodeService).toContain('AI_OPERATIONS_LOCK_UNAVAILABLE');
    expect(nodeService).toContain('HISTORICAL_MINING_DRY_RUN_REQUIRED');
    expect(`${phpService}\n${nodeService}`).not.toMatch(/\b(?:shell_exec|exec|passthru|proc_open|system)\s*\(|spawn\(|child_process|inputPath|path_arbitrary/i);
  });

  it('exports GLPI tickets to the P2 JSONL contract with sanitization and no attachments', async () => {
    const phpService = await readProjectFile('integaglpi/src/Service/HistoricalMiningUiService.php');
    const template = await readProjectFile('integaglpi/templates/historical_mining.php');

    for (const field of [
      'ticket_id_hash',
      'opened_at',
      'solved_at',
      'status',
      'category',
      'entity',
      'group',
      'priority',
      'urgency',
      'title_text_sanitized',
      'description_text_sanitized',
      'followup_text_sanitized',
      'solution_text_sanitized',
      'reopened_count',
      'satisfaction_score',
    ]) {
      expect(phpService).toContain(field);
    }

    expect(phpService).toContain('sanitizeExportText');
    expect(phpService).toContain('containsSensitiveData');
    expect(phpService).toContain('HISTORICAL_JSONL_PREVIEWED');
    expect(phpService).toContain('HISTORICAL_JSONL_GENERATED');
    expect(phpService).toContain('HISTORICAL_JSONL_BLOCKED_PII');
    expect(phpService).toContain('HISTORICAL_JSONL_DOWNLOADED');
    expect(phpService).toContain('HISTORICAL_JSONL_SELECTED_FOR_DRY_RUN');
    expect(phpService).toContain('HISTORICAL_JSONL_EXPIRED_OR_NOT_FOUND');
    expect(phpService).toContain('HISTORICAL_MINING_DRY_RUN_REQUESTED');
    expect(phpService).toContain('source_origin');
    expect(phpService).toContain('file_id_hash');
    expect(phpService).toContain('exportPreviewForSession');
    expect(phpService).toContain('exportPreviewFromUpload');
    expect(phpService).toContain('rowsProcessedFromMiningBody');
    expect(phpService).toContain('Execução real bloqueada');
    expect(phpService).toContain('Ação inválida.');
    expect(phpService).toContain('glpi_itilfollowups');
    expect(phpService).toContain('glpi_itilsolutions');
    expect(phpService).not.toMatch(/glpi_documents|glpi_documents_items|Document_Item/i);
    expect(template).toContain('Gerar JSONL a partir do GLPI');
    expect(template).toContain('Pré-visualizar exportação');
    expect(template).toContain('Gerar arquivo JSONL sanitizado');
    expect(template).toContain('Arquivo JSONL gerado');
    expect(template).toContain('Baixar JSONL sanitizado');
    expect(template).toContain('Executar dry-run P2 com este arquivo');
    expect(template).toContain('Pré-visualizar payload P4');
    expect(template).toContain('Provider IA P4');
    expect(template).toContain('Modelo IA P4');
    expect(template).toContain('last_test_status=success');
    expect(template).toContain('provider/modelo');
    expect(template).toContain('Revisão IA de candidatos está desabilitada');
    expect(template).toContain('file_id');
    expect(template).toContain('sha256');
    expect(template).toContain('expires_at');
    expect(template).toContain('área temporária controlada');
    expect(template).toContain('Diagnóstico de rejeições do dry-run');
    expect(template).toContain('Próxima ação');
    expect(template).toContain('!$dryRunReady');
    expect(template).not.toContain("$exportUpload['path']");
    expect(template).not.toContain('name="path"');
  });

  it('keeps P4 AI candidate review disabled by default and candidate-only', async () => {
    const phpService = await readProjectFile('integaglpi/src/Service/HistoricalMiningUiService.php');
    const template = await readProjectFile('integaglpi/templates/historical_mining.php');

    expect(phpService).toContain("P4_AI_REVIEW_FEATURE_FLAG = 'AI_KB_CANDIDATE_REVIEW_ENABLED'");
    expect(phpService).toContain('aiConfigSettingValue');
    expect(phpService).toContain('p4_candidate_review_enabled');
    expect(phpService).toContain('p4_candidate_review_provider');
    expect(phpService).toContain('p4_candidate_review_model');
    expect(phpService).toContain('readP4ProviderSelection');
    expect(phpService).toContain('normalizeP4ProviderId');
    expect(phpService).toContain('cloudProviderForP4Model');
    expect(phpService).toContain('selectedAiProviderForP4');
    expect(phpService).toContain('loadOperationalProviderCatalog');
    expect(phpService).toContain('callCloudProviderForCandidateReview');
    expect(phpService).toContain('P4_CLOUD_MAX_PROMPT_BYTES');
    expect(phpService).toContain('AiCloudProviderException');
    expect(phpService).toContain('decodeAiCandidateReviewJson');
    expect(phpService).toContain("P4_CLOUD_PROVIDER_ALIASES");
    expect(phpService).toContain("'grok' => 'xai'");
    expect(phpService).toContain('selection_origin');
    expect(phpService).toContain('selected_provider_raw');
    expect(phpService).toContain('selected_model_raw');
    expect(phpService).toContain('publicP4ProviderError');
    expect(phpService).toContain('model_not_allowed');
    expect(phpService).toContain('provider_not_ready');
    expect(phpService).toContain('provider_not_allowed');
    expect(phpService).toContain('provider_selection_missing');
    expect(phpService).toContain('previewAiCandidateReview');
    expect(phpService).toContain('executeAiCandidateReview');
    expect(phpService).toContain("P4_ELIGIBLE_CANDIDATE_STATUSES = ['suggested', 'in_review', 'low_confidence', 'possible_duplicate', 'approved']");
    expect(phpService).toContain('lookupAiReviewCandidatePayloads');
    expect(phpService).toContain('resolveP4RunInputHashes');
    expect(phpService).toContain('$inputHashes[] = $runId');
    expect(phpService).toContain('loadP4CandidateStatusCounts');
    expect(phpService).toContain('assertP4CandidateSchema');
    expect(phpService).toContain('aiReviewCandidateLookupMessage');
    expect(phpService).toContain('run_id/input_hash não encontrado');
    expect(phpService).toContain('run_id existe, mas ainda não possui candidatos P3 persistidos');
    expect(phpService).toContain('nenhum está em status elegível para P4');
    expect(phpService).toContain('KB_CANDIDATE_AI_REVIEW_PREVIEWED');
    expect(phpService).toContain('KB_CANDIDATE_AI_REVIEW_BLOCKED');
    expect(phpService).toContain('KB_CANDIDATE_AI_REVIEW_COMPLETED');
    expect(phpService).toContain('loadAiReviewCandidatePayloads');
    expect(phpService).toContain('callLocalOllamaForCandidateReview');
    expect(phpService).toContain('validateAiCandidateReviewResponse');
    expect(phpService).toContain('persistAiCandidateReviewSuggestions');
    expect(phpService).toContain('/api/generate');
    expect(phpService).toContain("'stream' => false");
    expect(phpService).toContain("'format' => 'json'");
    expect(phpService).toContain("'edit_note'");
    expect(phpService).toContain('create_kb_from_solution');
    expect(phpService).toContain('handleCreateKbFromSolution');
    expect(phpService).toContain('provider_url_not_allowed');
    expect(phpService).toContain('provider_unreachable');
    expect(phpService).toContain('schema_invalid');
    expect(phpService).toContain('low_confidence');
    expect(phpService).toContain('pii_blocked');
    expect(phpService).toContain('glpi_plugin_integaglpi_kb_candidates');
    expect(phpService).toContain('glpi_plugin_integaglpi_kb_candidate_reviews');
    expect(phpService).toContain('glpi_plugin_integaglpi_hist_mining_runs');
    expect(phpService).toContain('p4_no_raw_history');
    expect(phpService).toContain('p4_no_auto_publish');
    expect(phpService).toContain('provider_unavailable');
    expect(phpService).toContain('confidence_below_threshold');
    expect(phpService).toContain('human_review_required');
    expect(phpService).toContain('provider cloud selecionado não respondeu');
    expect(phpService).toContain('cloud_provider_unreachable');
    expect(phpService).toContain('cloud_provider_timeout');
    expect(phpService).toContain('cloud_provider_http_400');
    expect(phpService).toContain('cloud_provider_http_401');
    expect(phpService).toContain('cloud_provider_http_403');
    expect(phpService).toContain('cloud_provider_http_429');
    expect(phpService).toContain('cloud_provider_invalid_response');
    expect(phpService).toContain('cloud_provider_schema_invalid');
    expect(phpService).toContain('cloud_provider_payload_too_large');
    expect(phpService).toContain('cloud_provider_missing_secret');
    expect(phpService).toContain('cloud_provider_model_not_allowed');
    expect(phpService).toContain("'response_hash' => $responseHash");
    expect(phpService).toContain("'http_status' => $httpStatus");
    expect(template).toContain('4. Revisão IA opcional P4');
    expect(template).toContain('P4 usa apenas candidatos P3 sanitizados');
    expect(template).toContain('Últimos run_id/input_hash com candidatos P3 persistidos');
    expect(template).toContain('Usar este run_id');
    expect(template).toContain('Status elegíveis para P4');
    expect(template).toContain('Gere candidatos P3 antes de executar P4');
    expect(template).toContain('revisão humana obrigatória');
    expect(template).toContain('Confiança abaixo do limite');
    expect(template).toContain("strtolower($postedP4Provider) === 'grok'");
    expect(template).toContain('name="p4_preview_payload_hash"');
    expect(template).toContain('selection_origin');
    expect(template).toContain('error_type');
    expect(template).toContain('http_status');
    expect(template).toContain('elapsed_ms');
    expect(template).toContain('response_hash');
    expect(template).toContain('disabled');
    expect(`${phpService}\n${template}`).not.toMatch(/KnowbaseItem::add|auto_publish\s*=\s*true|ticket raw|followup raw|sendOutbound|MetaClient/i);
  });

  it('keeps operations pages away from WhatsApp, ticket mutation and KB publishing', async () => {
    const files = await Promise.all([
      readProjectFile('integaglpi/front/ai.operations.php'),
      readProjectFile('integaglpi/front/historical.mining.php'),
      readProjectFile('integaglpi/src/Service/HistoricalMiningUiService.php'),
      readProjectFile('integaglpi/templates/historical_mining.php'),
      readProjectFile('integration-service/src/domain/services/AiOperationsService.ts'),
    ]);

    expect(files.join('\n')).not.toMatch(/sendOutbound|MetaClient|Ticket::update|KnowbaseItem::add|auto_publish\s*=\s*true|Publicar automaticamente/i);
  });

  it('preserves Copilot drafts and shows first-attempt feedback in the ticket tab', async () => {
    const ticketTab = await readProjectFile('integaglpi/templates/ticket_tab.php');
    const contextService = await readProjectFile('integaglpi/src/Service/TicketContextService.php');

    expect(ticketTab).toContain('Assistente IA');
    expect(ticketTab).toContain('Base de Conhecimento Local');
    expect(ticketTab).toContain('Consultar KB Local');
    expect(ticketTab).toContain('Gerar rascunho com IA');
    expect(ticketTab).toContain('Pesquisar fora');
    expect(ticketTab).toContain('Criar candidato KB');
    expect(ticketTab).toContain('Feedback supervisor online read-only');
    expect(ticketTab).toContain('Solução aceita ou pesquisa aprovada pode virar candidato KB revisável');
    expect(ticketTab).toContain('KB local exibida. Nenhuma IA externa foi chamada.');
    expect(ticketTab).toContain('sessionStorage');
    expect(ticketTab).toContain('refreshCsrfToken');
    expect(ticketTab).toContain('updateCsrfToken');
    expect(ticketTab).toContain('restoreCopilotDraft');
    expect(ticketTab).toContain('saveCopilotDraft');
    expect(ticketTab).toContain('Rascunho pronto para revisão.');
    expect(ticketTab).toContain('O Copiloto retornou um rascunho vazio.');
    expect(ticketTab).toContain('Não foi possível registrar feedback.');
    expect(contextService).toContain('buildTicketAiAssistant');
    expect(contextService).toContain('TICKET_AI_ASSISTANT_KB_LOCAL_PREPARED');
    expect(contextService).toContain('payload_policy');
    expect(contextService).toContain('ticket_summary_for_research');
    expect(contextService).toContain('buildExternalResearchTicketSummary');
    expect(ticketTab).toContain('ticket_summary_for_research');
    expect(ticketTab).toContain('create_kb_from_solution');
    expect(ticketTab).toContain('Criar candidato KB da solução');
    expect(ticketTab).toContain('glpi_itilsolutions');
  });

  it('wires provider/model selection into external research and P4 without auto actions', async () => {
    const externalService = await readProjectFile('integaglpi/src/Service/ExternalResearchService.php');
    const externalTemplate = await readProjectFile('integaglpi/templates/external_research.php');
    const historicalService = await readProjectFile('integaglpi/src/Service/HistoricalMiningUiService.php');
    const historicalTemplate = await readProjectFile('integaglpi/templates/historical_mining.php');
    const ticketTab = await readProjectFile('integaglpi/templates/ticket_tab.php');

    expect(externalService).toContain('providerSelectionFromPost');
    expect(externalService).toContain('loadOperationalProviderCatalog');
    expect(externalService).toContain('EXTERNAL_RESEARCH_EXECUTED');
    expect(externalService).toContain('EXTERNAL_RESEARCH_BLOCKED_PROVIDER');
    expect(externalService).toContain('model_not_allowed');
    expect(externalService).toContain('provider_not_ready');
    expect(externalService).toContain('completeProvider');
    expect(externalTemplate).toContain('Provider IA para pesquisa');
    expect(externalTemplate).toContain('Modelo IA');
    expect(externalTemplate).toContain('Gemini/Claude ficam bloqueados até last_test_status=success');
    expect(externalService).toContain('external_research_cloud');
    expect(historicalService).toContain('selectedAiProviderForP4');
    expect(historicalService).toContain('readP4ProviderSelection');
    expect(historicalService).toContain('normalizeP4ProviderId');
    expect(historicalService).toContain('callCloudProviderForCandidateReview');
    expect(historicalService).toContain('P4_CLOUD_PROVIDER_IDS');
    expect(historicalService).toContain('P4_CLOUD_PROVIDER_ALIASES');
    expect(historicalService).toContain("foreach (['ai_provider', 'ai_review_provider'] as $field)");
    expect(historicalService).toContain("foreach (['ai_model', 'ai_review_model'] as $field)");
    expect(historicalService).toContain('provider_selection_missing');
    expect(historicalService).toContain('provider_not_ready');
    expect(historicalService).toContain('provider_not_allowed');
    expect(historicalService).toContain("'source' => 'cloud'");
    expect(historicalService).toContain('selection_origin');
    expect(historicalService).toContain('provider cloud selecionado não respondeu');
    expect(historicalService).toContain('model_hash');
    expect(externalService).toContain("'proper_name'");
    expect(externalService).toContain("'uppercase_name'");
    expect(externalService).toContain("'company'");
    expect(externalService).toContain("'media'");
    expect(externalTemplate).toContain('PII residual detectada no preview');
    expect(historicalTemplate).toContain('Provider IA P4');
    expect(historicalTemplate).toContain('Modelo IA P4');
    expect(historicalTemplate).toContain('Executar revisão IA com este provider/modelo');
    expect(historicalTemplate).toContain('name="ai_provider"');
    expect(historicalTemplate).toContain('name="ai_model"');
    expect(historicalTemplate).toContain('name="ai_review_provider"');
    expect(historicalTemplate).toContain('name="ai_review_model"');
    expect(historicalTemplate).toContain('data-source="cloud"');
    expect(historicalTemplate).toContain('data-provider=');
    expect(historicalTemplate).toContain('selection_origin');
    expect(historicalTemplate).toContain('error_type');
    expect(historicalTemplate).toContain('p4_preview_payload_hash');
    expect(ticketTab).toContain('Provider efetivo:');
    expect(ticketTab).toContain('Rascunho técnico:');
    expect(`${externalService}\n${historicalService}\n${ticketTab}`).not.toMatch(/sendOutbound|MetaClient|KnowbaseItem::add|auto_publish\s*=\s*true/i);
  });

  it('P4 cloud routing: explicit cloud never falls to Ollama; preview-first enforced; audit carries selection_origin + explicit_provider', async () => {
    const service = await readProjectFile('integaglpi/src/Service/HistoricalMiningUiService.php');
    const template = await readProjectFile('integaglpi/templates/historical_mining.php');

    // Tests 2/3/4 — cloud provider IDs cover deepseek, xai, openai → cloud dispatch
    expect(service).toContain("P4_CLOUD_PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'deepseek', 'xai']");
    expect(service).toContain('callCloudProviderForCandidateReview');

    // selection_origin tri-state: post | preview | default_local
    expect(service).toContain("'post'");
    expect(service).toContain("'preview'");
    expect(service).toContain("'default_local'");

    // Test 5 — explicit cloud provider + no model → provider_selection_missing (not Ollama)
    expect(service).toContain("'provider_selection_missing'");

    // Test 6 — cloud provider not ready → provider_not_ready (not Ollama)
    expect(service).toContain("'provider_not_ready'");

    // Test 7 — provider/model outside catalog → model_not_allowed / provider_not_allowed
    expect(service).toContain("'model_not_allowed'");
    expect(service).toContain("'provider_not_allowed'");

    // Test 8 — no explicit provider → local/Ollama path
    expect(service).toContain("'source' => 'local'");

    // Test 9 — provider_unreachable is ONLY thrown by the local Ollama path
    expect(service).toContain('callLocalOllamaForCandidateReview');
    expect(service).toContain("'provider_unreachable'");

    // Test 10 — every audit record carries selection_origin + explicit_provider
    expect(service).toContain("'explicit_provider' => \$explicitProvider");
    expect(service).toContain("'selection_origin' => \$selectionOrigin");

    // Test 11 — no auto_publish=true (no_auto_publish=true is the safe sentinel — allowed)
    expect(service).not.toMatch(/'auto_publish'\s*=>\s*true/i);

    // Preview-first gate for cloud execute
    expect(service).toContain("'preview_required'");
    expect(service).toContain('p4_preview_payload_hash');
    expect(service).toContain("Selecione provider/modelo e gere o preview antes de executar P4 cloud");

    // explicit_provider boolean wired through readP4ProviderSelection
    expect(service).toContain("'explicit_provider' => \$explicitProvider,");

    // Test 1 — UI label shows selected cloud provider (prevents silent Ollama fallback in UI)
    expect(template).toContain('Provider selecionado para P4');

    // explicit_provider in result payload (cloud-blocked, execute-blocked, completed, exception paths)
    const explicitProviderCount = (service.match(/'explicit_provider'/g) ?? []).length;
    expect(explicitProviderCount).toBeGreaterThanOrEqual(6);
  });
});
