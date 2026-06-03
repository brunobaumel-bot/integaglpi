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
    const action = await read('integaglpi/front/ticket.whatsapp.action.php');

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

    // The ticket action wires smart_help to the local-first method (not the raw Node call).
    expect(action).toContain('localFirstAssist($ticketId, $summary)');
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

  it('the ticket-action AI branch is read-only and runs before the mutation map', async () => {
    const action = await read('integaglpi/front/ticket.whatsapp.action.php');

    // AI actions handled as an early branch.
    expect(action).toContain("\$aiAssistActions = ['smart_help', 'kb_feedback', 'smart_external', 'suggest_kb']");
    expect(action).toContain('SmartHelpService::canViewPanel()');
    // CSRF is validated before any action handling.
    expect(action.indexOf('Plugin::isCsrfValid($_POST)')).toBeLessThan(action.indexOf('$aiAssistActions'));
    // The local AI branch (smart_help/kb_feedback/suggest_kb) runs BEFORE Plugin::requireUpdate().
    expect(action.indexOf('$aiAssistActions')).toBeLessThan(action.indexOf('Plugin::requireUpdate();'));
    // Plugin::requireUpdate() still guards the ticket-mutation map.
    expect(action.indexOf('Plugin::requireUpdate();')).toBeLessThan(action.indexOf('$actionRightMap = ['));
    // Cloud consent is enforced; context built server-side.
    expect(action).toContain("(\$_POST['consent'] ?? '') === '1'");
    // The AI branch never mutates the ticket / sends WhatsApp.
    const aiBranch = action.slice(action.indexOf('$aiAssistActions'), action.indexOf('$actionRightMap = ['));
    expect(aiBranch).not.toMatch(/->update\(|->add\(|ITILFollowup|TicketTask|sendOutbound|sendWhatsApp/i);
  });

  it('smart_external cloud action requires Plugin::canUpdate() on top of canViewPanel()', async () => {
    const action = await read('integaglpi/front/ticket.whatsapp.action.php');

    // smart_external gate: canUpdate() checked before externalResearch is called.
    expect(action).toContain("if (\$action === 'smart_external' && !\\GlpiPlugin\\Integaglpi\\Plugin::canUpdate())");
    expect(action).toContain("'error_type' => 'permission_denied'");
    // The UPDATE gate for smart_external is inside the AI assist block (before requireUpdate()).
    const aiBlock = action.slice(action.indexOf('$aiAssistActions'), action.indexOf('Plugin::requireUpdate();'));
    expect(aiBlock).toContain('canUpdate()');
    // Human consent still required even after permission check.
    expect(aiBlock).toContain("(\$_POST['consent'] ?? '') === '1'");
    // Local-only actions (smart_help, kb_feedback, suggest_kb) do NOT require canUpdate().
    // Verified by: canUpdate() check is conditional only on smart_external, not on the base gate.
    expect(action).toContain('Base gate: all AI assist actions require at least READ');
    expect(action).toContain('Cloud/external gate: smart_external additionally requires UPDATE');
    // Obsolete comment removed: page no longer claims "already requires UPDATE" for ALL AI actions.
    expect(action).not.toContain('page already requires plugin UPDATE');
  });

  it("the smart help JS never auto-invokes cloud (cloud needs the external button + confirm)", async () => {
    const js = await read('integaglpi/js/ticket_ai_panel.js');
    // Proactive auto-load calls smart_help (local), NOT smart_external.
    expect(js).toContain('runSmartHelp(p)');
    expect(js).toContain("post(panel, 'smart_help')");
    expect(js).toContain('document.readyState !== \'loading\'');
    expect(js).toContain('event.preventDefault(); runSmartHelp(panel); return;');
    expect(js).toContain('Analisando localmente...');
    expect(js).toContain('runBtn.disabled = true');
    expect(js).toContain('Falha HTTP ');
    expect(js).toContain('Revise permissões, schema 044 e configuração local.');
    expect(js).toContain('PII Guard');
    expect(js).toContain('glpi_knowbaseitem_id');
    expect(js).toContain('Confiança operacional');
    // External (cloud) only via the explicit button + confirm dialog.
    expect(js).toContain('window.confirm');
    expect(js).toContain("post(panel, 'smart_external', { consent: '1' }");
    // DOMContentLoaded auto-runs smart_help, not smart_external.
    const onLoad = js.slice(js.indexOf('DOMContentLoaded'));
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

  it('ticket_tab.php copilot error display uses HTTP status to replace generic fallback', async () => {
    const tab = await read('integaglpi/templates/ticket_tab.php');

    // HTTP 500 gets a specific "serviço indisponível" message.
    expect(tab).toContain('result.status === 500');
    expect(tab).toContain('HTTP 500');
    // HTTP 503/504 gets a timeout message.
    expect(tab).toContain('result.status === 504');
    expect(tab).toContain('não respondeu a tempo');
    // HTTP 403 gets a permission/session message.
    expect(tab).toContain('result.status === 403');
    // Generic fallback still present for unknown statuses.
    expect(tab).toContain('Não foi possível gerar o rascunho');
    // The detection of the generic PHP message is present.
    expect(tab).toContain('Não foi possível usar o Copiloto agora.');
  });

  it('ticket.whatsapp.action.php smart_help call is wrapped in try/catch returning JSON', async () => {
    const action = await read('integaglpi/front/ticket.whatsapp.action.php');

    // try/catch around localFirstAssist.
    expect(action).toContain('try {');
    expect(action).toContain('localFirstAssist($ticketId, $summary)');
    expect(action).toContain('catch (\\Throwable $e)');
    expect(action).toContain("'error_type' => 'internal_error'");
    // Error logged safely.
    expect(action).toContain('[integaglpi][smart_help][unexpected]');
    // Returns JSON (not raw exception text) on failure.
    expect(action).toContain("'smart_help_error'");
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
