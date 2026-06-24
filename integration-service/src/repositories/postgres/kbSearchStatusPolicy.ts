/**
 * KB search status policy — operational preview gate for needs_review.
 *
 * Default: approved + candidate only (production-safe).
 * HML preview: needs_review included ONLY when flag true AND runtime is not production.
 *
 * Phase: integaglpi_v9_kb_operational_search_effectiveness_fix_002
 */

import type { AppEnv } from '../../config/env.js';

/** Statuses always eligible for operational KB search. */
export const KB_SEARCH_BASE_STATUSES = ['approved', 'candidate'] as const;

export const KB_SEARCH_NEEDS_REVIEW_STATUS = 'needs_review' as const;

export type KbSearchRuntimeEnv = Pick<
  AppEnv,
  'KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY' | 'NODE_ENV' | 'AI_PILOT_ENVIRONMENT'
>;

/**
 * Returns true when the runtime is treated as production for KB search policy.
 * needs_review is NEVER included when this returns true — even if the flag is mis-set.
 */
export function isKbSearchProductionRuntime(env: KbSearchRuntimeEnv): boolean {
  if (env.AI_PILOT_ENVIRONMENT === 'production') {
    return true;
  }
  if (env.NODE_ENV === 'production' && env.AI_PILOT_ENVIRONMENT !== 'homologation' && env.AI_PILOT_ENVIRONMENT !== 'test') {
    return true;
  }
  return false;
}

/**
 * Returns true when HML/test preview of needs_review is permitted (flag still required).
 */
export function isKbSearchHmlPreviewRuntime(env: KbSearchRuntimeEnv): boolean {
  if (isKbSearchProductionRuntime(env)) {
    return false;
  }
  return (
    env.AI_PILOT_ENVIRONMENT === 'homologation' ||
    env.AI_PILOT_ENVIRONMENT === 'test' ||
    env.NODE_ENV === 'test' ||
    env.NODE_ENV === 'development'
  );
}

/**
 * Resolve searchable statuses for PostgresKbCandidateSearchRepository.searchCandidates.
 */
export function resolveKbSearchableStatuses(env: KbSearchRuntimeEnv): readonly string[] {
  const base = [...KB_SEARCH_BASE_STATUSES];
  if (!env.KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY) {
    return base;
  }
  if (!isKbSearchHmlPreviewRuntime(env)) {
    return base;
  }
  return [...base, KB_SEARCH_NEEDS_REVIEW_STATUS];
}
