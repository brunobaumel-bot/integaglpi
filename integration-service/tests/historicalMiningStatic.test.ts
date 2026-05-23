import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readProjectFile(path: string): Promise<string> {
  return await readFile(resolve(repoRoot, path), 'utf8');
}

describe('historical mining static safety', () => {
  it('keeps CLI offline and out of Express/webhook/outbound paths', async () => {
    const cli = await readProjectFile('integration-service/src/historicalMining/cli.ts');
    const packageJson = await readProjectFile('integration-service/package.json');

    expect(packageJson).toContain('"mine:history"');
    expect(cli).not.toMatch(/createApp|app\.post|webhook|MetaClient|OutboundMessageService|GlpiClient|OllamaClient/i);
    expect(cli).toContain('--dry-run');
    expect(cli).toContain('--input');
    expect(cli).toContain('--max-rows');
  });

  it('does not introduce cloud, embeddings, RAG, media or GLPI core writes', async () => {
    const files = [
      'integration-service/src/historicalMining/sanitizer.ts',
      'integration-service/src/historicalMining/input.ts',
      'integration-service/src/historicalMining/engine.ts',
      'integration-service/src/historicalMining/repository.ts',
      'integration-service/schema-migrations/029_ai_historical_mining_offline.sql',
    ];
    const combined = (await Promise.all(files.map(readProjectFile))).join('\n');

    expect(combined).not.toMatch(/OpenAI|Anthropic|OllamaClient|\bembedding\b|\bvector\b|\brag\b/i);
    expect(combined).not.toMatch(/MetaClient|sendTemplate|sendOutbound|webhook/i);
    expect(combined).not.toMatch(/glpi_tickets|glpi_itilfollowups|glpi_itilsolutions/i);
    expect(combined).not.toMatch(/attachment|media_info|base64,/i);
    expect(combined).not.toMatch(/DROP\s+|TRUNCATE\s+|DELETE\s+FROM/i);
  });

  it('persists only aggregate historical tables and sanitized evidence', async () => {
    const migration = await readProjectFile('integration-service/schema-migrations/029_ai_historical_mining_offline.sql');
    const repository = await readProjectFile('integration-service/src/historicalMining/repository.ts');

    expect(migration).toContain('glpi_plugin_integaglpi_hist_mining_runs');
    expect(migration).toContain('glpi_plugin_integaglpi_hist_patterns');
    expect(migration).toContain('glpi_plugin_integaglpi_hist_insights');
    expect(migration).toContain('glpi_plugin_integaglpi_hist_evidence');
    expect(migration).toContain('ticket_id_hash');
    expect(migration).toContain('anonymized_excerpt');
    expect(repository).toContain('description_sanitized');
    expect(repository).toContain('summary_sanitized');
    expect(repository).toContain('recommendation_sanitized');
    expect(repository).not.toContain('title_text_sanitized');
    expect(repository).not.toContain('description_text_sanitized');
    expect(repository).not.toContain('followup_text_sanitized');
    expect(repository).not.toContain('solution_text_sanitized');
  });
});
