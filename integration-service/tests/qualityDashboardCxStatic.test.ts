import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readQualityDashboardService(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Service/QualityDashboardService.php', import.meta.url), 'utf8');
}

async function readQualityDashboardTemplate(): Promise<string> {
  return readFile(new URL('../../integaglpi/templates/quality_dashboard.php', import.meta.url), 'utf8');
}

async function readQualityDashboardRenderer(): Promise<string> {
  return readFile(new URL('../../integaglpi/src/Renderer/QualityDashboardRenderer.php', import.meta.url), 'utf8');
}

describe('PHP CX and Quality Dashboard static guards', () => {
  it('uses persisted P1/P2/P3 aggregates without render-time AI or operational actions', async () => {
    const service = await readQualityDashboardService();
    const template = await readQualityDashboardTemplate();
    const renderer = await readQualityDashboardRenderer();
    const combined = `${service}\n${template}\n${renderer}`;

    expect(service).toContain('loadCxQualityInsights');
    expect(service).toContain('glpi_plugin_integaglpi_ai_quality_analyses');
    expect(service).toContain('glpi_plugin_integaglpi_hist_patterns');
    expect(service).toContain('glpi_plugin_integaglpi_hist_insights');
    expect(service).toContain('glpi_plugin_integaglpi_kb_candidates');
    expect(service).toContain('glpi_plugin_integaglpi_kb_candidate_reviews');
    expect(service).toContain('tableExists');
    expect(service).toContain('MAX_RANGE_DAYS = 30');

    expect(template).toContain('Dashboard de Qualidade e CX');
    expect(template).toContain('Indicadores gerados por IA e regras');
    expect(template).toContain('não como avaliação disciplinar automática');
    expect(template).toContain('Aderência à KB');
    expect(template).toContain('Qualidade de comunicação e risco');
    expect(template).toContain('Lacunas históricas agregadas');
    expect(template).toContain('Candidatos de KB');
    expect(template).toContain('Coaching não punitivo');
    expect(template).toContain('Sem ranking disciplinar');
    expect(template).toContain('Dashboard read-only');
    expect(renderer).toContain('getKbCandidateUrl');

    for (const forbidden of [
      /new\s+Ollama/i,
      /ollamaClient/i,
      /openai/i,
      /MetaClient/,
      /sendOutbound/,
      /sendTemplate/,
      /createTicket/i,
      /updateTicket/i,
      /KnowbaseItem::(add|update|delete)/,
      /embedding/i,
    ]) {
      expect(combined).not.toMatch(forbidden);
    }
  });
});
