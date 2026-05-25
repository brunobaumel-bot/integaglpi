import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), 'utf8');
}

describe('PHP internal Copilot static safety', () => {
  it('keeps the Copilot endpoint permissioned, CSRF protected and away from WhatsApp sending', async () => {
    const front = await readProjectFile('integaglpi/front/copilot.draft.php');
    const client = await readProjectFile('integaglpi/src/Service/CopilotDraftClient.php');
    const ticketTab = await readProjectFile('integaglpi/templates/ticket_tab.php');
    const contextService = await readProjectFile('integaglpi/src/Service/TicketContextService.php');

    expect(front).toContain('Session::checkLoginUser();');
    expect(front).toContain('Plugin::canUpdate()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(front).toContain("($_GET['csrf_token'] ?? '') === '1'");
    expect(front).toContain("$payload['csrf_token'] = Plugin::getCsrfToken()");
    expect(front).toContain('buildCopilotContext');
    expect(client).toContain('/internal/glpi/copilot/draft');
    expect(ticketTab).toContain('Sugerir resposta');
    expect(ticketTab).toContain('refreshCsrfToken');
    expect(ticketTab).toContain('updateCsrfToken');
    expect(ticketTab).toContain('Rascunho gerado por IA. Revise antes de enviar. Nenhuma mensagem é enviada automaticamente.');
    expect(ticketTab).toContain('Usar rascunho');
    expect(ticketTab).toContain('Copiar rascunho');
    expect(ticketTab).toContain('setTimeout(function () { button.disabled = false; }, 2500)');
    expect(contextService).toContain('NativeKnowledgeBaseService');
    expect(contextService).toContain('glpi_plugin_integaglpi_kb_candidates');
    expect(contextService).toContain('glpi_plugin_integaglpi_hist_insights');

    const combined = `${front}\n${client}\n${ticketTab}\n${contextService}`;
    expect(combined).not.toMatch(/MetaClient|sendOutbound|sendTemplate|ticket\.whatsapp\.reply\.php.*copilot|KnowbaseItem::add|Publicar automaticamente/i);
  });
});
