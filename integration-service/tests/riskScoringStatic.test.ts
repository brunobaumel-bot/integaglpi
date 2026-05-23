import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function projectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

describe('predictive risk static safeguards', () => {
  it('keeps migration additive, isolated and non-destructive', async () => {
    const migration = compact(await projectFile('schema-migrations/033_predictive_risk_scores.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_risk_scores');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_risk_score_feedback');
    expect(migration).toContain('model_version TEXT NOT NULL');
    expect(migration).toContain('input_hash TEXT NOT NULL');
    expect(migration).toContain("reopen_risk IN ('low', 'medium', 'high', 'unknown')");
    expect(migration).toContain("feedback_rating IN ('useful', 'incorrect', 'unsure')");
    expect(migration).not.toMatch(/\bDROP\b|\bTRUNCATE\b|\bDELETE\b/i);
    expect(migration).not.toContain('glpi_tickets');
    expect(migration).not.toContain('glpi_knowbaseitems');
    expect(migration).not.toMatch(/embedding|vector|rag/i);
  });

  it('keeps risk scoring deterministic and free of LLM or operational send paths', async () => {
    const engine = await projectFile('src/riskScoring/engine.ts');
    const repository = await projectFile('src/riskScoring/repository.ts');
    const domain = await projectFile('src/domain/services/RiskScoringService.ts');
    const types = await projectFile('src/riskScoring/types.ts');
    const combined = `${types}\n${engine}\n${repository}\n${domain}`;

    expect(combined).toContain('risk_score_v1_2026_05');
    expect(combined).not.toMatch(/Ollama|MetaClient|OutboundMessageService|sendOutbound|sendTemplate/i);
    expect(combined).not.toMatch(/UPDATE\s+public\.glpi_plugin_integaglpi_conversations/i);
    expect(combined).not.toMatch(/UPDATE\s+glpi_tickets|SET\s+priority|SET\s+status/i);
    expect(combined).not.toMatch(/embedding|vector|rag/i);
  });

  it('keeps PHP UI read-only, permissioned and escaped', async () => {
    const service = await projectFile('../integaglpi/src/Service/RiskScoreService.php');
    const renderer = await projectFile('../integaglpi/src/Renderer/RiskScoreRenderer.php');
    const feedback = await projectFile('../integaglpi/front/risk.feedback.php');
    const ticketTab = await projectFile('../integaglpi/templates/ticket_tab.php');
    const dashboard = await projectFile('../integaglpi/templates/quality_dashboard.php');
    const riskFiles = `${service}\n${renderer}\n${feedback}`;
    const combined = `${riskFiles}\n${ticketTab}\n${dashboard}`;

    expect(combined).toContain('Indicador preditivo para apoio humano. Não executa ações automaticamente.');
    expect(combined).toContain('Plugin::canUpdate()');
    expect(combined).toContain('Plugin::isCsrfValid($_POST)');
    expect(combined).toContain('Html::cleanInputText');
    expect(combined).toContain('RISK_SCORE_FEEDBACK_RECORDED');
    expect(riskFiles).not.toMatch(/sendOutbound|ticket\.whatsapp\.reply|KnowbaseItem::add|KnowbaseItem::update|MetaClient/i);
    expect(riskFiles).not.toMatch(/UPDATE\s+glpi_tickets|UPDATE\s+glpi_plugin_integaglpi_conversations/i);
    expect(riskFiles).not.toMatch(/Publicar automaticamente|ranking punitivo/i);
  });
});
