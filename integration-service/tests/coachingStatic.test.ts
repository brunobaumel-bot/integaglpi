import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('coaching onboarding static safety', () => {
  it('keeps coaching migration additive, isolated and anti-ranking', async () => {
    const migration = compact(await readProjectFile('schema-migrations/035_coaching_onboarding.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_coaching_recommendations');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_coaching_feedback');
    expect(migration).toContain('recommendation_version TEXT NOT NULL');
    expect(migration).toContain('input_hash TEXT NOT NULL');
    expect(migration).toContain("scope_type IN ('team', 'queue', 'category', 'technician_private', 'entity')");
    expect(migration).not.toContain('DROP TABLE');
    expect(migration).not.toContain('TRUNCATE');
    expect(migration).not.toContain('DELETE FROM');
    expect(migration).not.toContain('ranking');
    expect(migration).not.toContain('glpi_tickets');
    expect(migration).not.toContain('glpi_knowbaseitems');
  });

  it('keeps plugin page supervisor-only, CSRF-protected and without operational actions', async () => {
    const front = await readProjectFile('../integaglpi/front/coaching.php');
    const template = await readProjectFile('../integaglpi/templates/coaching.php');
    const service = await readProjectFile('../integaglpi/src/Service/CoachingService.php');

    expect(front).toContain('Plugin::requireCoachingRead()');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(template).toContain('Não usar como avaliação disciplinar automática');
    expect(template).toContain('Sem ranking');
    expect(service).toContain('glpi_plugin_integaglpi_coaching_feedback');
    expect(service).toContain("status = 'dismissed'");
    expect(service).toContain('sanitizeInternalUrl');
    expect(service).toContain('javascript|data|vbscript');
    expect(service).toContain('/front/knowbaseitem.form.php');
    expect(service).toContain('/plugins/integaglpi/');
    expect(service).not.toMatch(/__construct\s*\(\s*(?:public|protected|private)\s/i);
    expect(service).not.toMatch(/\breadonly\b/i);
    expect(`${front}\n${template}\n${service}`).not.toMatch(/sendOutbound|ticket\.whatsapp|MetaClient|KnowbaseItem::add|Ticket::update|mail\(/i);
  });

  it('does not wire coaching into webhook, inbound, outbound or render-time LLM calls', async () => {
    const inbound = await readProjectFile('src/domain/services/InboundWebhookService.ts');
    const outbound = await readProjectFile('src/domain/services/OutboundMessageService.ts');
    const template = await readProjectFile('../integaglpi/templates/coaching.php');

    expect(inbound).not.toContain('CoachingService');
    expect(outbound).not.toContain('CoachingService');
    expect(template).not.toMatch(/Ollama|cloud|AI_PILOT|fetch\(/i);
  });
});
