import { describe, expect, it } from 'vitest';

import {
  KB_SEARCH_BASE_STATUSES,
  KB_SEARCH_NEEDS_REVIEW_STATUS,
  isKbSearchHmlPreviewRuntime,
  isKbSearchProductionRuntime,
  resolveKbSearchableStatuses,
  type KbSearchRuntimeEnv,
} from '../src/repositories/postgres/kbSearchStatusPolicy.js';
import { PostgresKbCandidateSearchRepository } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';

function env(overrides: Partial<KbSearchRuntimeEnv>): KbSearchRuntimeEnv {
  return {
    KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: false,
    NODE_ENV: 'development',
    AI_PILOT_ENVIRONMENT: 'test',
    ...overrides,
  };
}

describe('kbSearchStatusPolicy — needs_review HML-only gate', () => {
  it('default (flag false) excludes needs_review', () => {
    const statuses = resolveKbSearchableStatuses(env({ KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: false }));
    expect(statuses).toEqual([...KB_SEARCH_BASE_STATUSES]);
    expect(statuses).not.toContain(KB_SEARCH_NEEDS_REVIEW_STATUS);
  });

  it('HML homologation + flag true includes needs_review', () => {
    const statuses = resolveKbSearchableStatuses(
      env({
        KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: true,
        AI_PILOT_ENVIRONMENT: 'homologation',
        NODE_ENV: 'production',
      }),
    );
    expect(statuses).toEqual([...KB_SEARCH_BASE_STATUSES, KB_SEARCH_NEEDS_REVIEW_STATUS]);
  });

  it('test runtime + flag true includes needs_review', () => {
    const statuses = resolveKbSearchableStatuses(
      env({
        KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: true,
        NODE_ENV: 'test',
        AI_PILOT_ENVIRONMENT: 'test',
      }),
    );
    expect(statuses).toContain(KB_SEARCH_NEEDS_REVIEW_STATUS);
  });

  it('production AI_PILOT_ENVIRONMENT blocks needs_review even with flag true', () => {
    const runtime = env({
      KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: true,
      AI_PILOT_ENVIRONMENT: 'production',
      NODE_ENV: 'development',
    });
    expect(isKbSearchProductionRuntime(runtime)).toBe(true);
    expect(resolveKbSearchableStatuses(runtime)).toEqual([...KB_SEARCH_BASE_STATUSES]);
  });

  it('flag true without HML/test runtime excludes needs_review', () => {
    const runtime = env({
      KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: true,
      NODE_ENV: 'production',
      AI_PILOT_ENVIRONMENT: 'production',
    });
    expect(resolveKbSearchableStatuses(runtime)).toEqual([...KB_SEARCH_BASE_STATUSES]);
  });

  it('NODE_ENV production + homologation pilot allows preview when flag true', () => {
    const runtime = env({
      KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: true,
      NODE_ENV: 'production',
      AI_PILOT_ENVIRONMENT: 'homologation',
    });
    expect(isKbSearchProductionRuntime(runtime)).toBe(false);
    expect(resolveKbSearchableStatuses(runtime)).toContain(KB_SEARCH_NEEDS_REVIEW_STATUS);
  });
});

describe('PostgresKbCandidateSearchRepository — searchable status injection', () => {
  it('uses injected statuses for searchCandidates SQL params', async () => {
    const captured: { statuses: unknown[] | null } = { statuses: null };
    const executor = {
      query: async (_sql: string, params?: unknown[]) => {
        captured.statuses = params ?? null;
        return {
          rows: [
            {
              id: '1',
              candidate_key: 'kb:1',
              title: 'Teams login',
              article_type: 'procedimento_tecnico',
              category_suggestion: 'Operacional',
              problem_pattern: 'teams login',
              symptoms_json: [],
              probable_cause: '',
              recommended_procedure_json: [],
              checklist_json: [],
              tags_json: [],
              evidence_summary_sanitized: '',
              confidence_score: '80',
              ts_score: '0.5',
            },
          ],
        };
      },
    };
    const repo = new PostgresKbCandidateSearchRepository(executor as never, [
      'approved',
      'candidate',
      'needs_review',
    ]);
    await repo.searchCandidates('teams login', 3);
    expect(captured.statuses).toEqual(['teams login', 'approved', 'candidate', 'needs_review', 3]);
  });
});
