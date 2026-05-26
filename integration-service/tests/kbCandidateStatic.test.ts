import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), 'utf8');
}

function compactSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('KB candidate P3 static safety', () => {
  it('keeps migration 030 additive, isolated and review-only', async () => {
    const migration = compactSql(await readProjectFile('integration-service/schema-migrations/030_ai_kb_candidates_from_history.sql'));

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_candidates');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.glpi_plugin_integaglpi_kb_candidate_reviews');
    expect(migration).toContain("status IN ('suggested', 'in_review', 'approved', 'rejected', 'low_confidence', 'possible_duplicate')");
    expect(migration).toContain('confidence_score INTEGER NOT NULL');
    expect(migration).toContain('content_markdown TEXT NOT NULL');
    expect(migration).toContain('evidence_hashes_json JSONB NOT NULL');
    expect(migration).not.toMatch(/DROP\s+|TRUNCATE\s+|DELETE\s+FROM/i);
    expect(migration).not.toMatch(/glpi_tickets|glpi_itilfollowups|glpi_itilsolutions/i);
    expect(migration).not.toMatch(/embedding|vector|rag/i);
  });

  it('keeps the generator offline and away from WhatsApp, GLPI core writes and cloud', async () => {
    const files = [
      'integration-service/src/kbCandidates/generator.ts',
      'integration-service/src/kbCandidates/repository.ts',
      'integration-service/src/kbCandidates/cli.ts',
    ];
    const combined = (await Promise.all(files.map(readProjectFile))).join('\n');

    expect(combined).toContain('minConfidence');
    expect(combined).toContain('possible_duplicate');
    expect(combined).toContain('Revisao humana obrigatoria');
    expect(combined).toContain('KB_CANDIDATE_GENERATED');
    expect(combined).toContain('KB_CANDIDATE_LOW_CONFIDENCE');
    expect(combined).toContain('KB_CANDIDATE_DUPLICATE_DETECTED');
    expect(combined).not.toMatch(/MetaClient|sendOutbound|sendTemplate|webhook|InboundWebhook|OutboundMessageService/i);
    expect(combined).not.toMatch(/OpenAI|Anthropic|OllamaClient|\bembedding\b|\bvector\b|\brag\b/i);
    expect(combined).not.toMatch(/glpi_tickets|glpi_itilfollowups|glpi_itilsolutions/i);
    expect(combined).not.toMatch(/INSERT\s+INTO\s+.*glpi_knowbaseitems|UPDATE\s+.*glpi_knowbaseitems/i);
  });

  it('exposes CLI script without requiring Ollama or publication', async () => {
    const packageJson = await readProjectFile('integration-service/package.json');
    const cli = await readProjectFile('integration-service/src/kbCandidates/cli.ts');

    expect(packageJson).toContain('"generate:kb-candidates"');
    expect(cli).toContain('--run-id');
    expect(cli).toContain('--dry-run');
    expect(cli).toContain('--native-kb-export');
    expect(cli).toContain('--no-ollama');
    expect(cli).not.toMatch(/publish|knowbaseitems|MetaClient/i);
  });

  it('keeps PHP candidate UI permissioned, CSRF protected and non-operational', async () => {
    const front = await readProjectFile('integaglpi/front/kb.candidates.php');
    const service = await readProjectFile('integaglpi/src/Service/KbCandidateService.php');
    const template = await readProjectFile('integaglpi/templates/kb_candidates.php');

    expect(front).toContain('Session::checkLoginUser();');
    expect(front).toContain('Plugin::requireSupervisorRead();');
    expect(front).toContain('Plugin::isCsrfValid($_POST)');
    expect(service).toContain('prepare(');
    expect(service).toContain('bindValue(');
    expect(service).toContain('KB_CANDIDATE_APPROVED');
    expect(service).toContain('KB_CANDIDATE_REJECTED');
    expect(template).toContain('Copiar Markdown');
    expect(template).toContain('Publicação na Base GLPI nativa continua manual');
    expect(template).toContain('$this->escape(');
    expect(template).not.toMatch(/Enviar WhatsApp|Acionar template|Publicar automaticamente|Ollama|Copiloto/i);
    expect(service).not.toMatch(/INSERT\s+INTO\s+.*glpi_knowbaseitems|UPDATE\s+.*glpi_knowbaseitems/i);
    expect(service).not.toMatch(/DROP\s+|TRUNCATE\s+|DELETE\s+FROM/i);
    expect(service).toContain('createKbCandidateFromSolution');
    expect(service).toContain('KB_CANDIDATE_CREATED_FROM_SOLUTION');
    expect(service).toContain("'edit_note'");
    expect(service).toContain('Nenhuma publicação automática foi executada');
  });
});
