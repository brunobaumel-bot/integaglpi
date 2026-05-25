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
    const template = await readProjectFile('integaglpi/templates/ai_config.php');

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
    expect(service).toContain('externalResearchStatus');
    expect(service).toContain('p4CandidateReviewStatus');
    expect(service).toContain('secrets_in_env_only');
    expect(service).toContain('no_raw_ticket_to_ai');
    expect(template).toContain('auth_key_visible');
    expect(template).toContain('Validar gates para habilitar cloud');
    expect(template).toContain('Validar configuração local sem dados reais');
    expect(template).toContain('Habilitar IA Supervisora no plugin');
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
    expect(phpService).toContain('previewAiCandidateReview');
    expect(phpService).toContain('executeAiCandidateReview');
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
    expect(phpService).toContain('provider_url_not_local');
    expect(phpService).toContain('glpi_plugin_integaglpi_kb_candidates');
    expect(phpService).toContain('glpi_plugin_integaglpi_kb_candidate_reviews');
    expect(phpService).toContain('glpi_plugin_integaglpi_hist_mining_runs');
    expect(phpService).toContain('p4_no_raw_history');
    expect(phpService).toContain('p4_no_auto_publish');
    expect(phpService).toContain('provider_unavailable');
    expect(phpService).toContain('confidence_below_threshold');
    expect(phpService).toContain('human_review_required');
    expect(template).toContain('4. Revisão IA opcional P4');
    expect(template).toContain('P4 usa apenas candidatos P3 sanitizados');
    expect(template).toContain('revisão humana obrigatória');
    expect(template).toContain('Confiança abaixo do limite');
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

    expect(ticketTab).toContain('sessionStorage');
    expect(ticketTab).toContain('refreshCsrfToken');
    expect(ticketTab).toContain('updateCsrfToken');
    expect(ticketTab).toContain('restoreCopilotDraft');
    expect(ticketTab).toContain('saveCopilotDraft');
    expect(ticketTab).toContain('Rascunho pronto para revisão.');
    expect(ticketTab).toContain('O Copiloto retornou um rascunho vazio.');
    expect(ticketTab).toContain('Não foi possível registrar feedback.');
  });
});
