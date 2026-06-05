import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), 'utf8');
}

describe('PHP Online Monitor static safety', () => {
  it('registers a read-only monitor page with plugin permissions', async () => {
    const setup = await readProjectFile('integaglpi/setup.php');
    const plugin = await readProjectFile('integaglpi/src/Plugin.php');
    const front = await readProjectFile('integaglpi/front/online.monitor.php');
    const menu = await readProjectFile('integaglpi/src/OnlineMonitorMenu.php');
    const renderer = await readProjectFile('integaglpi/src/Renderer/OnlineMonitorRenderer.php');

    expect(setup).toContain('OnlineMonitorMenu::class');
    expect(setup).toContain('\\Plugin::registerClass(OnlineMonitorMenu::class);');
    expect(plugin).toContain('getOnlineMonitorUrl');
    expect(plugin).toContain('canOnlineMonitorRead');
    expect(plugin).toContain('requireOnlineMonitorRead');
    expect(front).toContain('Session::checkLoginUser();');
    expect(front).toContain('Plugin::requireOnlineMonitorRead();');
    expect(front).toContain('OnlineMonitorRenderer');
    expect(menu).toContain('Monitor Online WhatsApp');
    expect(menu).toContain('Plugin::canOnlineMonitorRead()');
    expect(renderer).toContain('Html::cleanInputText');
  });

  it('keeps the monitor query paginated, read-only and away from raw payloads', async () => {
    const service = await readProjectFile('integaglpi/src/Service/OnlineMonitorService.php');

    expect(service).toContain('private const DEFAULT_LIMIT = 50');
    expect(service).toContain('private const MAX_LIMIT = 100');
    expect(service).toContain('LIMIT :limit OFFSET :offset');
    expect(service).toContain('KPI_SAMPLE_LIMIT = 1000');
    expect(service).toContain('SELECT');
    expect(service).toContain('LEFT JOIN LATERAL');
    expect(service).toContain('maskPhone');
    expect(service).toContain('safeDisplayText');
    expect(service).toContain('sanitizeMessagePreview');
    expect(service).toContain('stalled_seconds');
    expect(service).toContain('last_inbound_at');
    expect(service).toContain('last_delivery_status');
    expect(service).toContain('ticket_status_quick');
    expect(service).toContain('matchesQuickTicketStatus');
    expect(service).toContain("'active'");
    expect(service).toContain("'without_ticket'");
    expect(service).not.toMatch(/SELECT\s+\*/i);
    expect(service).not.toMatch(/\braw_payload\b/i);
    expect(service).not.toMatch(/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+/i);
  });

  it('renders quick filters, collapsed advanced filters, KPIs, manual refresh and no mutable actions', async () => {
    const template = await readProjectFile('integaglpi/templates/online_monitor.php');

    expect(template).toContain('Monitor Online WhatsApp');
    expect(template).toContain('somente leitura');
    expect(template).toContain('Atualizar agora');
    expect(template).toContain('Auto-atualizar 20s');
    expect(template).toContain('Conversas abertas');
    expect(template).toContain('Aguardando técnico');
    expect(template).toContain('Aguardando cliente');
    expect(template).toContain('Pré-ticket');
    expect(template).toContain('Falhas');
    expect(template).toContain('Filtros avançados');
    expect(template).toContain('integaglpi-online-advanced-filters');
    expect(template).toContain('Filtros avançados ativos');
    expect(template).toContain('ticket_status_quick');
    expect(template).toContain('Ativos');
    expect(template).toContain('Em atendimento');
    expect(template).toContain('Sem ticket');
    expect(template).toContain('Itens por página');
    expect(template).toContain('Contexto WhatsApp');
    expect(template).toContain('localStorage');
    expect(template).toContain('$this->escape(');
    expect(template).not.toMatch(/method=["']post["']/i);
    expect(template).not.toMatch(/Enviar WhatsApp|Assumir atendimento|Transferir atendimento|Publicar KB|Salvar solução/i);
  });

  it('keeps AI alert detail modals outside display-none ancestors', async () => {
    const template = await readProjectFile('integaglpi/templates/online_monitor.php');

    expect(template).toContain('data-bs-toggle="modal"');
    expect(template).toContain('data-bs-target="#<?= $this->escape($modalId); ?>"');
    expect(template).toContain('integaglpi-ai-alert-modal-host');
    expect(template).not.toContain('<tr class="d-none">\n                                    <td colspan="6">\n                                        <div class="modal fade"');
  });

  it('does not touch AI, WhatsApp outbound, ticket mutation, KB publishing or PHP 8-only syntax', async () => {
    const files = await Promise.all([
      readProjectFile('integaglpi/front/online.monitor.php'),
      readProjectFile('integaglpi/src/OnlineMonitorMenu.php'),
      readProjectFile('integaglpi/src/Service/OnlineMonitorService.php'),
      readProjectFile('integaglpi/src/Renderer/OnlineMonitorRenderer.php'),
      readProjectFile('integaglpi/templates/online_monitor.php'),
    ]);
    const combined = files.join('\n');

    expect(combined).not.toMatch(/sendOutbound|MetaClient|sendTemplate|Ticket::update|KnowbaseItem::add|OutboundMessageService/i);
    expect(combined).not.toMatch(/Copilot|Ollama|ExternalResearch|AiOperations|HistoricalMining|P2|P3|P4|P9|embedding/i);
    expect(combined).not.toMatch(/\bmatch\s*\(|\breadonly\b|__construct\s*\(\s*(?:public|protected|private)\s/i);
  });
});
