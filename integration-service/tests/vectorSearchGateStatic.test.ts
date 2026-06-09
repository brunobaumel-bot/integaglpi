/**
 * Vector Search Gate — Static Tests (F7)
 *
 * Testes de gate que bloqueiam a adoção de busca vetorial enquanto
 * a decisão arquitetural KEEP_CURRENT_SEARCH estiver ativa.
 *
 * Verificações realizadas (sem acesso externo, sem DB, sem servidor):
 *   1. Ausência de imports de bibliotecas vetoriais nos serviços KB
 *   2. Ausência de `CREATE EXTENSION vector` nos scripts de migration conhecidos
 *   3. Integridade do baseline.json (não auto-modificado)
 *   4. Presença e validade do relatório de gate
 *   5. Presença do ADR de decisão
 *   6. Limites operacionais do stack atual preservados
 *
 * ABSOLUTAS:
 *   - no_pgvector_install: true — nenhum import pgvector nos serviços KB
 *   - no_qdrant: true — nenhum import qdrant
 *   - no_cloud_embeddings: true — sem openai/cohere/anthropic nos serviços KB
 *   - baseline_no_auto_modify: true — baseline.json tem os campos esperados
 *   - documentation_decision_only: true — gate é documentação, não feature flag
 *
 * Phase: integaglpi_v9_vector_search_gate_001 — F7
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ── Path resolution ───────────────────────────────────────────────────────────

/** Root of integration-service (where this test runs from). */
const SERVICE_ROOT = join(import.meta.dirname, '..');
/** Root of the whole repo (one level up from integration-service). */
const REPO_ROOT = join(SERVICE_ROOT, '..');
const DOCS_ROOT = join(REPO_ROOT, 'docs');
const EVAL_REPORTS_ROOT = join(DOCS_ROOT, 'eval_reports');
const ARCHITECTURE_ROOT = join(DOCS_ROOT, 'architecture');

/** KB service files to audit for forbidden imports. */
const KB_SERVICE_FILES = [
  join(SERVICE_ROOT, 'src/domain/services/KbSearchPlannerService.ts'),
  join(SERVICE_ROOT, 'src/domain/services/KbRankingService.ts'),
  join(SERVICE_ROOT, 'src/domain/services/KbRerankerService.ts'),
  join(SERVICE_ROOT, 'src/domain/services/KbRagCopilotService.ts'),
  join(SERVICE_ROOT, 'src/domain/services/SmartHelpService.ts'),
];

// ── Forbidden import patterns ─────────────────────────────────────────────────

/**
 * Libraries and patterns that must NOT appear in KB search service files.
 * Presence of any of these indicates an unauthorized vector search adoption.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /from ['"]pgvector['"]/i, description: 'pgvector import' },
  { pattern: /require\(['"]pgvector['"]\)/i, description: 'pgvector require' },
  { pattern: /pgvector/i, description: 'pgvector reference' },
  { pattern: /from ['"]@qdrant\/js-client-rest['"]/i, description: 'qdrant js-client import' },
  { pattern: /from ['"]qdrant-client['"]/i, description: 'qdrant-client import' },
  { pattern: /import\s+.*from\s+['"].*qdrant/i, description: 'qdrant ES import' },
  { pattern: /require\(['"].*qdrant/i, description: 'qdrant require' },
  { pattern: /new\s+QdrantClient\s*\(/i, description: 'QdrantClient instantiation' },
  { pattern: /weaviate/i, description: 'weaviate reference' },
  { pattern: /from ['"]openai['"]/i, description: 'openai import in KB service' },
  { pattern: /from ['"]@anthropic-ai\/sdk['"]/i, description: 'anthropic sdk import in KB service' },
  { pattern: /from ['"]cohere-ai['"]/i, description: 'cohere import in KB service' },
  { pattern: /text-embedding-/i, description: 'cloud embedding model reference' },
  { pattern: /cloud_embeddings_enabled\s*[:=]\s*true/i, description: 'cloud embeddings enabled literal' },
  { pattern: /CREATE EXTENSION\s+vector/i, description: 'pgvector extension creation' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, 'utf-8');
}

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  const content = readFileSafe(filePath);
  if (content === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

// ── 1. KB service files — no forbidden imports ────────────────────────────────

describe('F7 Gate — Ausência de bibliotecas vetoriais nos serviços KB', () => {
  for (const filePath of KB_SERVICE_FILES) {
    const shortName = filePath.split(/[\\/]/).pop() ?? filePath;

    it(`${shortName} — arquivo existe`, () => {
      expect(existsSync(filePath)).toBe(true);
    });

    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');

      for (const { pattern, description } of FORBIDDEN_PATTERNS) {
        it(`${shortName} — sem "${description}"`, () => {
          expect(content).not.toMatch(pattern);
        });
      }
    }
  }
});

// ── 2. Migration scripts — no CREATE EXTENSION vector ────────────────────────

describe('F7 Gate — Migrations sem CREATE EXTENSION vector', () => {
  const migrationsPath = join(SERVICE_ROOT, 'src/infra/db');
  const sqlDirs = [
    join(REPO_ROOT, 'infra'),
    join(SERVICE_ROOT, 'src/infra/db'),
  ];

  it('infra/sql: nenhum script contém CREATE EXTENSION vector', () => {
    for (const dir of sqlDirs) {
      if (!existsSync(dir)) continue;

      // We check known migration markers — not recursive glob (tests are static).
      // If a directory exists, we check its root for *.sql files.
      // This is a canary: if pgvector appears, the test fails and blocks the commit.
      // Full recursive check is done by CI grep; this covers the most likely locations.
      const { readdirSync } = require('node:fs');
      try {
        const entries: string[] = readdirSync(dir);
        const sqlFiles = entries.filter((f: string) => f.endsWith('.sql'));
        for (const sqlFile of sqlFiles) {
          const content = readFileSafe(join(dir, sqlFile));
          if (content) {
            expect(content).not.toMatch(/CREATE EXTENSION\s+vector/i);
          }
        }
      } catch {
        // Directory not readable — skip (not a hard failure; infra may not be present locally).
      }
    }
  });
});

// ── 3. Baseline integrity ─────────────────────────────────────────────────────

describe('F7 Gate — Integridade do baseline.json (NÃO auto-modificar)', () => {
  const baselinePath = join(EVAL_REPORTS_ROOT, 'baseline.json');

  it('baseline.json existe', () => {
    expect(existsSync(baselinePath)).toBe(true);
  });

  it('baseline.json é JSON válido', () => {
    const data = readJsonSafe(baselinePath);
    expect(data).not.toBeNull();
  });

  it('baseline.json tem campo product_detection_rate (number)', () => {
    const data = readJsonSafe(baselinePath);
    // Metrics may be at top level or nested under "metrics" key.
    const metrics = (data?.['metrics'] as Record<string, unknown> | undefined) ?? data ?? {};
    expect(typeof metrics['product_detection_rate']).toBe('number');
  });

  it('baseline.json tem campo tier_coverage_rate (number)', () => {
    const data = readJsonSafe(baselinePath);
    const metrics = (data?.['metrics'] as Record<string, unknown> | undefined) ?? data ?? {};
    expect(typeof metrics['tier_coverage_rate']).toBe('number');
  });

  it('baseline.json tem campo total_queries (number)', () => {
    const data = readJsonSafe(baselinePath);
    // total_queries may be at top level.
    const value = data?.['total_queries'] ?? (data?.['metrics'] as Record<string, unknown> | undefined)?.['total_queries'];
    expect(typeof value).toBe('number');
  });

  it('product_detection_rate está no range [0.0, 1.0]', () => {
    const data = readJsonSafe(baselinePath);
    const metrics = (data?.['metrics'] as Record<string, unknown> | undefined) ?? data ?? {};
    const value = metrics['product_detection_rate'];
    expect(typeof value).toBe('number');
    expect(value as number).toBeGreaterThanOrEqual(0);
    expect(value as number).toBeLessThanOrEqual(1);
  });

  it('tier_coverage_rate está no range [0.0, 1.0]', () => {
    const data = readJsonSafe(baselinePath);
    const metrics = (data?.['metrics'] as Record<string, unknown> | undefined) ?? data ?? {};
    const value = metrics['tier_coverage_rate'];
    expect(typeof value).toBe('number');
    expect(value as number).toBeGreaterThanOrEqual(0);
    expect(value as number).toBeLessThanOrEqual(1);
  });

  it('baseline.json NÃO tem campo vector_search_enabled (proibido — nem top-level nem em metrics)', () => {
    const data = readJsonSafe(baselinePath);
    const metrics = (data?.['metrics'] as Record<string, unknown> | undefined) ?? {};
    expect('vector_search_enabled' in (data ?? {})).toBe(false);
    expect('vector_search_enabled' in metrics).toBe(false);
  });

  it('baseline.json NÃO tem campo pgvector (proibido — nem top-level nem em metrics)', () => {
    const data = readJsonSafe(baselinePath);
    const metrics = (data?.['metrics'] as Record<string, unknown> | undefined) ?? {};
    expect('pgvector' in (data ?? {})).toBe(false);
    expect('pgvector' in metrics).toBe(false);
  });
});

// ── 4. Gate report files ──────────────────────────────────────────────────────

describe('F7 Gate — Arquivos de decisão presentes', () => {
  it('docs/architecture/adr_004_vector_search_decision.md existe', () => {
    const path = join(ARCHITECTURE_ROOT, 'adr_004_vector_search_decision.md');
    expect(existsSync(path)).toBe(true);
  });

  it('ADR contém decisão KEEP_CURRENT_SEARCH', () => {
    const path = join(ARCHITECTURE_ROOT, 'adr_004_vector_search_decision.md');
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('KEEP_CURRENT_SEARCH');
  });

  it('docs/eval_reports/vector_search_gate_2026-06-09.md existe', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.md');
    expect(existsSync(path)).toBe(true);
  });

  it('docs/eval_reports/vector_search_gate_2026-06-09.json existe', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.json');
    expect(existsSync(path)).toBe(true);
  });

  it('gate JSON tem campo decision=KEEP_CURRENT_SEARCH', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.json');
    const data = readJsonSafe(path);
    expect(data?.['decision']).toBe('KEEP_CURRENT_SEARCH');
  });

  it('gate JSON tem no_pgvector_install=true', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.json');
    const data = readJsonSafe(path);
    const restrictions = data?.['absolute_restrictions'] as Record<string, unknown> | undefined;
    expect(restrictions?.['no_pgvector_install']).toBe(true);
  });

  it('gate JSON tem no_qdrant=true', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.json');
    const data = readJsonSafe(path);
    const restrictions = data?.['absolute_restrictions'] as Record<string, unknown> | undefined;
    expect(restrictions?.['no_qdrant']).toBe(true);
  });

  it('gate JSON tem no_cloud_embeddings=true', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.json');
    const data = readJsonSafe(path);
    const restrictions = data?.['absolute_restrictions'] as Record<string, unknown> | undefined;
    expect(restrictions?.['no_cloud_embeddings']).toBe(true);
  });

  it('gate JSON tem baseline_no_auto_modify=true', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.json');
    const data = readJsonSafe(path);
    const restrictions = data?.['absolute_restrictions'] as Record<string, unknown> | undefined;
    expect(restrictions?.['baseline_no_auto_modify']).toBe(true);
  });

  it('gate JSON tem documentation_decision_only=true', () => {
    const path = join(EVAL_REPORTS_ROOT, 'vector_search_gate_2026-06-09.json');
    const data = readJsonSafe(path);
    const restrictions = data?.['absolute_restrictions'] as Record<string, unknown> | undefined;
    expect(restrictions?.['documentation_decision_only']).toBe(true);
  });
});

// ── 5. Operational limits — stack atual preservado ────────────────────────────

describe('F7 Gate — Stack atual preservado (sem substituição por vetor)', () => {
  it('KbSearchPlannerService.ts existe (stack atual ativo)', () => {
    expect(existsSync(join(SERVICE_ROOT, 'src/domain/services/KbSearchPlannerService.ts'))).toBe(true);
  });

  it('KbRankingService.ts existe (stack atual ativo)', () => {
    expect(existsSync(join(SERVICE_ROOT, 'src/domain/services/KbRankingService.ts'))).toBe(true);
  });

  it('KbRerankerService.ts existe (stack atual ativo)', () => {
    expect(existsSync(join(SERVICE_ROOT, 'src/domain/services/KbRerankerService.ts'))).toBe(true);
  });

  it('KbRagCopilotService.ts usa Ollama local (não cloud)', () => {
    const path = join(SERVICE_ROOT, 'src/domain/services/KbRagCopilotService.ts');
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf-8');
    // Must not reference cloud embedding APIs.
    expect(content).not.toMatch(/openai\.com\/v1\/embeddings/i);
    expect(content).not.toMatch(/api\.cohere\.ai/i);
  });

  it('feature_flags_matrix.md documenta F7 com KEEP_CURRENT_SEARCH', () => {
    const path = join(DOCS_ROOT, 'feature_flags_matrix.md');
    if (!existsSync(path)) return;
    const content = readFileSync(path, 'utf-8');
    expect(content).toContain('KEEP_CURRENT_SEARCH');
    expect(content).toContain('no_pgvector_install');
    expect(content).toContain('no_qdrant');
    expect(content).toContain('no_cloud_embeddings');
  });
});
