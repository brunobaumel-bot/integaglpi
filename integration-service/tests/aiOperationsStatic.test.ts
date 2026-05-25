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

  it('keeps AI configuration read-only and masks sensitive values', async () => {
    const front = await readProjectFile('integaglpi/front/ai.config.php');
    const service = await readProjectFile('integaglpi/src/Service/AiConfigViewService.php');
    const template = await readProjectFile('integaglpi/templates/ai_config.php');

    expect(front).toContain('Plugin::requireAiOperationsRead()');
    expect(service).toContain('maskUrl');
    expect(template).toContain('auth_key_visible');
    expect(template).toContain('read-only');
    expect(`${front}\n${service}\n${template}`).not.toMatch(/name=".*token|name=".*secret|integration_auth_key|META_ACCESS_TOKEN/);
  });

  it('uses controlled internal endpoints for P2/P3 UI without shell or arbitrary paths', async () => {
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
    expect(phpService).toContain('jsonl_base64');
    expect(phpService).toContain('dry_run_token');
    expect(nodeService).toContain('mkdtemp');
    expect(nodeService).toContain('HISTORICAL_MINING_DRY_RUN_REQUIRED');
    expect(`${phpService}\n${nodeService}`).not.toMatch(/shell_exec|exec\s*\(|passthru|proc_open|spawn\(|child_process|inputPath|path_arbitrary/i);
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
