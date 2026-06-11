import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cli = readFileSync(new URL('../src/kbEnrichment/cli.ts', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/domain/services/KbEnrichmentService.ts', import.meta.url), 'utf8');
const repository = readFileSync(
  new URL('../src/repositories/postgres/PostgresKbCandidateSearchRepository.ts', import.meta.url),
  'utf8',
);

describe('KbEnrichment CLI — full rewrite/gap contract', () => {
  it('accepts the full content rewrite contract flags', () => {
    expect(cli).toContain("case '--apply-content-rewrite'");
    expect(cli).toContain("case '--all'");
    expect(cli).toContain("case '--format-16-sections'");
    expect(cli).toContain("case '--backup-originals'");
    expect(cli).toContain('applyContentRewriteAll');
    expect(cli).toContain("mode: 'apply-content-rewrite-all'");
  });

  it('treats --generate-candidates as an explicit gap-candidate mode', () => {
    expect(cli).toContain("case '--generate-candidates'");
    expect(cli).toContain('options.generateCandidates = true');
    expect(cli).toContain("mode: options.generateCandidates ? 'gaps-generate-candidates' : 'gaps'");
  });

  it('keeps the full rewrite bounded and original-backup based', () => {
    expect(service).toContain('public async applyContentRewriteAll');
    expect(service).toContain('Math.max(1, Math.min(batchSize, 50))');
    expect(service).toContain('listContentRewriteCandidates(safeBatch, 0)');
    expect(service).toContain('applyContentRewriteBatch');
    expect(service).toContain('original_backup');
  });

  it('creates gap candidates in the 16-section operational format', () => {
    expect(repository).toContain('## 1. Objetivo');
    expect(repository).toContain('## 16. Metadados');
    expect(repository).toContain('- Status: draft_gap_candidate.');
    expect(repository).toContain('- Publicacao: manual, nunca automatica.');
  });
});
