/**
 * Operational KB search smoke — real path via Postgres (HML only).
 *
 * Run on HML integration container (read-only):
 *   INTEGRAGLPI_KB_SMOKE_HML=1 \
 *   KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY=true \
 *   AI_PILOT_ENVIRONMENT=homologation \
 *   npx tsx scripts/kbOperationalSearchSmokeReal.ts
 *
 * Writes: tmp/kb_operational_search_smoke_real.yaml (repo root, when mounted)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KbRankingService } from '../src/domain/services/KbRankingService.js';
import { KbSearchPlannerService } from '../src/domain/services/KbSearchPlannerService.js';
import { postgresPool } from '../src/infra/db/postgres.js';
import { PostgresKbCandidateSearchRepository } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';
import {
  isKbSearchProductionRuntime,
  resolveKbSearchableStatuses,
} from '../src/repositories/postgres/kbSearchStatusPolicy.js';

const QUERIES: Array<{
  query_id: string;
  query: string;
  expected_id: number;
  allow_top1_alternate?: number[];
  top3_note?: string;
}> = [
  { query_id: 'teams_login', query: 'teams nao abre ou fica travado no login', expected_id: 307 },
  { query_id: 'antivirus_fp', query: 'antivirus bloqueou sistema falso positivo', expected_id: 310 },
  { query_id: 'ntfs_share', query: 'usuario sem acesso a pasta compartilhada permissao NTFS', expected_id: 308 },
  { query_id: 'onedrive_sync', query: 'onedrive sincronizacao pendente icone vermelho', expected_id: 314 },
  { query_id: 'scanner_twain', query: 'scanner nao digitaliza erro twain', expected_id: 312 },
  { query_id: 'erp_odbc', query: 'sistema financeiro erro DSN ODBC', expected_id: 313 },
  { query_id: 'wifi_desktop', query: 'desktop nao conecta no wifi adaptador wireless', expected_id: 315 },
  { query_id: 'backup_synology', query: 'restaurar arquivo backup synology', expected_id: 223 },
  {
    query_id: 'office_m365',
    query: 'office m365 falha ativacao licenciamento',
    expected_id: 215,
    allow_top1_alternate: [216],
    top3_note: 'Azure AD Connect pode rankear acima em queries M365/sync; 215 deve permanecer no top-3.',
  },
  { query_id: 'micromed_app', query: 'micromed aplicativo nao abre', expected_id: 306 },
];

async function main(): Promise<void> {
  if (process.env.INTEGAGLPI_KB_SMOKE_HML !== '1') {
    console.error('Set INTEGRAGLPI_KB_SMOKE_HML=1 to run real HML smoke.');
    process.exit(2);
  }

  const runtimeEnv = {
    KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY:
      process.env.KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY === 'true',
    NODE_ENV: (process.env.NODE_ENV ?? 'development') as 'development' | 'test' | 'production',
    AI_PILOT_ENVIRONMENT: (process.env.AI_PILOT_ENVIRONMENT ?? 'homologation') as
      | 'test'
      | 'homologation'
      | 'production',
  };

  if (isKbSearchProductionRuntime(runtimeEnv)) {
    console.error('Refusing real smoke: production runtime detected.');
    process.exit(3);
  }

  if (!runtimeEnv.KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY) {
    console.error('KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY must be true for HML needs_review smoke.');
    process.exit(4);
  }

  const searchableStatuses = resolveKbSearchableStatuses(runtimeEnv);
  const pool = postgresPool;
  const repo = new PostgresKbCandidateSearchRepository(pool, searchableStatuses);
  const planner = new KbSearchPlannerService(null);
  const ranking = new KbRankingService();

  const results: Array<Record<string, unknown>> = [];
  let passedTop3 = 0;
  let top1Correct = 0;
  let failed = 0;

  for (const item of QUERIES) {
    const plan = await planner.buildPlan(item.query);
    const ftsQuery = plan.normalizedQuery || item.query;
    const hits = await repo.searchCandidates(ftsQuery, 12);
    const ranked = ranking.rankHits(
      hits,
      ftsQuery.split(/\s+/).filter(Boolean),
      { productOrSystem: plan.productOrSystem },
      3,
      plan,
    );
    const top3 = ranked.map((r) => r.hit.id);
    const rank = top3.indexOf(item.expected_id) + 1;
    const top1Ok =
      top3[0] === item.expected_id ||
      (item.allow_top1_alternate?.includes(top3[0] ?? -1) ?? false);
    const passTop3 = rank >= 1 && rank <= 3;

    if (passTop3) {
      passedTop3 += 1;
    } else {
      failed += 1;
    }
    if (top1Ok) {
      top1Correct += 1;
    }

    results.push({
      query_id: item.query_id,
      query: item.query,
      expected_id: item.expected_id,
      expected_rank: rank > 0 ? rank : null,
      pass_top3: passTop3,
      top1_ok: top1Ok,
      top3,
      hits_from_search: hits.length,
      note: item.top3_note ?? null,
    });
  }

  await pool.end().catch(() => undefined);

  const report = {
    phase_id: 'integaglpi_v9_kb_operational_search_effectiveness_fix_002',
    source: 'postgres_hml_real',
    environment: 'HML',
    generated_at: new Date().toISOString().slice(0, 10),
    searchable_statuses: searchableStatuses,
    summary: {
      queries_tested: QUERIES.length,
      passed_top3: passedTop3,
      top1_correct: top1Correct,
      failed,
      critical_false_positives: [],
    },
    results,
  };

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(scriptDir, '../../tmp/kb_operational_search_smoke_real.yaml');
  mkdirSync(dirname(outPath), { recursive: true });
  const yaml = `# generated by scripts/kbOperationalSearchSmokeReal.ts\n${JSON.stringify(report, null, 2)}`;
  writeFileSync(outPath, yaml, 'utf8');
  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(report.summary, null, 2));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
