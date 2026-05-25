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
    expect(front).toContain('integaglpiCopilotUserMessage');
    expect(front).toContain('O Copiloto demorou mais que o esperado');
    expect(front).toContain('Serviço de IA indisponível no momento');
    expect(front).toContain('A IA respondeu em formato inválido');
    expect(front).toContain('buildCopilotContext');
    expect(client).toContain('/internal/glpi/copilot/draft');
    expect(client).toContain('COPILOT_DRAFT_TIMEOUT_MS = 90000');
    expect(client).toContain('CURLOPT_TIMEOUT_MS');
    expect(client).toContain('payload_size');
    expect(client).not.toContain('CURLOPT_TIMEOUT        => 35');
    expect(ticketTab).toContain('Sugerir resposta');
    expect(ticketTab).toContain('refreshCsrfToken');
    expect(ticketTab).toContain('updateCsrfToken');
    expect(ticketTab).toContain('Rascunho gerado por IA. Revise antes de enviar. Nenhuma mensagem é enviada automaticamente.');
    expect(ticketTab).toContain('Usar rascunho');
    expect(ticketTab).toContain('Copiar rascunho');
    expect(ticketTab).toContain('Pesquisa externa controlada');
    expect(ticketTab).toContain('getExternalResearchUrl');
    expect(ticketTab).toContain('canExternalResearchRead');
    expect(ticketTab).toContain('setTimeout(function () { button.disabled = false; }, 2500)');
    expect(contextService).toContain('NativeKnowledgeBaseService');
    expect(contextService).toContain('glpi_plugin_integaglpi_kb_candidates');
    expect(contextService).toContain('glpi_plugin_integaglpi_hist_insights');
    expect(contextService).toContain('COPILOT_MAX_MESSAGES = 8');
    expect(contextService).toContain('COPILOT_MESSAGE_CHARS = 360');
    expect(contextService).toContain('COPILOT_MAX_KB_ARTICLES = 3');

    const combined = `${front}\n${client}\n${ticketTab}\n${contextService}`;
    expect(combined).not.toMatch(/MetaClient|sendOutbound|sendTemplate|ticket\.whatsapp\.reply\.php.*copilot|KnowbaseItem::add|Publicar automaticamente/i);
  });
});
