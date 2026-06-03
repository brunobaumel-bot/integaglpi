import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string): Promise<string> => readFile(resolve(repoRoot, p), 'utf8');

describe('PHP Smart Help consumer + native KB search (static safety)', () => {
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

    // The dedicated endpoint wires smart_help to the local-first method (not the raw Node call).
    expect(front).toContain('localFirstAssist($ticketId, $summary, $wantAiSummary)');
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
    expect(tab).toContain('js-smart-help-run');
    expect(tab).toContain('js-smart-help-external');
    expect(tab).toContain('js-smart-help-suggest-kb');
    expect(tab).toContain('js-smart-help-technical-summary');
    expect(tab).toContain('Resumo técnico sem dados pessoais');
    // (js-smart-help-feedback buttons are rendered per-article by the JS.)
    // Read-only disclaimer + consent text.
    expect(tab).toContain('nada é enviado ao cliente nem altera o chamado');
    expect(tab).toContain('contexto é sanitizado antes de sair');
    // Assets inlined only when the panel is visible.
    expect(tab).toContain('ticket_ai_panel.js');
    expect(tab).toContain('ticket_ai_panel.css');
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
    expect(front).toContain("\$allowedActions = ['smart_help', 'kb_feedback', 'suggest_kb', 'prepare_external_context', 'smart_external']");
    expect(front).toContain('localFirstAssist($ticketId, $summary, $wantAiSummary)');
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

    expect(action).toContain("if ($action === 'analyze_conversation')");
    expect(action).toContain('Plugin::isAiSupervisorEnabled()');
    expect(action).toContain('requestAiQualityAnalysis');
    expect(action).toContain('NativeKnowledgeBaseService');
    expect(action).toContain('[integaglpi][ai_action][analyze_conversation][kb_context_error]');
    expect(action).toContain("'error_type' => $status >= 500 ? 'provider_unavailable' : 'internal_error'");
    expect(action).toContain('Análise IA registrada para revisão humana.');

    expect(tab).toContain('js-integaglpi-ai-quality-analyze-form');
    expect(tab).toContain('Plugin::getTicketActionUrl()');
    expect(tab).toContain('name="whatsapp_action" value="analyze_conversation"');
    expect(tab).toContain('JSON.parse(text)');
    expect(tab).toContain('result.body.error_type');
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
    expect(front).toContain("in_array(\$action, ['prepare_external_context', 'smart_external'], true) && !Plugin::canUpdate()");
    expect(front).toContain("'error_type' => 'permission_denied'");
    expect(front).toContain('SmartHelpService::canViewPanel()');
    // Human consent still required even after permission check.
    expect(front).toContain("(\$_POST['consent'] ?? '') === '1'");
    // Local-only actions (smart_help, kb_feedback, suggest_kb) do NOT require canUpdate().
    expect(front).toContain("if ($action === 'smart_help')");
    expect(front).toContain("if ($action === 'kb_feedback')");
    expect(front).toContain("if ($action === 'suggest_kb')");
  });

  it('cloud external research is a two-step sanitized-preview flow (prepare → confirm send)', async () => {
    const front = await read('integaglpi/front/smart.help.php');
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');
    const node = await read('integration-service/src/controllers/ai.controller.ts');
    const js = await read('integaglpi/js/ticket_ai_panel.js');

    // ── PHP: prepare step exists, builds context server-side, no consent (no send) ──
    expect(front).toContain("if (\$action === 'prepare_external_context')");
    expect(front).toContain('prepareExternalContext($ticketId, $summary)');
    // Send step still requires explicit consent.
    expect(front).toContain("\$consent = (\$_POST['consent'] ?? '') === '1'");
    expect(front).toContain('externalResearch($ticketId, $summary, $consent)');

    // ── PHP service: preview path is the dedicated preview endpoint ──
    expect(svc).toContain("/internal/glpi/ai/external-research/preview");
    expect(svc).toContain('function prepareExternalContext');

    // ── Node controller: preview returns sanitized text + safe flag, never raw, no cloud ──
    expect(node).toContain('createExternalResearchPreviewController');
    expect(node).toContain('sanitized_text: preview.sanitizedText');
    expect(node).toContain('detected_kinds: preview.detectedKinds');
    expect(node).toContain('safe_for_cloud: !preview.blocked');
    expect(node).toContain('remote_execution: false');
    // The preview controller must NOT call researchDynamic (no cloud send in step 1).
    const prevStart = node.indexOf('createExternalResearchPreviewController');
    const prevEnd = node.indexOf('createCoachingChecklistController');
    const prevBody = node.slice(prevStart, prevEnd);
    expect(prevBody).not.toContain('researchDynamic');

    // ── JS: step 1 calls prepare; step 2 (confirmed) calls smart_external with consent ──
    expect(js).toContain("post(panel, 'prepare_external_context'");
    expect(js).toContain('function handleExternalSend');
    expect(js).toContain("post(panel, 'smart_external', { consent: '1' }");
    expect(js).toContain('js-smart-help-external-send');
    // Clear blocked / ready messaging — never a silent failure.
    expect(js).toContain('Contexto sanitizado pronto para envio');
    expect(js).toContain('Bloqueado por PII');
    expect(js).toContain('Tipos detectados/removidos:');
  });

  it("the smart help JS never auto-runs SmartHelp or cloud (manual click only)", async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    // Page load only marks the panel ready. It must not POST smart_help automatically.
    expect(js).not.toContain('runSmartHelp(p)');
    expect(js).toContain("p.dataset.smartHelpJsReady = '1'");
    expect(js).toContain("post(panel, 'smart_help', extra, { refreshCsrfBeforePost: !!userInitiated })");
    expect(js).toContain('document.readyState !== \'loading\'');
    expect(js).toContain('event.preventDefault();');
    expect(js).toContain("runSmartHelp(panel, true);  // userInitiated = true");
    expect(js).toContain('Analisando localmente...');
    expect(js).toContain('runBtn.disabled = true');
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
    expect(js).toContain("post(panel, 'smart_external', { consent: '1' }");
    // DOMContentLoaded auto-runs neither smart_help nor smart_external.
    const onLoad = js.slice(js.indexOf('DOMContentLoaded'));
    expect(onLoad).not.toContain("post(panel, 'smart_help'");
    expect(onLoad).not.toContain('runSmartHelp(');
    expect(onLoad).not.toContain('smart_external');
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

  it('smart help JS run button is only disabled on user-initiated click', async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');

    // runSmartHelp accepts userInitiated parameter.
    expect(js).toContain('runSmartHelp(panel, userInitiated)');
    // Button is disabled only when userInitiated is true.
    expect(js).toContain('if (runBtn && userInitiated)');
    // Button is restored only when userInitiated is true.
    expect(js).toMatch(/finally[^}]*userInitiated[^}]*runBtn\.disabled\s*=\s*false/s);
    // There is no page-load auto-run anymore.
    expect(js).not.toContain('runSmartHelp(p)');
    // User click calls runSmartHelp with userInitiated = true.
    expect(js).toContain('runSmartHelp(panel, true);  // userInitiated = true');
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
    expect(front).toContain("in_array(\$action, ['prepare_external_context', 'smart_external'], true) && !Plugin::canUpdate()");

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
    expect(js).toContain("post(panel, 'smart_help', extra, { refreshCsrfBeforePost: !!userInitiated })");
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

  it('technical summary is structured and PII-sanitized (local-first, deterministic)', async () => {
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    // Dedicated sanitizer removes PII (email/CPF/CNPJ/phone) before use as context.
    expect(svc).toContain('function sanitizeContext');
    expect(svc).toContain('[dado pessoal removido]');
    // Structured summary fields for the technician.
    expect(svc).toContain('Problema relatado:');
    expect(svc).toContain('Contexto técnico:');
    expect(svc).toContain('Próxima ação sugerida:');
    // Still returns technicalSummary / technical_summary in the result payload.
    expect(svc).toContain("'technicalSummary'");
    expect(svc).toContain("'technical_summary'");
    // The next-action hint is non-mutating (never auto-resolves / auto-sends).
    expect(svc).not.toMatch(/->update\(|sendOutbound|sendWhatsApp|auto_publish/i);
  });

  it('manual click triggers LOCAL-AI summary; page load does not POST SmartHelp', async () => {
    const js  = await read('integaglpi/js/ticket_ai_panel.js');
    const front = await read('integaglpi/front/smart.help.php');
    const svc = await read('integaglpi/src/Service/SmartHelpService.php');

    // ── JS: manual click sends ai_summary=1; page load does not call SmartHelp.
    expect(js).toContain("var extra = userInitiated ? { ai_summary: '1' } : undefined;");
    expect(js).toContain("post(panel, 'smart_help', extra, { refreshCsrfBeforePost: !!userInitiated })");
    expect(js).not.toContain('runSmartHelp(p)');
    // Source is surfaced to the technician.
    expect(js).toContain('r.summarySource || r.summary_source');
    expect(js).toContain("'resumo IA local'");

    // ── PHP endpoint: reads ai_summary and forwards it ───────────────────────
    expect(front).toContain("(\$_POST['ai_summary'] ?? '') === '1'");
    expect(front).toContain('localFirstAssist($ticketId, $summary, $wantAiSummary)');

    // ── PHP service: AI path only when $wantAiSummary, sanitized, fallback ────
    expect(svc).toContain('bool $wantAiSummary = false');
    expect(svc).toContain('if ($wantAiSummary)');
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
    // Run button class used by JS selector.
    expect(tab).toContain('js-smart-help-run');
    // action URL attribute points to the dedicated SmartHelp endpoint.
    expect(tab).toContain('data-action-url=');
    expect(tab).toContain("'/front/smart.help.php'");
    // CSRF attribute set on the panel.
    expect(tab).toContain('data-csrf=');
    // ticket-id attribute set on the panel.
    expect(tab).toContain('data-ticket-id=');
    // Button is NOT born disabled (no disabled attr on js-smart-help-run in template).
    const btnMatch = tab.match(/class="[^"]*js-smart-help-run[^"]*"[^>]*>/);
    expect(btnMatch).not.toBeNull();
    expect(btnMatch![0]).not.toContain('disabled');
    // JS is injected inline (not behind a broken <script src> that may 404).
    expect(tab).toContain('file_get_contents');
    expect(tab).toContain('ticket_ai_panel.js');

    // ── JS side ──────────────────────────────────────────────────────────────
    // Delegation selector matches panel class.
    expect(js).toContain("t.closest('.integaglpi-smart-help')");
    // Button selector matches template class.
    expect(js).toContain("t.closest('.js-smart-help-run')");
    // Request sends correct action name.
    expect(js).toContain("params.set('smart_action', action)");
    expect(js).toContain("post(panel, 'smart_help', extra, { refreshCsrfBeforePost: !!userInitiated })");
    // Request sends ticket_id and CSRF.
    expect(js).toContain("params.set('ticket_id'");
    expect(js).toContain("params.set('_glpi_csrf_token'");

    // ── PHP side ─────────────────────────────────────────────────────────────
    // action name accepted by endpoint.
    expect(front).toContain("'smart_help'");
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

    // try/catch around localFirstAssist.
    expect(front).toContain('try {');
    expect(front).toContain('localFirstAssist($ticketId, $summary, $wantAiSummary)');
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
});
