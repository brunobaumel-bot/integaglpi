import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('external research KB enrichment static safety', () => {
  it('keeps migration additive with catalog, citations, candidates and no GLPI core writes', async () => {
    const migration = compact(await readProjectFile('schema-migrations/036_external_research_kb_enrichment.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_source_catalog');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_research_requests');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_research_results');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_external_research_candidates');
    expect(migration).toContain('last_verified_date DATE NOT NULL');
    expect(migration).toContain('next_review_due DATE NOT NULL');
    expect(migration).toContain('auto_publish BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('Microsoft Learn');
    expect(migration).toContain('GLPI Docs');
    expect(migration).not.toContain('DROP TABLE');
    expect(migration).not.toContain('TRUNCATE');
    expect(migration).not.toContain('DELETE FROM');
    expect(migration).not.toContain('glpi_tickets');
    expect(migration).not.toContain('glpi_knowbaseitems');
  });

  it('keeps plugin UI manual, CSRF protected and without operational actions', async () => {
    const front = await readProjectFile('../integaglpi/front/external.research.php');
    const template = await readProjectFile('../integaglpi/templates/external_research.php');
    const service = await readProjectFile('../integaglpi/src/Service/ExternalResearchService.php');

    expect(front).toContain('Plugin::requireExternalResearchRead()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(template).toContain('Preview anonimizado');
    expect(template).toContain('name="preview_token"');
    expect(template).toContain('name="request_id"');
    expect(template).toContain('name="action" value="preview"');
    expect(template).toContain('name="action" value="confirm_research"');
    expect(template).toContain('name="action" value="create_candidate"');
    expect(template).toContain('Resultado da ação');
    expect(template).toContain('Próximos passos');
    expect(template).toContain('Conhecimento interno relacionado');
    expect(template).toContain('Nenhuma pesquisa registrada ainda');
    expect(template).toContain('Nenhum candidato externo criado ainda');
    expect(template).toContain('Publicação manual');
    expect(template).toContain('Não execute comandos/scripts sem validação técnica humana');
    expect(service).toContain('EXTERNAL_RESEARCH_BLOCKED_SOURCE');
    expect(service).toContain('EXTERNAL_RESEARCH_PREVIEW_REQUIRED');
    expect(service).toContain('EXTERNAL_RESEARCH_REQUEST_REQUIRED');
    expect(service).toContain('Informe um resumo técnico sem dados pessoais.');
    expect(service).toContain('createCandidateFromConfirmedRequest');
    expect(service).toContain("'create_candidate' => $this->createCandidateFromConfirmedRequest");
    expect(service).not.toContain("'create_candidate' => $this->confirmResearch");
    expect(service).toContain('requestExists');
    expect(service).toContain('loadInternalKnowledgeContext');
    expect(service).toContain('NativeKnowledgeBaseService');
    expect(service).toContain('glpi_plugin_integaglpi_kb_candidates');
    expect(service).toContain('glpi_plugin_integaglpi_hist_insights');
    expect(service).toContain('hasValidPreviewToken');
    expect(service).toContain('previewToken');
    expect(service).toContain('hash_equals');
    expect(service).not.toMatch(/__construct\s*\(\s*(?:public|protected|private)\s/i);
    expect(service).not.toMatch(/\breadonly\b/i);
    expect(`${front}\n${template}\n${service}`).not.toMatch(/sendOutbound|MetaClient|Ticket::update|KnowbaseItem::add|curl_exec|shell_exec|exec\(|proc_open|mail\(/i);
  });

  it('does not wire external research into webhook, inbound or outbound flows', async () => {
    const inbound = await readProjectFile('src/domain/services/InboundWebhookService.ts');
    const outbound = await readProjectFile('src/domain/services/OutboundMessageService.ts');

    expect(inbound).not.toContain('ExternalResearchService');
    expect(outbound).not.toContain('ExternalResearchService');
  });
});
