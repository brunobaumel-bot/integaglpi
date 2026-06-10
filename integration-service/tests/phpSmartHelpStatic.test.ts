import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): Promise<string> => readFile(resolve(repoRoot, p), 'utf8');

describe('PHP Smart Help consumer + native KB search (static safety)', () => {
  it('Copilot UI never surfaces raw COPILOT_DRAFT_INVALID_JSON to the technician', async () => {
    const front = await read('integaglpi/front/copilot.draft.php');
    const tab = await read('integaglpi/templates/ticket_tab.php');

    expect(front).toContain("integaglpiCopilotUserMessage($rawMessage)");
    expect(front).toContain("$response['body']['message'] = $displayMessage");
    expect(front).toContain('O Copiloto não conseguiu montar um rascunho confiável');
    expect(tab).toContain('function copilotFriendlyMessage(message)');
    expect(tab).toContain('COPILOT_DRAFT_(INVALID_JSON|INVALID_SHAPE|INVALID_ENUM|EMPTY)');
    expect(tab).toContain('copilotStatus.textContent = copilotFriendlyMessage');
  });

  it('SmartHelpService is read-only, consent-gated, RBAC-gated and never leaks the auth key', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    // Calls the Node AI endpoints.
    expect(svc).toContain("/internal/glpi/ai/smart-help");
    expect(svc).toContain("/internal/glpi/ai/external-research/dynamic");
    expect(svc).toContain("/internal/glpi/ai/kb-feedback");
    expect(svc).toContain("/internal/glpi/ai/coaching/checklist");
    expect(svc).toContain("/internal/glpi/ai/coaching/suggest-kb");

    // Cloud requires explicit human consent.
    expect(svc).toContain('if (!$humanConsent)');
    expect(svc).toContain("'status' => 'no_consent'");

    // RBAC gate for the panel.
    expect(svc).toContain('canViewPanel');
    expect(svc).toContain('Plugin::canRead()');
    expect(svc).not.toContain('Session::getLoginUserID()');

    // Bearer is sent but never logged; error_log only carries sanitized text.
    expect(svc).toContain('Authorization: Bearer ');
    expect(svc).not.toMatch(/error_log\([^)]*authKey/i);
    expect(svc).not.toMatch(/error_log\([^)]*Bearer/i);

    // No ticket mutation / WhatsApp / auto-publish in the consumer.
    expect(svc).not.toMatch(/->update\(|ITILFollowup|TicketTask|sendOutbound|sendWhatsApp/i);
  });

  it('Smart Help is local-first: searches the native KB in PHP and never returns a raw error', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    const front = await read('integaglpi/front/smart.help.php');

    // A local-first method exists and uses the native KB search directly in PHP.
    expect(svc).toContain('function localFirstAssist');
    expect(svc).toContain('NativeKnowledgeBaseService');
    expect(svc).toContain('searchVisibleArticles');
    expect(svc).toContain('buildTechnicalSummary');
    expect(svc).toContain('technicalSummary');
    expect(svc).toContain('migration044SchemaStatus');
    expect(svc).toContain('file_check_only_no_db_mutation');
    // Always returns ok:true (degrades to a local checklist/questions instead of erroring).
    expect(svc).toMatch(/'ok'\s*=>\s*true/);
    expect(svc).toContain('defaultChecklist');
    expect(svc).toContain('defaultQuestions');
    expect(svc).toMatch(/'degraded'/);

    // The dedicated endpoint keeps summary-only separate from the local-first search.
    expect(front).toContain("if ($action === 'summarize_ticket')");
    expect(front).toContain('buildTicketContextSummary($ticket)');
    expect(front).toContain('summarizeTicket($ticketId, $summary, $wantAiSummary)');
    expect(front).toContain("if ($action === 'smart_help')");
    expect(front).toContain("if ($action === 'local_search')");
    const summarizeStart = front.indexOf("if ($action === 'summarize_ticket')");
    const smartHelpStart = front.indexOf("if ($action === 'smart_help')");
    const summarizeBlock = front.slice(summarizeStart, smartHelpStart);
    expect(summarizeStart).toBeGreaterThanOrEqual(0);
    expect(smartHelpStart).toBeGreaterThan(summarizeStart);
    expect(summarizeBlock).not.toContain('localFirstAssist');
    expect(summarizeBlock).not.toContain('NativeKnowledgeBaseService');
    expect(summarizeBlock).not.toContain('prepareExternalContext');
  });

  it('SmartHelp summary context uses recent conversation messages before ticket title/content', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    const front = await read('integaglpi/front/smart.help.php');
    const js = await read('integaglpi/js/ticket_ai_panel.js');

    expect(front).toContain('buildTicketContextSummary($ticket)');
    expect(svc).toContain('function buildTicketContextSummary');
    expect(svc).toContain('buildRecentConversationMessageContext');
    expect(svc).toContain('glpi_plugin_integaglpi_conversations');
    expect(svc).toContain('glpi_plugin_integaglpi_messages');
    expect(svc).toContain('WHERE glpi_ticket_id = :ticket_id');
    expect(svc).toContain('Mensagens recentes da conversa atual');
    expect(svc).toContain('$messageContext !== \'\'');
    expect(js).toContain("panel.dataset.ticketId || '0'");
    expect(js).toContain("panel.dataset.conversationId || 'none'");
    expect(js).toContain('function contextHash(panel)');
  });

  it('SmartHelp enforces summary-only output and contextual KB relevance gates', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    expect(svc).toContain('function enforceSummaryContract');
    expect(svc).toContain('Para solucionar|consulte o artigo|Base de Conhecimento');
    expect(svc).toContain('function evaluateKbRelevance');
    expect(svc).toContain('function hasConflictingKbDomain');
    expect(svc).toContain('function isGenericTestContext');
    expect(svc).toContain('function isWindowsActivationContext');
    expect(svc).toContain('Teste do sistema sem descrição de problema técnico.');
    expect(svc).toContain('Windows exibindo mensagem solicitando ativação.');
    expect(svc).toContain('function structuredSummary');
    expect(svc).toContain('Sistema afetado: ');
    expect(svc).toContain('Referência local candidata; baixa confiança, valide antes de usar');
    expect(svc).toMatch(/logon\|login\|servidor\|dominio\|active directory\|ad/i);
  });

  it('external research never claims success / candidate without a usable answer', async () => {
    const svc = await read('integaglpi/src/Service/ExternalResearchService.php');
    const tpl = await read('integaglpi/templates/external_research.php');

    // Backend gate: no_actionable_result + candidate generation blocked.
    expect(svc).toContain('isResearchActionable');
    expect(svc).toContain("'status' => 'no_actionable_result'");
    expect(svc).toContain('A pesquisa não retornou orientação técnica utilizável.');
    expect(svc).toContain('EXTERNAL_RESEARCH_CANDIDATE_BLOCKED_NO_ACTIONABLE');
    // Never auto-publishes / sends regardless of outcome.
    expect(svc).not.toMatch(/sendOutbound|sendWhatsApp/i);
    expect(svc).not.toMatch(/'auto_publish'\s*=>\s*true/i);

    // Template demotes the source catalog to advanced/legacy and disables candidate
    // generation when the last result was non-actionable.
    expect(tpl).toContain('avançado / legado');
    expect(tpl).toContain("'no_actionable_result'");
    expect(tpl).toContain('$noActionable');
  });

  it('ticket_tab.php renders an RBAC-gated, read-only Smart Help panel', async () => {
    const tab = await read('integaglpi/templates/ticket_tab.php');

    // Panel + RBAC gate.
    expect(tab).toContain('integaglpi-smart-help');
    expect(tab).toContain('SmartHelpService::canViewPanel()');
    expect(tab).toContain('$smartHelpReadGateVisible');
    expect(tab).toContain('!$replyOwnedByCurrentUser');
    expect(tab).toContain('js-smart-help-summarize');
    expect(tab).toContain('js-smart-help-local-search');
    expect(tab).toContain('js-smart-help-external');
    expect(tab).toContain('js-smart-help-suggest-kb');
    expect(tab).toContain('js-smart-help-technical-summary');
    expect(tab).toContain('data-conversation-id');
    expect(tab).toContain('Resumo do chamado');
    expect(tab).toContain('Busca local');
    expect(tab).toContain('Pedir ajuda externa (nuvem)');
    expect(tab).toContain('Resumo técnico sem dados pessoais');
    // (js-smart-help-feedback buttons are rendered per-article by the JS.)
    // Read-only disclaimer + consent text.
    expect(tab).toContain('nada é enviado ao cliente nem altera o chamado');
    expect(tab).toContain('Processo guiado: gere o resumo, execute a busca local');
    expect(tab).toContain('Processo guiado somente leitura');
    // Assets inlined only when the panel is visible.
    expect(tab).toContain('ticket_ai_panel.js');
    expect(tab).toContain('ticket_ai_panel.css');
  });

  it('ticket tab runtime layout places Copiloto above Ajuda Inteligente below reply controls', async () => {
    const tab = await read('integaglpi/templates/ticket_tab.php');

    expect(tab).toContain('js-integaglpi-tab-reply-send');
    expect(tab).toContain('body.insertBefore(copilot, smartHelp)');
    expect(tab).toContain('body.appendChild(assistant)');
    expect(tab.indexOf('var smartHelp = card.querySelector')).toBeLessThan(tab.indexOf('body.insertBefore(copilot, smartHelp)'));
    expect(tab.indexOf('body.insertBefore(copilot, smartHelp)')).toBeLessThan(tab.indexOf('body.appendChild(assistant)'));
    expect(tab).toContain('js-integaglpi-copilot');
    expect(tab).toContain('integaglpi-smart-help');
  });

  it('smart.help.php dedicated endpoint is JSON-only, CSRF-gated and read-only', async () => {
    const front = await read('integaglpi/front/smart.help.php');

    expect(front).toContain('Session::checkLoginUser()');
    expect(front).toContain("header('Content-Type: application/json; charset=UTF-8')");
    expect(front).toContain('function integaglpiSmartHelpJsonResponse');
    expect(front).toContain('Plugin::getCsrfToken()');
    expect(front).toContain("(string) (\$_GET['csrf_token'] ?? '') === '1'");
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(front).toContain('SmartHelpService::canViewPanel()');
    expect(front).toContain("'list_external_history'");
    expect(front).toContain("'create_kb_candidate_from_external_history'");
    expect(front).toContain("if ($action === 'summarize_ticket')");
    expect(front).toContain("if ($action === 'smart_help')");
    expect(front).toContain("if ($action === 'local_search')");
    expect(front).not.toMatch(/->update\(|->add\(|ITILFollowup|TicketTask|sendOutbound|sendWhatsApp/i);
  });

  it('smart.help.php returns typed JSON errors for every SmartHelp action', async () => {
    const front = await read('integaglpi/front/smart.help.php');

    expect(front).toContain('function integaglpiSmartHelpErrorType');
    expect(front).toContain('function integaglpiSmartHelpUserMessage');
    expect(front).toContain("'error_type' => $errorType");
    expect(front).toContain("'type_error'");
    expect(front).toContain("'provider_unavailable'");
    expect(front).toContain("'node_timeout'");
    expect(front).toContain("'missing_context'");
    expect(front).toContain("'permission_denied'");
    expect(front).toContain("'configuration_pending'");
    expect(front).toContain("$action === 'summarize_ticket'");
    expect(front).toContain("if ($action === 'local_search')");
    expect(front).toContain("if ($action === 'kb_feedback')");
    expect(front).toContain("if ($action === 'smart_external'");
    expect(front).toContain("if ($action === 'suggest_kb')");
    expect(front).toContain("catch (Throwable $exception)");
  });

  it('smart.help.php blocks KB feedback before persistence when schema 044 is pending', async () => {
    const front = await read('integaglpi/front/smart.help.php');

    expect(front).toContain('$schema044Status = SmartHelpService::migration044SchemaStatus();');
    expect(front).toContain("'error' => 'schema_pending'");
    expect(front).toContain("'error_type' => 'schema_pending'");
    expect(front).toContain("'feedback_available' => false");
    expect(front).toContain('Feedback indisponível: schema 044 pendente de homologação.');
    expect(front.indexOf('$schema044Status = SmartHelpService::migration044SchemaStatus();'))
      .toBeLessThan(front.indexOf('$smartHelp->recordFeedback('));
  });

  it('analyze conversation uses the JSON ticket action endpoint and catches KB normalization failures', async () => {
    const action = await read('integaglpi/front/ticket.whatsapp.action.php');
    const tab = await read('integaglpi/templates/ticket_tab.php');
    const globalJs = await read('integaglpi/js/integaglpi.js');

    expect(action).toContain("if ($action === 'analyze_conversation')");
    expect(action).toContain('Plugin::isAiSupervisorEnabled()');
    expect(action).toContain('requestAiQualityAnalysis');
    expect(action).toContain('NativeKnowledgeBaseService');
    expect(action).toContain('[integaglpi][ai_action][analyze_conversation][kb_context_error]');
    expect(action).toContain("'error_type' => $status >= 500 ? 'provider_unavailable' : 'internal_error'");
    expect(action).toContain('Análise IA registrada para revisão humana.');
    expect(action).toContain('function plugin_integaglpi_is_ajax_json_request');
    expect(action).toContain("$_SERVER['HTTP_X_REQUESTED_WITH']");
    expect(action).toContain("'application/json'");
    expect(action).toContain("plugin_integaglpi_ticket_action_safe_text(");
    const nonAjaxGateStart = action.indexOf('if (in_array($action, $aiAssistActions, true) && !plugin_integaglpi_is_ajax_json_request())');
    const csrfCheckStart = action.indexOf('if (!Plugin::isCsrfValid($_POST))');
    expect(nonAjaxGateStart).toBeGreaterThanOrEqual(0);
    expect(csrfCheckStart).toBeGreaterThan(nonAjaxGateStart);
    expect(action.slice(nonAjaxGateStart, csrfCheckStart)).not.toContain('csrf_token');
    expect(action).toContain('function plugin_integaglpi_ticket_action_json(array $payload, int $statusCode, bool $includeCsrfToken = true): never');
    expect(action).toContain('if ($includeCsrfToken && !array_key_exists(\'csrf_token\', $payload))');
    expect(action).toContain('], 405, false);');

    expect(tab).toContain('js-integaglpi-ai-quality-analyze-form');
    expect(tab).toContain('Plugin::getTicketActionUrl()');
    expect(tab).toContain('name="whatsapp_action" value="analyze_conversation"');
    expect(tab).toContain('type="button" class="btn btn-sm btn-outline-primary js-integaglpi-ai-quality-analyze-submit"');
    expect(globalJs).toContain('function handleAiQualityAnalyzeForm(form, event)');
    expect(globalJs).toContain("document.addEventListener('click', onDocumentClick, false)");
    expect(globalJs).toContain("document.addEventListener('submit', onDocumentSubmit, true)");
    expect(globalJs).toContain("findClosest(target, '.js-integaglpi-ai-quality-analyze-submit')");
    expect(globalJs).toContain("findClosest(target, '.js-integaglpi-ai-quality-analyze-form')");
    expect(globalJs).toContain('event.preventDefault();');
    expect(globalJs).toContain('event.stopPropagation();');
    expect(globalJs).toContain('event.stopImmediatePropagation');
    expect(globalJs).toContain("'X-Requested-With': 'XMLHttpRequest'");
    expect(globalJs).toContain("'X-Glpi-Csrf-Token': csrfToken");
    expect(globalJs).toContain("'Accept': 'application/json'");
    expect(globalJs).toContain("fetch(form.action, {");
    expect(globalJs).toContain('JSON.parse(text)');
    expect(globalJs).toContain('result.body.error_type');
    expect(globalJs).toContain('updateFormCsrfToken(form, result.body.csrf_token)');
    expect(tab).not.toContain('function runIntegaglpiAiQualityAnalysis(form, event)');
    expect(tab).not.toContain('name="action" value="analyze"');
  });

  it('native KB string matching is audited for mixed search terms before str_contains', async () => {
    const nativeKb = await read('integaglpi/src/Service/NativeKnowledgeBaseService.php');
    const action = await read('integaglpi/front/ticket.whatsapp.action.php');

    expect(nativeKb).toContain('private function extractSearchTokens(string $value): array');
    expect(nativeKb).toContain('$token = trim($token);');
    expect(nativeKb).toContain('private function normalizeSearchNeedle(mixed $value): ?string');
    expect(nativeKb).toContain('if (!is_scalar($value))');
    expect(nativeKb).toContain('$needle = $this->normalizeSearchNeedle($token);');
    expect(nativeKb).toContain('if ($needle === null)');
    expect(nativeKb).toContain('str_contains($normalizedHaystack, $needle)');
    expect(nativeKb).toContain('foreach (array_keys($tokens) as $token)');
    expect(nativeKb).toContain('private function normalizeSearchTerm(mixed $value): ?string');
    expect(nativeKb).toContain('if (!is_string($value))');
    expect(nativeKb).not.toContain('str_contains($normalizedHaystack, $token)');
    expect(nativeKb).not.toContain('str_contains($normalizedHaystack, (int)');
    expect(action).toContain('catch (\\Throwable $kbException)');
    expect(action).toContain('kb_context_error');
  });

  it('smart_external cloud action requires Plugin::canUpdate() on top of canViewPanel()', async () => {
    const front = await read('integaglpi/front/smart.help.php');

    // Cloud-flow gate: both preview AND send require canUpdate() before any cloud step.
    expect(front).toContain("in_array($action, ['prepare_external_context', 'smart_external', 'create_kb_candidate_from_external_history'], true) && !Plugin::canUpdate()");
    expect(front).toContain("'error_type' => 'permission_denied'");
    expect(front).toContain('SmartHelpService::canViewPanel()');
    // Human consent still required even after permission check.
    expect(front).toContain("(\$_POST['consent'] ?? '') === '1'");
    // Local-only actions (smart_help/summarize_ticket/local_search, kb_feedback, suggest_kb) do NOT require canUpdate().
    expect(front).toContain("if ($action === 'summarize_ticket')");
    expect(front).toContain("if ($action === 'smart_help')");
    expect(front).toContain("$action === 'summarize_ticket'");
    expect(front).toContain("if ($action === 'local_search')");
    expect(front).toContain("if ($action === 'kb_feedback')");
    expect(front).toContain("if ($action === 'suggest_kb')");
  });

  it('ticket WhatsApp SmartHelp KB actions require GLPI ticket READ permission', async () => {
    const action = await read('integaglpi/front/ticket.whatsapp.action.php');

    const feedbackStart = action.indexOf("if ($action === 'kb_feedback')");
    const externalStart = action.indexOf("if ($action === 'smart_external')");
    const suggestStart = action.indexOf("if ($action === 'suggest_kb')");
    const analyzeStart = action.indexOf("if ($action === 'analyze_conversation')");
    expect(feedbackStart).toBeGreaterThanOrEqual(0);
    expect(externalStart).toBeGreaterThan(feedbackStart);
    expect(suggestStart).toBeGreaterThan(externalStart);
    expect(analyzeStart).toBeGreaterThan(suggestStart);

    const feedbackBlock = action.slice(feedbackStart, externalStart);
    const suggestBlock = action.slice(suggestStart, analyzeStart);
    for (const block of [feedbackBlock, suggestBlock]) {
      expect(block).toContain('$ticket = new \\Ticket();');
      expect(block).toContain('$ticket->getFromDB($ticketId)');
      expect(block).toContain('$ticket->can($ticketId, READ)');
      expect(block).toContain("'error' => 'permission_denied'");
      expect(block).toContain("'error_type' => 'permission_denied'");
      expect(block).toContain('], 403);');
    }
  });

  it('cloud external research is a two-step sanitized-preview flow (prepare → confirm send)', async () => {
    const front = await read('integaglpi/front/smart.help.php');
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    const node = await read('integration-service/src/controllers/ai.controller.ts');
    const js = await read('integaglpi/js/ticket_ai_panel.js');

    // ── PHP: prepare step exists, builds context server-side, no consent (no send) ──
    expect(front).toContain("if (\$action === 'prepare_external_context')");
    expect(front).toContain('prepareExternalContext($ticketId, $externalSummary)');
    // Send step still requires explicit consent.
    expect(front).toContain("\$consent = (\$_POST['consent'] ?? '') === '1'");
    expect(front).toContain('externalResearch(');
    expect(front).toContain("'ai_provider' => trim((string) (\$_POST['ai_provider'] ?? ''))");
    expect(front).toContain("'ai_model' => trim((string) (\$_POST['ai_model'] ?? ''))");

    // ── PHP service: preview path is the dedicated preview endpoint ──
    expect(svc).toContain("/internal/glpi/ai/external-research/preview");
    expect(svc).toContain('function prepareExternalContext');
    // Send path reuses the PHP controlled research engine because Node dynamic
    // research intentionally has no cloud provider wired.
    expect(svc).toContain('confirmInlineResearch(');
    expect(svc).toContain('new ExternalResearchService($this->config)');

    // ── Node controller: cloud-safe rewrite returns cloud-safe text + safe flag, never raw, no cloud ──
    expect(node).toContain('createExternalResearchPreviewController');
    expect(node).toContain('service.rewriteCloudSafe(context)');
    expect(node).toContain('cloud_safe_context: rw.cloudSafeContext');
    expect(node).toContain('removed_kinds: rw.removedKinds');
    expect(node).toContain('SMARTHELP_CLOUD_RESIDUAL_MODE');
    expect(node).toContain('remote_execution: false');
    // The preview controller must NOT call researchDynamic (no cloud send in step 1).
    const prevStart = node.indexOf('createExternalResearchPreviewController');
    const prevEnd = node.indexOf('createCoachingChecklistController');
    const prevBody = node.slice(prevStart, prevEnd);
    expect(prevBody).not.toContain('researchDynamic');

    // ── JS: step 1 calls prepare; step 2 (confirmed) calls smart_external with consent ──
    expect(js).toContain("post(panel, 'prepare_external_context'");
    expect(js).toContain('function handleExternalSend');
    expect(js).toContain("var previewEl = panel.querySelector('.js-smart-help-external-preview')");
    expect(js).toContain("sanitized_context: sanitizedContext");
    expect(js).toContain("technical_summary: sanitizedContext");
    expect(js).toContain('js-smart-help-external-send');
    // Clear blocked / ready messaging — never a silent failure.
    expect(js).toContain('Contexto técnico para nuvem gerado a partir do resumo local');
    expect(js).toContain('Contexto técnico pronto para envio');
    expect(js).toContain('Bloqueado por PII');
    expect(js).toContain('Tipos removidos:');
  });

  it('SmartHelp inline external research uses Secret Vault providers supported by PHP', async () => {
    const externalResearch = await read('integaglpi/src/Service/ExternalResearchService.php');
    const aiConfig = await read('integaglpi/src/Service/AiConfigViewService.php');
    const smartHelp = await read('integaglpi/src/Service/SmartHelpService.php');

    expect(externalResearch).toContain('public function confirmInlineResearch');
    expect(externalResearch).toContain("'trusted_sanitized_context' => '1'");
    expect(externalResearch).toContain('$blockOnDetected = empty($post[\'trusted_sanitized_context\'])');
    expect(externalResearch).toContain('sanitizePrompt((string) ($post[\'technical_summary\'] ?? \'\'), $blockOnDetected)');
    expect(externalResearch).toContain('$post[\'preview_token\'] = $this->previewToken($context)');
    expect(externalResearch).toContain("'summary' => (string) (\$cloudResult['response_text'] ?? '')");
    expect(smartHelp).toContain('external_research_controlled_php');
    expect(aiConfig).toContain("$preferredCloud = ['deepseek', 'openai', 'xai', 'gemini', 'anthropic']");
  });

  it("the smart help JS never auto-runs guided SmartHelp or cloud (manual click only)", async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const globalJs = await read('integaglpi/js/integaglpi.js');
    // Page load only marks the panel ready. It must not POST guided actions automatically.
    expect(js).toContain("p.dataset.smartHelpJsReady = '1'");
    expect(js).toContain("post(panel, 'summarize_ticket', { ai_summary: '1' }");
    expect(js).toContain("post(panel, 'local_search', { technical_summary: summary }");
    expect(js).toContain('document.readyState !== \'loading\'');
    expect(js).toContain('event.preventDefault();');
    expect(js).toContain('handleSummarize(panel)');
    expect(js).toContain('handleLocalSearch(panel)');
    expect(js).toContain('Gerando resumo com IA local...');
    expect(js).toContain('setButtonLoading(runBtn');
    expect(js).toContain('Falha HTTP ');
    expect(js).toContain('Revise permissões, schema 044 e configuração local.');
    expect(js).toContain('PII Guard');
    expect(js).toContain('glpi_knowbaseitem_id');
    expect(js).toContain('Confiança operacional');
    expect(js).toContain('var feedbackEnabled = !!schema.ok');
    expect(js).toContain('Feedback indisponível: schema 044 pendente de homologação.');
    expect(js).toContain("result.ok === true && result.status === 'recorded'");
    expect(js).toContain('feedback registrado');
    expect(js).not.toContain("fb.parentNode.innerHTML = '<span class=\"text-muted small\">obrigado</span>'");
    // External (cloud) only via the explicit button + confirm dialog.
    expect(js).toContain('window.confirm');
    expect(js).toContain("post(panel, 'smart_external', {");
    expect(js).toContain('ai_provider: providerSelection.provider');
    expect(js).toContain('ai_model: providerSelection.model');
    expect(js).toContain("btn.classList.contains('js-smart-help-summarize')");
    expect(js).toContain("'Resumo do chamado'");
    // DOMContentLoaded auto-runs neither guided actions nor smart_external.
    const onLoad = js.slice(js.indexOf('DOMContentLoaded'));
    expect(onLoad).not.toContain("post(panel, 'smart_help'");
    expect(onLoad).not.toContain("post(panel, 'summarize_ticket'");
    expect(onLoad).not.toContain("post(panel, 'local_search'");
    expect(onLoad).not.toContain('handleSummarize(');
    expect(onLoad).not.toContain('handleLocalSearch(');
    expect(onLoad).not.toContain('smart_external');

    // Global plugin JS also provides a delegated fallback for dynamically loaded
    // GLPI ticket tabs where inline scripts may not execute.
    expect(globalJs).toContain("'.integaglpi-smart-help .js-smart-help-summarize");
    expect(globalJs).toContain("params.set('smart_action', action)");
    expect(globalJs).toContain("params.set('_glpi_csrf_token', token)");
    expect(globalJs).toContain("'X-Glpi-Csrf-Token': token");
    expect(globalJs).toContain("'X-Requested-With': 'XMLHttpRequest'");
    expect(globalJs).toContain("smartHelpPost(panel, action, extra)");
    expect(globalJs).toContain("smartHelpRenderLocal(panel, responseResult)");
    expect(globalJs).toContain('function smartHelpSanitizedPreview(panel)');
    expect(globalJs).toContain('extra.sanitized_context = sanitizedContext');
    expect(globalJs).toContain('js-smart-help-external-preview');
    expect(globalJs).toContain("action === 'local_search'");
    expect(globalJs).toContain("action === 'prepare_external_context'");
    expect(globalJs).toContain("action === 'smart_external'");
    expect(globalJs).toContain("if (panel.dataset.smartHelpJsReady === '1') return;");
    expect(globalJs).not.toContain("alert('Clique capturado pelo integaglpi')");
  });

  it('smart help guided workflow uses session state and gates cloud until local search', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const front = await read('integaglpi/front/smart.help.php');
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    expect(js).toContain('function flowKey(panel, mode)');
    expect(js).toContain('sessionStorage.setItem(flowKey(panel, mode)');
    expect(js).toContain("state.step === 'local_searched'");
    expect(js).toContain("externalBtn.dataset.cloudOffer === '1'");
    expect(js).toContain('externalBtn.disabled = !(localSearched && cloudOffered)');
    expect(js).toContain("saveFlow(panel, { step: 'summarized', view_model: safeSmartHelpViewModel(r) }, 'summary')");
    expect(js).toContain("saveFlow(panel, { step: 'local_searched', view_model: safeSmartHelpViewModel(r) }, 'local_search')");
    expect(js).toContain("post(panel, 'prepare_external_context', { technical_summary: currentSummary(panel) }");
    expect(js).toContain("post(panel, 'smart_external', {");
    expect(js).toContain('function selectedExternalProvider');

    expect(front).toContain("if ($action === 'local_search')");
    expect(front).toContain('$searchSummary = $currentSummary !== \'\'');
    expect(front).toContain('workflow_step');
    expect(svc).toContain('function localAiSuggestion');
    expect(svc).toContain("'source' => 'local_ai'");
    expect(svc).toContain("'source_label' => 'IA local'");
    expect(svc).toContain("'unverified' => true");
    expect(svc).toContain('fallbackLocalSuggestion');
  });

  it('SmartHelp external help keeps server-side history, provider selection and category-linked KB candidates', async () => {
    const front = await read('integaglpi/front/smart.help.php');
    const smartHelp = await read('integaglpi/src/Service/SmartHelpService.php');
    const externalResearch = await read('integaglpi/src/Service/ExternalResearchService.php');
    const tab = await read('integaglpi/templates/ticket_tab.php');
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const globalJs = await read('integaglpi/js/integaglpi.js');
    const migration = await read('integration-service/schema-migrations/046_external_help_history_provider_kb_category.sql');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_help_history');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS source_external_history_id');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS glpi_category_id');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS glpi_category_name');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS');
    expect(migration).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);

    expect(front).toContain("'list_external_history'");
    expect(front).toContain("'create_kb_candidate_from_external_history'");
    expect(front).toContain("in_array($action, ['prepare_external_context', 'smart_external', 'create_kb_candidate_from_external_history'], true) && !Plugin::canUpdate()");
    expect(front).toContain("listExternalHistory(");
    expect(front).toContain("createKbCandidateFromExternalHistory(");
    expect(front).toContain("'ai_provider' => trim((string) (\$_POST['ai_provider'] ?? ''))");
    expect(front).toContain("'ai_model' => trim((string) (\$_POST['ai_model'] ?? ''))");

    expect(smartHelp).toContain('recordExternalHelpHistory');
    expect(smartHelp).toContain('listExternalHelpHistory');
    expect(smartHelp).toContain('providerCatalogForSmartHelp');
    expect(smartHelp).toContain('createKbCandidateFromExternalHistory');
    expect(smartHelp).toContain("'history_persisted' => $historyItem !== null");

    expect(externalResearch).toContain("private const HELP_HISTORY_TABLE = 'glpi_plugin_integaglpi_external_help_history'");
    expect(externalResearch).toContain('public function providerCatalogForSmartHelp');
    expect(externalResearch).toContain('public function recordExternalHelpHistory');
    expect(externalResearch).toContain('public function listExternalHelpHistory');
    expect(externalResearch).toContain('public function createKbCandidateFromExternalHistory');
    expect(externalResearch).toContain('$ticket->fields[\'itilcategories_id\']');
    expect(externalResearch).toContain('\\Dropdown::getDropdownName');
    expect(externalResearch).toContain("'publication_status' => 'draft/manual_review'");
    expect(externalResearch).toContain("'no_autopublish' => true");
    expect(externalResearch).not.toMatch(/sendOutbound|sendWhatsApp/i);

    expect(tab).toContain('js-smart-help-provider');
    expect(tab).toContain('IA para pesquisa externa');
    expect(tab).toContain('js-smart-help-history');

    expect(js).toContain('function selectedExternalProvider');
    expect(js).toContain('function renderExternalProviderCatalog');
    expect(js).toContain('function renderExternalHistory');
    expect(js).toContain("post(panel, 'list_external_history'");
    expect(js).toContain("'create_kb_candidate_from_external_history'");
    expect(js).toContain('post(panel, action, payload');
    expect(js).toContain('data-history-id');
    expect(js).toContain('panel.dataset.activeExternalHistoryId');
    expect(js).toContain('history_item');
    expect(js).toContain('ai_provider: providerSelection.provider');
    expect(globalJs).toContain('extra.ai_provider = providerParts[0]');
  });

  it('smart help JS post() uses AbortController timeout so the run button never stays disabled', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');

    // Timeout constant defined.
    expect(js).toContain('SMART_HELP_TIMEOUT_MS');
    // AbortController used when available.
    expect(js).toContain('AbortController');
    expect(js).toContain('controller.abort()');
    expect(js).toContain('signal: controller');
    // Catch always resolves (returns object, never re-throws) so .finally() re-enables the button.
    expect(js).toContain("error: aborted ? 'timeout' : 'network_error'");
    expect(js).toContain('clearTimer');
    // handleExternal handles transport-level failure (ok: false, no result).
    expect(js).toContain('resp.ok === false && resp.error && !resp.result');
    expect(js).toContain("resp.error === 'timeout'");
  });

  it('smart help JS guided buttons are only disabled on user-initiated click', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');

    expect(js).toContain('function setButtonLoading');
    expect(js).toContain('function handleSummarize(panel)');
    expect(js).toContain('function handleLocalSearch(panel)');
    expect(js).toContain("var runBtn = panel.querySelector('.js-smart-help-summarize')");
    expect(js).toContain("var searchBtn = panel.querySelector('.js-smart-help-local-search')");
    expect(js).toContain('setButtonLoading(runBtn');
    expect(js).toContain('setButtonLoading(searchBtn');
    // There is no page-load auto-run anymore.
    expect(js).not.toContain('runSmartHelp(p)');
    // Click handler emits a console.warn for diagnostics.
    expect(js).toContain("console.warn('[SmartHelp]");
    expect(js).toContain('action_url=');
    // JS marks panel as ready for smoke/DevTools confirmation.
    expect(js).toContain("p.dataset.smartHelpJsReady = '1'");
    // Missing action URL gives visible error immediately (not just a promise reject).
    expect(js).toContain('data-action-url ausente');
    expect(js).toContain('configuração pendente');
  });

  it('smart help sends the CSRF token through every GLPI-core channel and normalizes aliases server-side', async () => {
    const js  = await read('integaglpi/js/ticket_ai_panel.js');
    const front = await read('integaglpi/front/smart.help.php');

    // ── JS: same fresh token via 3 channels (canonical field, alias field, header) ──
    expect(js).toContain('var token = panel.dataset.csrf');
    expect(js).toContain("params.set('_glpi_csrf_token', token)");
    expect(js).toContain("params.set('csrf_token', token)");
    expect(js).toContain("'X-Glpi-Csrf-Token': token");
    // Mirrors copilot transport contract.
    expect(js).toContain("credentials: 'same-origin'");
    expect(js).toContain("'Accept': 'application/json'");

    // ── PHP: normalize aliases into the canonical field BEFORE isCsrfValid, never empty/bypass ──
    expect(front).toContain("trim((string) (\$_POST['_glpi_csrf_token'] ?? '')) === ''");
    expect(front).toContain("\$_POST['csrf_token']");
    expect(front).toContain("\$_SERVER['HTTP_X_GLPI_CSRF_TOKEN']");
    expect(front).toContain("\$_POST['_glpi_csrf_token'] = \$aliasToken");
    // Normalization happens before the mandatory validation.
    expect(front.indexOf("\$_POST['_glpi_csrf_token'] = \$aliasToken"))
      .toBeLessThan(front.indexOf('Plugin::isCsrfValid($_POST)'));
    // Empty token is never accepted (alias only copied when non-empty).
    expect(front).toContain("if (\$aliasToken !== '') {");
    // CSRF validation stays mandatory; cloud flow (preview + send) still requires UPDATE.
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(front).toContain("in_array($action, ['prepare_external_context', 'smart_external', 'create_kb_candidate_from_external_history'], true) && !Plugin::canUpdate()");

    // SmartHelp JS no longer targets the legacy ticket action endpoint.
    expect(js).not.toContain('ticket.whatsapp.action.php');
  });

  it('smart help uses manual preflight CSRF before POST and keeps typed fallback', async () => {
    const js  = await read('integaglpi/js/ticket_ai_panel.js');
    const front = await read('integaglpi/front/smart.help.php');

    // ── PHP side: every JSON response carries a fresh csrf_token ───────────────
    expect(front).toContain("array_key_exists('csrf_token', \$payload)");
    expect(front).toContain('Plugin::getCsrfToken()');
    // CSRF failure is typed so the JS can detect + retry.
    expect(front).toContain("'error' => 'csrf_invalid'");
    expect(front).toContain("'error_type' => 'csrf_failed'");
    // CSRF validation still runs (NOT removed/bypassed).
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    // Validation precedes SmartHelp action dispatch.
    expect(front.indexOf('Plugin::isCsrfValid($_POST)')).toBeLessThan(front.indexOf('$action = trim'));

    // ── JS side: manual SmartHelp refreshes token BEFORE POST ────────────────
    // Canonical token field name preserved (now carried in `token`).
    expect(js).toContain("params.set('_glpi_csrf_token', token)");
    // Token refreshed from EVERY response body.
    expect(js).toContain('panel.dataset.csrf = body.csrf_token');
    expect(js).toContain('refreshCsrfBeforePost');
    expect(js).toContain('return refreshCsrfToken(panel).then(function (refreshed) {');
    expect(js).toContain("error: 'csrf_preflight_failed'");
    expect(js).toContain("error_type: 'csrf_failed'");
    expect(js).toContain("post(panel, 'summarize_ticket', { ai_summary: '1' }");
    expect(js).toContain("post(panel, 'local_search', { technical_summary: summary }");
    // CSRF failure detector remains for non-SmartHelp helpers.
    expect(js).toContain('function isCsrfFailure(body)');
    // Retry exactly once via postOnce where the generic fallback path is still used.
    expect(js).toContain('function postOnce(panel, action, extra)');
    expect(js).toContain('return postOnce(panel, action, extra);');
    // No bypass: the retry path still posts the token (no skipping of validation).
    expect(js).not.toContain('skipCsrf');
  });

  it('smart help recovers the opaque GLPI middleware 403 via a GET token refresh', async () => {
    const js  = await read('integaglpi/js/ticket_ai_panel.js');
    const front = await read('integaglpi/front/smart.help.php');

    // ── PHP side: GET csrf_token=1 returns a fresh token (GLPI does not CSRF-gate GET).
    expect(front).toContain("(string) (\$_GET['csrf_token'] ?? '') === '1'");
    expect(front).toContain("=== 'GET'");
    // The GET refresh runs BEFORE the POST-only guard so it is reachable.
    expect(front.indexOf("\$_GET['csrf_token']")).toBeLessThan(front.indexOf("!== 'POST'"));
    // It is read-only: no mutation, just the helper-injected fresh token.
    expect(front).toContain("integaglpiSmartHelpJsonResponse(['ok' => true], 200)");

    // ── JS side: GET refresh helper + any-403 recovery for generic fallback.
    expect(js).toContain('function refreshCsrfToken(panel)');
    expect(js).toContain("csrf_token=1&_=");
    expect(js).toContain("method: 'GET'");
    // Opaque upstream 403 (invalid_json) is also treated as recoverable.
    expect(js).toContain("body.error === 'invalid_json'");
    // Manual SmartHelp uses GET refresh BEFORE the POST, not only after a 403.
    expect(js).toContain('refreshCsrfBeforePost');
    expect(js.indexOf('refreshCsrfToken(panel).then(function (refreshed)')).toBeLessThan(js.indexOf('postOnce(panel, action, extra).then(function (body)'));
    // Generic fallback still refreshes on 403 and retries once.
    expect(js).toContain('return refreshCsrfToken(panel).then(function () {');
    expect(js).toContain('return postOnce(panel, action, extra);');
  });

  it('external AI result is normalized into a human-review view model, never raw JSON or object strings', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const smart = await read('integaglpi/src/Service/SmartHelpService.php');
    const external = await read('integaglpi/src/Service/ExternalResearchService.php');
    const tpl = await read('integaglpi/templates/external_research.php');
    const globalJs = await read('integaglpi/js/integaglpi.js');

    expect(external).toContain('externalHelpViewModel');
    expect(external).toContain('diagnostico_provavel');
    expect(external).toContain('perguntas_ao_cliente');
    expect(external).toContain('passos_tecnicos');
    expect(external).toContain('riscos_cuidados');
    expect(external).toContain('fontes_links_sugeridas');
    expect(smart).toContain("'external_help_view_model' => $viewModel");

    expect(js).toContain('function normalizeExternalHelpViewModel(result)');
    expect(js).toContain('function renderExternalHelpCard(panel, result)');
    expect(js).toContain('maybeDecodeJson');
    expect(js).toContain('renderExternalSection');
    expect(js).toContain('var nested = maybeDecodeJson(existing.diagnostic_hypothesis || existing.diagnosticHypothesis || \'\')');
    expect(js).toContain('var nestedRecord = nested && typeof nested === \'object\' && !Array.isArray(nested) ? nested : {}');
    expect(js).toContain('function safeExternalPreviewViewModel(result)');
    expect(js).toContain('function renderExternalPreview(panel, preview)');
    expect(js).toContain("sanitized_text: safeScalar(result.cloud_safe_context || result.sanitized_text || result.sanitizedText || '', 2500)");
    expect(js).toContain('removed_kinds: safeListForStorage(result.removed_kinds || result.detected_kinds || result.detectedKinds || [], 12, 80)');
    expect(js).toContain('checklistEl.innerHTML = viewList(result.checklist || [])');
    expect(js).toContain('questionsEl.innerHTML = viewList(result.suggestedQuestions || result.suggested_questions || [])');
    expect(js).toContain('var localSuggestionTitle = viewText(localSuggestion.title');
    expect(js).toContain('var localSuggestionContent = viewText(');
    expect(js).toContain("return scalarText === '[object Object]' ? '' : scalarText;");
    expect(globalJs).toContain('function safeSmartHelpText(value)');
    expect(globalJs).toContain("return text === '[object Object]' ? '' : text;");
    expect(globalJs).toContain('const suggestionText = safeSmartHelpText(');
    expect(globalJs).not.toContain("String(r.localSuggestion).replace");
    expect(js).toContain('Copiar perguntas');
    expect(js).toContain('Copiar passos');
    expect(js).toContain('Copiar comandos');
    expect(js).toContain('Copiar tudo');
    expect(js).toContain('Gerar candidato KB manual');
    expect(js).toContain('Sem fontes externas verificáveis; use como sugestão técnica.');
    expect(js).toContain('Revisão humana obrigatória');
    expect(js).not.toContain('String(r.answer)');
    expect(js).not.toContain('textContent = r.answer');
    expect(js).not.toContain('${object}');
    expect(js).not.toContain('esc(localSuggestion.content ||');

    expect(tpl).toContain('$externalHelpViewModel');
    expect(tpl).toContain('Diagnóstico provável');
    expect(tpl).toContain('Perguntas ao cliente');
    expect(tpl).toContain('Passos técnicos');
    expect(tpl).toContain('Riscos e cuidados');
    expect(tpl).toContain('Gerar candidato KB manual');
  });

  it('local summary prompt is evidence-bound and a deterministic guard scrubs fabricated context', async () => {
    const deps = await read('integration-service/src/buildDependencies.ts');
    const ctrl = await read('integration-service/src/controllers/ai.controller.ts');

    // Prompt forbids inventing context and preserves exact technical terms.
    expect(deps).toContain('REGRAS DE FIDELIDADE');
    expect(deps).toContain('NÃO invente causa, sistema, produto');
    expect(deps).toContain('Preserve os termos técnicos exatos');
    expect(deps).toContain('diga explicitamente que faltam dados');

    // Deterministic anti-hallucination guard exists and is applied before returning.
    expect(ctrl).toContain('function scrubSummaryFabrications');
    expect(ctrl).toContain('SUMMARY_FABRICATION_GUARD');
    expect(ctrl).toContain('neutralizeSmartHelpPiiText(scrubSummaryFabrications(raw, context))');
    expect(ctrl).toContain('detalhes técnicos ainda não informados');
  });

  it('SmartHelp neutralizes company/name placeholders in PHP summary and cloud preview paths', async () => {
    const php = await read('integaglpi/src/Service/SmartHelpService.php');
    const ctrl = await read('integration-service/src/controllers/ai.controller.ts');
    const ext = await read('integration-service/src/domain/services/ExternalResearchService.ts');
    const neutralizer = await read('integration-service/src/domain/services/PiiNeutralizationService.ts');

    expect(php).toContain('function neutralizeSmartHelpPiiText');
    expect(php).toContain('$this->neutralizeSmartHelpPiiText($clean)');
    expect(php).toContain('representante|cliente|solicitante|contato');

    expect(ctrl).toContain("import { neutralizeSmartHelpPiiText }");
    expect(ctrl).toContain('neutralizeSmartHelpPiiText(scrubSummaryFabrications(raw, context))');
    expect(ext).toContain('neutralizeSmartHelpPiiText(pass2.sanitizedText)');
    expect(ext).toContain('pass3.detectedKinds');

    expect(neutralizer).toContain('representante');
    expect(neutralizer).toContain('cliente\\s+d[aeo]');
    expect(neutralizer).toContain('Foi relatado');
    expect(neutralizer).toContain('sync do AD');
  });

  it('external AI assist renders a source-optional suggestion (review required, no misleading success)', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const svc = await read('integration-service/src/domain/services/ExternalResearchService.ts');

    // Node: source-optional contract fields on the completed answer.
    expect(svc).toContain("sourceType: hasSources ? 'external_ai_with_sources' : 'external_ai_no_sources'");
    expect(svc).toContain("confidenceLabel: hasSources ? 'media' : 'baixa'");
    expect(svc).toContain('reviewRequired: true');

    // JS: suggestion framing, review reminder, no-sources note, not evidence.
    expect(js).toContain('Ajuda externa por IA — sugestão, revise antes de aplicar');
    expect(js).toContain('Sem fontes externas verificáveis; use como sugestão técnica.');
    expect(js).toContain('Nada é enviado ao cliente nem altera o chamado automaticamente.');
    // Cloud send still requires consent.
    expect(js).toContain("post(panel, 'smart_external', {");
    expect(js).toContain("consent: '1'");
  });

  it('SmartHelp workflow state is scoped by ticket, conversation, context hash and mode', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    const tpl = await read('integaglpi/templates/ticket_tab.php');

    expect(js).toContain("SMART_HELP_CACHE_PREFIX = 'integaglpiSmartHelpViewModel:v3'");
    expect(js).toContain('function contextHash(panel)');
    expect(js).toContain("panel.dataset.ticketId || '0'");
    expect(js).toContain("panel.dataset.conversationId || 'none'");
    expect(js).toContain("panel.dataset.contextUpdatedAt || 'unknown'");
    expect(js).toContain("mode || 'workflow'");
    expect(js).toContain('state.context_hash !== contextHash(panel)');
    expect(js).toContain('state.ticket_id && String(state.ticket_id)');
    expect(js).toContain('state.conversation_id && String(state.conversation_id)');
    expect(js).toContain('function clearDerivedContext(panel)');
    expect(tpl).toContain('data-context-updated-at=');
  });

  it('SmartHelp rehydrates sanitized view-models and blocks stale/raw rendering', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');

    expect(js).toContain('function safeSmartHelpViewModel(result)');
    expect(js).toContain('function safeExternalPreviewViewModel(result)');
    expect(js).toContain('function safeExternalResultViewModel(result, requestId)');
    expect(js).toContain('request_id: safeScalar(requestId || result.request_id || result.requestId');
    expect(js).toContain('function restoreSmartHelpPanel(panel)');
    expect(js).toContain('restoreSmartHelpPanel(p)');
    expect(js).toContain("loadFlow(panel, 'external_result')");
    expect(js).toContain("renderExternalHelpCard(panel, { external_help_view_model: externalState.view_model");
    expect(js).toContain("saveFlow(panel, { step: 'cloud_ready', view_model: preview }, 'external_preview')");
    expect(js).toContain("saveFlow(panel, { step: 'cloud_ready', request_id: requestId, view_model: safeExternalResultViewModel");
    expect(js).toContain('function nextRequestId(panel, mode)');
    expect(js).toContain('function isCurrentRequest(panel, requestId)');
    expect(js).toContain("if (!isCurrentRequest(panel, requestId)) { return; }");
    expect(js).toContain("cloudEl && !loadFlow(panel, 'external_result').view_model");
    expect(js).toContain("return scalarText === '[object Object]' ? '' : scalarText;");
    expect(js).not.toContain('innerHTML = JSON.stringify');
    expect(js).not.toContain('String(result)');
  });

  it('technical summarizer aligns to the same effective LOCAL provider/model as the Copilot', async () => {
    const deps = await read('integration-service/src/buildDependencies.ts');

    // Summarizer resolves the effective model from the copilot runtime config (DB ->
    // copilot_model -> COPILOT_DRAFT_MODEL -> AI_SUPERVISOR_MODEL), not the bare supervisor model.
    expect(deps).toContain('const technicalSummarizer');
    expect(deps).toContain('loadCopilotRuntimeConfig()');
    expect(deps).toContain('env.COPILOT_DRAFT_MODEL.trim()');
    // Uses the local Ollama base URL (no cloud) and generateText (free text).
    expect(deps).toContain('new OllamaClient(env.AI_SUPERVISOR_BASE_URL, model, timeoutMs).generateText(prompt)');
    // Prompt asks for clean prose without structural labels (no duplicate "Problema relatado:").
    expect(deps).toContain('sem rótulos, sem listas');
    expect(deps).not.toContain('Problema relatado: ...');
  });

  it('technical summary is clean prose, idempotent and PII-hardened (local-first, deterministic)', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    // Sanitizer removes e-mail/CPF/CNPJ/phone + company/ticket/asset/name/credential/url.
    expect(svc).toContain('function sanitizeContext');
    expect(svc).toContain('[email removido]');
    expect(svc).toContain('[empresa removida]');
    expect(svc).toContain('[chamado removido]');
    expect(svc).toContain('[patrimonio removido]');
    expect(svc).toContain('[nome removido]');
    expect(svc).toContain('[credencial removida]');
    expect(svc).toContain('[url removida]');
    // Idempotent prose: strips existing labels and de-duplicates sentences.
    expect(svc).toContain('function stripSummaryBoilerplate');
    // D11 extended the label list (multi-problem + structured-field labels are also stripped).
    expect(svc).toContain('Problema relatado|Problemas relatados|Contexto t[eé]cnico|Pr[oó]xima a[cç][aã]o sugerida');
    // buildTechnicalSummary uses the boilerplate strip (no double "Problema relatado:").
    expect(svc).toMatch(/buildTechnicalSummary[\s\S]*stripSummaryBoilerplate/);
    // AI summary output is also constrained to the summary-only contract before reaching the textarea.
    expect(svc).toContain('enforceSummaryContract($aiSummary, $sanitizedContext)');
    // Still returns technicalSummary / technical_summary + honest summary_source.
    expect(svc).toContain("'technical_summary'");
    expect(svc).toContain("'summary_source'");
    // The next-action hint is non-mutating (never auto-resolves / auto-sends).
    expect(svc).not.toMatch(/->update\(|sendOutbound|sendWhatsApp/i);
    expect(svc).not.toMatch(/['"]auto_publish['"]\s*=>\s*true/i);
  });

  it('manual click triggers LOCAL-AI summary; page load does not POST SmartHelp', async () => {
    const js  = await read('integaglpi/js/ticket_ai_panel.js');
    const front = await read('integaglpi/front/smart.help.php');
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    // ── JS: manual summary click sends ai_summary=1; page load does not call SmartHelp.
    expect(js).toContain("post(panel, 'summarize_ticket', { ai_summary: '1' }");
    expect(js).toContain('handleSummarize(panel)');
    expect(js).not.toContain('runSmartHelp(p)');
    // Source is surfaced to the technician.
    expect(js).toContain('r.summarySource || r.summary_source');
    expect(js).toContain("'resumo IA local'");

    // ── PHP endpoint: summarize_ticket is summary-only and local_search uses current summary.
    expect(front).toContain("$action === 'summarize_ticket'");
    expect(front).toContain('summarizeTicket($ticketId, $summary, $wantAiSummary)');
    expect(front).toContain('localFirstAssist($ticketId, $searchSummary, false, true)');
    expect(front).toContain("if ($action === 'local_search')");
    expect(front).toContain("technical_summary");

    // ── PHP service: summary-only does not run KB/local search; local search may call local AI.
    expect(svc).toContain('function summarizeTicket');
    expect(svc).toContain('No KB search, no SmartHelp enrichment, no cloud, no ticket mutation.');
    expect(svc).toContain('bool $wantAiSummary = true');
    expect(svc).toContain('if ($wantAiSummary)');
    expect(svc).toContain('bool $wantLocalAiSuggestion = false');
    expect(svc).toContain('if (!$localResolved && $wantLocalAiSuggestion && $localSuggestion === null)');
    expect(svc).toContain('new KbCopilotBridgeService($this->config)');
    expect(svc).toContain('buildLocalRagResult');
    expect(svc).toContain("'source' => \$ragResult !== null ? 'node_kb_rag' : 'php_native_glpi_kb'");
    expect(js).toContain('renderLocalPlaybook(panel, result)');
    expect(js).toContain('Playbook KB local');
    expect(js).toContain('js-smart-help-add-private-note');
    expect(js).toContain('Adicionar este playbook como nota PRIVADA');
    expect(js).toContain("'kb.add_note.php'");
    expect(js).toContain('refreshCsrfToken(panel).then(function ()');
    expect(svc).toContain('LOCAL_CONFIDENCE_THRESHOLD');
    expect(svc).toContain('PATH_TECHNICAL_SUMMARY');
    expect(svc).toContain('/internal/glpi/ai/technical-summary');
    expect(svc).toContain('function technicalSummaryAi');
    // PII sanitized BEFORE sending to the model.
    expect(svc).toContain('$sanitizedContext = $this->sanitizeContext($summary)');
    // Source reported; fallback to deterministic on failure.
    expect(svc).toContain("\$summarySource = 'local_ai'");
    expect(svc).toContain("\$summarySource = 'fallback'");
    expect(svc).toContain("'summary_source'");
  });

  it('local-AI summary path is local-provider only and never cloud/auto-send (Node)', async () => {
    const ctrl = await read('integration-service/src/controllers/ai.controller.ts');
    const ollama = await read('integration-service/src/ai/OllamaClient.ts');
    const deps = await read('integration-service/src/buildDependencies.ts');

    // Controller: typed envelope, 200 on failure so PHP can fall back.
    expect(ctrl).toContain('createTechnicalSummaryController');
    expect(ctrl).toContain("summary_source: 'local_ai'");
    expect(ctrl).toContain("'local_ai_timeout'");
    expect(ctrl).toContain("'provider_unavailable'");
    expect(ctrl).toContain('read_only: true');
    // No cloud / whatsapp / ticket mutation WITHIN the technical-summary controller.
    const tsStart = ctrl.indexOf('export function createTechnicalSummaryController');
    const tsEnd = ctrl.indexOf('export function createSmartHelpController');
    const tsBody = ctrl.slice(tsStart, tsEnd);
    expect(tsStart).toBeGreaterThanOrEqual(0);
    expect(tsBody).not.toMatch(/cloud|whatsapp|sendOutbound|->update/i);

    // OllamaClient.generateText is plain text (no forced JSON) and LOCAL.
    expect(ollama).toContain('generateText');

    // Dependency wiring uses the LOCAL Ollama base URL, short timeout, and a
    // prompt that forbids personal data. No cloud provider here.
    expect(deps).toContain('technicalSummarizer');
    expect(deps).toContain('AI_TECHNICAL_SUMMARY_TIMEOUT_MS');
    expect(deps).toContain('AI_SUPERVISOR_BASE_URL');
    expect(deps).toContain('NÃO inclua dados pessoais');
  });

  it('template↔JS↔PHP contract: class, selector, action and attributes match', async () => {
    const tab = await read('integaglpi/templates/ticket_tab.php');
    const js  = await read('integaglpi/js/ticket_ai_panel.js');
    const front = await read('integaglpi/front/smart.help.php');

    // ── Template side ────────────────────────────────────────────────────────
    // Panel container class used by JS delegation.
    expect(tab).toContain('integaglpi-smart-help');
    // Guided button classes used by JS selectors.
    expect(tab).toContain('js-smart-help-summarize');
    expect(tab).toContain('js-smart-help-local-search');
    expect(tab).toContain('js-smart-help-external');
    // action URL attribute points to the dedicated SmartHelp endpoint.
    expect(tab).toContain('data-action-url=');
    expect(tab).toContain("'/front/smart.help.php'");
    // CSRF attribute set on the panel.
    expect(tab).toContain('data-csrf=');
    // ticket-id attribute set on the panel.
    expect(tab).toContain('data-ticket-id=');
    // Summary starts enabled; local/cloud are gated.
    const summarizeBtn = tab.match(/class="[^"]*js-smart-help-summarize[^"]*"[^>]*>/);
    const localBtn = tab.match(/class="[^"]*js-smart-help-local-search[^"]*"[^>]*>/);
    const cloudBtn = tab.match(/class="[^"]*js-smart-help-external[^"]*"[^>]*>/);
    expect(summarizeBtn).not.toBeNull();
    expect(summarizeBtn![0]).not.toContain('disabled');
    expect(localBtn).not.toBeNull();
    expect(localBtn![0]).toContain('disabled');
    expect(cloudBtn).not.toBeNull();
    expect(cloudBtn![0]).toContain('disabled');
    // JS is injected inline (not behind a broken <script src> that may 404).
    expect(tab).toContain('file_get_contents');
    expect(tab).toContain('ticket_ai_panel.js');

    // ── JS side ──────────────────────────────────────────────────────────────
    // Delegation selector matches panel class.
    expect(js).toContain("t.closest('.integaglpi-smart-help')");
    // Button selectors match template classes.
    expect(js).toContain("t.closest('.js-smart-help-summarize')");
    expect(js).toContain("t.closest('.js-smart-help-local-search')");
    expect(js).toContain("t.closest('.js-smart-help-external')");
    // Request sends correct action name.
    expect(js).toContain("params.set('smart_action', action)");
    expect(js).toContain("post(panel, 'summarize_ticket'");
    expect(js).toContain("post(panel, 'local_search'");
    // Request sends ticket_id and CSRF.
    expect(js).toContain("params.set('ticket_id'");
    expect(js).toContain("params.set('_glpi_csrf_token'");

    // ── PHP side ─────────────────────────────────────────────────────────────
    // action name accepted by endpoint.
    expect(front).toContain("'smart_help'");
    expect(front).toContain("'summarize_ticket'");
    expect(front).toContain("'local_search'");
    // Reads smart_action from POST.
    expect(front).toContain("'smart_action'");
    // Reads ticket_id from POST.
    expect(front).toContain("'ticket_id'");
    // SmartHelp must not point back at the shared ticket action endpoint.
    const smartPanelStart = tab.indexOf('integaglpi-smart-help');
    const smartPanelEnd = tab.indexOf('js-smart-help-technical-summary', smartPanelStart);
    expect(tab.slice(smartPanelStart, smartPanelEnd)).not.toContain('getTicketActionUrl()');
  });

  it('ticket_tab.php copilot error display uses error_type before HTTP status fallback', async () => {
    const tab = await read('integaglpi/templates/ticket_tab.php');

    // Typed backend failures get specific messages before the generic HTTP fallback.
    expect(tab).toContain('function copilotTypedFallback');
    expect(tab).toContain("errorType === 'node_timeout'");
    expect(tab).toContain("errorType === 'diagnostics_timeout'");
    expect(tab).toContain("errorType === 'configuration_pending'");
    expect(tab).toContain("errorType === 'provider_unavailable'");
    expect(tab).toContain("errorType === 'type_error'");
    expect(tab).toContain('result.status === 500');
    expect(tab).toContain('Consulte o error_type retornado');
    // HTTP 503/504 gets a timeout message.
    expect(tab).toContain('result.status === 504');
    expect(tab).toContain('não respondeu a tempo');
    // HTTP 403 gets a permission/session message.
    expect(tab).toContain('result.status === 403');
    // Generic fallback still present for unknown statuses.
    expect(tab).toContain('Não foi possível gerar o rascunho');
    // The detection of the generic PHP message is present.
    expect(tab).toContain('Não foi possível usar o Copiloto agora.');
    expect(tab).not.toContain('Copiloto indisponível (erro interno — HTTP 500)');
  });

  it('copilot.draft.php returns parseable typed JSON for PHP and provider failures', async () => {
    const front = await read('integaglpi/front/copilot.draft.php');

    expect(front).toContain('function integaglpiCopilotErrorType');
    expect(front).toContain("'ok'");
    expect(front).toContain("'display_message'");
    expect(front).toContain("'error_type'");
    expect(front).toContain("'type_error'");
    expect(front).toContain("'provider_unavailable'");
    expect(front).toContain("'node_timeout'");
    expect(front).toContain("'diagnostics_timeout'");
    expect(front).toContain("'missing_context'");
    expect(front).toContain("'permission_denied'");
    expect(front).toContain("'csrf_failed'");
    expect(front).toContain("'configuration_pending'");
    expect(front).toContain('integaglpiCopilotErrorType($exception->getMessage(), $exception)');
  });

  it('copilot synchronous PHP-to-Node timeout is long enough and typed on failure', async () => {
    const client = await read('integaglpi/src/Service/CopilotDraftClient.php');
    const front = await read('integaglpi/front/copilot.draft.php');

    expect(client).toContain('private const COPILOT_DRAFT_TIMEOUT_MS = 25000;');
    expect(client).toContain('private const COPILOT_DRAFT_CONNECT_TIMEOUT_MS = 5000;');
    expect(client).toContain("throw new RuntimeException('COPILOT_TIMEOUT')");
    expect(front).toContain("return 'node_timeout';");
    expect(front).toContain("return 'diagnostics_timeout';");
    expect(front).not.toContain('Copiloto indisponível (erro interno — HTTP 500)');
  });

  it('smart.help.php SmartHelp call is wrapped in try/catch returning JSON', async () => {
    const front = await read('integaglpi/front/smart.help.php');

    // try/catch around the SmartHelp guided actions.
    expect(front).toContain('try {');
    expect(front).toContain('summarizeTicket($ticketId, $summary, $wantAiSummary)');
    expect(front).toContain('localFirstAssist($ticketId, $searchSummary, false, true)');
    expect(front).toContain('catch (Throwable $exception)');
    expect(front).toContain("return 'internal_error';");
    // Error logged safely.
    expect(front).toContain('[integaglpi][smart_help][error]');
    // Returns JSON (not raw exception text) on failure.
    expect(front).toContain("'error' => 'smart_help_error'");
  });

  it('kb.search.php is bearer-gated, POST-only, read-only and visibility-filtered', async () => {
    const front = await read('integaglpi/front/kb.search.php');
    const svc = await read('integaglpi/src/Service/KbSearchService.php');

    // hash_equals bearer check against the integration auth key.
    expect(front).toContain('hash_equals');
    expect(front).toContain('getIntegrationAuthKey');
    expect(front).toContain("preg_match('/^Bearer");
    // POST-only guard.
    expect(front).toContain('REQUEST_METHOD');
    expect(front).toContain("!== 'POST'");
    // No mutation of GLPI data.
    expect(front).not.toMatch(/UPDATE\s+glpi_|INSERT\s+INTO\s+glpi_|DELETE\s+FROM/i);

    // Service uses the existing visibility-filtered native search (no raw SQL mutation).
    expect(svc).toContain('searchVisibleArticles');
    expect(svc).not.toMatch(/->add\(|->update\(|->delete\(/i);
  });

  it('buildTechnicalSummary extracts client context BEFORE sanitizing (marker-preservation fix)', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    // $this->extractClientOnlyContext must be called before $this->sanitizeContext in
    // buildTechnicalSummary so that "Cliente:"/"Técnico:" markers survive the PII neutralizer.
    const fnStart = svc.indexOf('private function buildTechnicalSummary');
    const fnEnd   = svc.indexOf('private function extractClientOnlyContext');
    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = svc.slice(fnStart, fnEnd);
    // Search for actual code calls (not comment mentions)
    const extractCodePos  = fnBody.indexOf('$this->extractClientOnlyContext');
    const sanitizeCodePos = fnBody.indexOf('$this->sanitizeContext');
    expect(extractCodePos).toBeGreaterThanOrEqual(0);
    // $this->sanitizeContext is called AFTER $this->extractClientOnlyContext (fixed order)
    expect(sanitizeCodePos).toBeGreaterThan(extractCodePos);

    // "Mensagens recentes" header is classified as a system line so it is never
    // included in the client-only context even when there are no "Cliente:" lines.
    expect(svc).toMatch(/function isSystemSmartHelpLine[\s\S]{0,500}mensagens recentes/i);
  });

  it('PostgresKbCandidateSearchRepository excludes external/AI-generated articles from local search', async () => {
    const repo = await read('integration-service/src/repositories/postgres/PostgresKbCandidateSearchRepository.ts');

    // "Ajuda externa por IA" articles created via cloud research must never
    // appear in the local KB search results.
    expect(repo).toContain("NOT ILIKE '%Ajuda externa por IA%'");
    expect(repo).toContain("NOT IN ('external_research', 'cloud_preview', 'external_ai')");

    // Both the primary FTS query and the ILIKE fallback carry the exclusion.
    const firstOccurrence  = repo.indexOf("NOT ILIKE '%Ajuda externa por IA%'");
    const secondOccurrence = repo.lastIndexOf("NOT ILIKE '%Ajuda externa por IA%'");
    expect(firstOccurrence).toBeGreaterThanOrEqual(0);
    expect(secondOccurrence).toBeGreaterThan(firstOccurrence);
  });

  it('KbRankingService blocks Windows activation KB for isolated-product queries', async () => {
    const svc = await read('integration-service/src/domain/services/KbRankingService.ts');

    // hasDomainConflict contains the isolated-product exclusion rule
    expect(svc).toContain('ISOLATED_PRODUCTS');
    expect(svc).toContain("'micromed'");
    expect(svc).toContain('queryHasIsolatedProduct');
    expect(svc).toContain('hitIsWindowsActivation');
    // The rule appears inside hasDomainConflict (not a separate gate)
    const fnStart = svc.indexOf('private hasDomainConflict');
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fnBody = svc.slice(fnStart, fnStart + 2500);
    expect(fnBody).toContain('ISOLATED_PRODUCTS');
    expect(fnBody).toContain('queryHasIsolatedProduct');
  });
});
