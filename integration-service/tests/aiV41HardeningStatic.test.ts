import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

async function readProjectFile(path: string): Promise<string> {
  return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const requiredDocs = [
  '../docs/ai_v4_1_feature_flags_matrix.md',
  '../docs/ai_v4_1_permissions_matrix.md',
  '../docs/ai_v4_1_tables_migrations_matrix.md',
  '../docs/ai_v4_1_audit_events_matrix.md',
  '../docs/ai_v4_1_e2e_test_plan.md',
  '../docs/ai_v4_1_homologation_checklist.md',
  '../docs/ai_v4_1_production_readiness.md',
  '../docs/ai_v4_1_rollback_playbook.md',
  '../docs/ai_v4_1_lgpd_incident_response.md',
  '../docs/smoke_tests.md',
];

describe('AI V4.1 final hardening static closure', () => {
  it('ships the operational closure documents without secrets or real identifiers', async () => {
    for (const path of requiredDocs) {
      const doc = await readProjectFile(path);

      expect(doc.length).toBeGreaterThan(120);
      expect(doc).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY|access_token\s*=|Bearer\s+[A-Za-z0-9._-]{12,}/i);
      expect(doc).not.toMatch(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
      expect(doc).not.toMatch(/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-.\s]?\d{4}\b/);
    }
  });

  it('keeps migration 037 as index-only additive SQL', async () => {
    const migration = compact(await readProjectFile('schema-migrations/037_ai_v4_1_hardening_indexes.sql'));

    expect(migration).toContain('CREATE INDEX IF NOT EXISTS');
    expect(migration).toContain('glpi_plugin_integaglpi_ai_quality_analyses');
    expect(migration).toContain('glpi_plugin_integaglpi_external_research_candidates');
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|CREATE TABLE)\b/i);
  });

  it('preserves cloud and embedding default-off gates', async () => {
    const env = await readProjectFile('src/config/env.ts');
    const example = await readProjectFile('.env.example');

    expect(env).toContain('AI_PILOT_CLOUD_ENABLED');
    expect(env).toContain("AI_PILOT_PROVIDER: z.enum(['disabled', 'local', 'cloud']).default('disabled')");
    expect(env).toContain('AI_PILOT_EMBEDDINGS_ENABLED');
    expect(env).toContain('AI_PILOT_DIRECTOR_APPROVED');
    expect(example).toContain('AI_PILOT_CLOUD_ENABLED=false');
    expect(example).toContain('AI_PILOT_EMBEDDINGS_ENABLED=false');
    expect(example).toContain('AI_PILOT_PROVIDER=disabled');
    expect(example).toContain('AI_PILOT_DIRECTOR_APPROVED=false');
    expect(example).not.toMatch(/sk-[A-Za-z0-9]|xox[baprs]-|Bearer\s+[A-Za-z0-9._-]{12,}/);
  });

  it('keeps explicit audit source values for new AI V4.1 event families', async () => {
    const files = [
      await readProjectFile('src/domain/services/AiSupervisorService.ts'),
      await readProjectFile('src/domain/services/AiPilotService.ts'),
      await readProjectFile('src/domain/services/CopilotDraftService.ts'),
      await readProjectFile('src/riskScoring/repository.ts'),
      await readProjectFile('src/kbCandidates/repository.ts'),
      await readProjectFile('src/domain/services/CoachingService.ts'),
      await readProjectFile('../integaglpi/src/Service/CoachingService.php'),
      await readProjectFile('../integaglpi/src/Service/ExternalResearchService.php'),
      await readProjectFile('../integaglpi/src/Service/KbCandidateService.php'),
      await readProjectFile('../integaglpi/src/Service/RiskScoreService.php'),
    ].join('\n');

    expect(files).toContain("source: 'AiSupervisorService'");
    expect(files).toContain("source: 'AiPilotService'");
    expect(files).toContain("source: 'CopilotDraftService'");
    expect(files).toContain("'RiskScoringService'");
    expect(files).toContain("'KbCandidateGenerator'");
    expect(files).toContain("source: 'CoachingService'");
    expect(files).toContain("'CoachingService'");
    expect(files).toContain("'ExternalResearchService'");
    expect(files).toContain("'PluginKbCandidate'");
    expect(files).toContain("'RiskScoreService'");
  });

  it('keeps hardening paths free of operational action calls', async () => {
    const content = [
      await readProjectFile('../integaglpi/src/Service/CoachingService.php'),
      await readProjectFile('../integaglpi/src/Service/ExternalResearchService.php'),
      await readProjectFile('../integaglpi/templates/external_research.php'),
    ].join('\n');

    expect(content).not.toMatch(/sendOutbound|MetaClient|Ticket::update|KnowbaseItem::add|curl_exec|shell_exec|proc_open|mail\(/i);
    expect(content).not.toMatch(/DROP\s+|TRUNCATE\s+|DELETE\s+FROM/i);
  });
});
