import { describe, expect, it } from 'vitest';

import { KbRankingService, type RankedKbHit } from '../src/domain/services/KbRankingService.js';
import { KbSearchPlannerService, type SearchPlan } from '../src/domain/services/KbSearchPlannerService.js';
import type { KbCandidateHit } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';

const planner = new KbSearchPlannerService(null);
const ranking = new KbRankingService();

function hit(overrides: Partial<KbCandidateHit>): KbCandidateHit {
  return {
    id: 1,
    candidateKey: 'kb:1',
    title: 'Base operacional',
    articleType: 'procedimento_tecnico',
    categorySuggestion: 'Operacional',
    problemPattern: '',
    symptomsJson: [],
    probableCause: '',
    recommendedProcedureJson: [],
    checklistJson: [],
    tagsJson: [],
    evidenceSummarySanitized: '',
    confidenceScore: 80,
    rawScore: 0.75,
    enrichmentVersion: 0,
    ...overrides,
  };
}

function ids(results: RankedKbHit[]): number[] {
  return results.map((r) => r.hit.id);
}

describe('KB operational search — planner/ranking SIMULATION (mock hits, not Postgres)', () => {
  const cases: Array<{
    query: string;
    product: string;
    expectedDomain: string;
    sourceTier: SearchPlan['sourceTiersAllowed'][number];
  }> = [
    { query: 'teams nao abre microfone nao funciona', product: 'Microsoft Teams', expectedDomain: 'collaboration', sourceTier: 'tier_1_product_specific' },
    { query: 'defender colocou sistema em quarentena falso positivo', product: 'Antivírus', expectedDomain: 'security', sourceTier: 'tier_2_operational_kb' },
    { query: 'onedrive nao sincroniza biblioteca sharepoint', product: 'OneDrive / SharePoint', expectedDomain: 'cloud_sync', sourceTier: 'tier_1_product_specific' },
    { query: 'scanner twain nao digitaliza', product: 'Scanner', expectedDomain: 'scan', sourceTier: 'tier_2_operational_kb' },
    { query: 'erp financeiro erro no dsn odbc', product: 'ERP / ODBC', expectedDomain: 'business_app', sourceTier: 'tier_2_operational_kb' },
    { query: 'desktop sem wifi adaptador wireless sumiu', product: 'Wi-Fi', expectedDomain: 'network', sourceTier: 'tier_2_operational_kb' },
  ];

  for (const item of cases) {
    it(`builds a deterministic plan for ${item.product}`, async () => {
      const plan = await planner.buildPlan(item.query);
      expect(plan.planSource).toBe('deterministic');
      expect(plan.productOrSystem).toBe(item.product);
      expect(plan.domain).toBe(item.expectedDomain);
      expect(plan.sourceTiersAllowed).toContain(item.sourceTier);
      expect(plan.normalizedQuery).not.toMatch(/\d{9,}|@|token|secret|bearer/i);
    });
  }

  it('keeps Teams collaboration results isolated from camera/NVR KBs (simulation)', async () => {
    const plan = await planner.buildPlan('teams camera nao funciona na reuniao');
    const ranked = ranking.rankHits(
      [
        hit({ id: 190, title: 'Câmeras IP / NVR', tagsJson: ['camera ip', 'nvr', 'cftv'] }),
        hit({ id: 307, title: 'Microsoft Teams — áudio, vídeo e cache', tagsJson: ['teams', 'microsoft-teams', 'camera-teams'] }),
      ],
      plan.normalizedQuery.split(/\s+/),
      { productOrSystem: plan.productOrSystem },
      3,
      plan,
    );

    expect(ids(ranked)).toEqual([307]);
  });

  it('keeps Scanner results isolated from printer queue KBs (simulation)', async () => {
    const plan = await planner.buildPlan('scanner twain nao digitaliza');
    const ranked = ranking.rankHits(
      [
        hit({ id: 17, title: 'Impressora offline e fila de impressão', tagsJson: ['spooler', 'impressora offline'] }),
        hit({ id: 312, title: 'Scanner / TWAIN / WIA não digitaliza', tagsJson: ['scanner', 'twain', 'wia'] }),
      ],
      plan.normalizedQuery.split(/\s+/),
      { productOrSystem: plan.productOrSystem },
      3,
      plan,
    );

    expect(ids(ranked)).toEqual([312]);
  });

  // ── Regressão da causa-raiz do smoke real 8/10 (ecosystem groups) ──────────
  // A lista plana de produtos isolados fazia o PRÓPRIO KB alvo se autoexcluir:
  // KB "OneDrive / SharePoint" morria na query onedrive (sharepoint tratado como
  // produto diferente) e KB "ERP / ODBC" morria na query odbc (erp idem).

  it('regression: KB OneDrive/SharePoint sobrevive a query onedrive (mesmo ecossistema M365)', async () => {
    const plan = await planner.buildPlan('onedrive sincronizacao pendente icone vermelho');
    const ranked = ranking.rankHits(
      [
        hit({
          id: 314,
          title: 'Microsoft OneDrive / SharePoint — Restaurar sincronização: ícone vermelho, pending ou processing changes',
          categorySuggestion: 'Software padrão > Microsoft 365',
          symptomsJson: ['OneDrive nao sincroniza', 'Arquivos com icone vermelho ou pendente'],
          tagsJson: ['onedrive', 'sharepoint', 'm365', 'sincronizacao'],
        }),
      ],
      plan.normalizedQuery.split(/\s+/),
      { productOrSystem: plan.productOrSystem },
      3,
      plan,
    );

    expect(ids(ranked)).toEqual([314]);
  });

  it('regression: KB ERP/ODBC sobrevive a query dsn odbc (mesmo domínio de negócio)', async () => {
    const plan = await planner.buildPlan('sistema financeiro erro DSN ODBC');
    const ranked = ranking.rankHits(
      [
        hit({
          id: 313,
          title: 'Software financeiro / ERP — Corrigir conexão ODBC: DSN não encontrado',
          categorySuggestion: 'Software > ERP / Financeiro',
          symptomsJson: ['ERP financeiro nao conecta no banco', 'Erro de DSN ODBC'],
          tagsJson: ['software-financeiro', 'erp', 'odbc', 'dsn'],
        }),
      ],
      plan.normalizedQuery.split(/\s+/),
      { productOrSystem: plan.productOrSystem },
      3,
      plan,
    );

    expect(ids(ranked)).toEqual([313]);
  });

  it('regression: isolamento CROSS-ecossistema preservado (query onedrive nunca retorna Micromed)', async () => {
    const plan = await planner.buildPlan('onedrive sincronizacao pendente icone vermelho');
    const ranked = ranking.rankHits(
      [
        hit({ id: 306, title: 'Micromed não abre', tagsJson: ['micromed', 'sistema'] }),
        hit({
          id: 314,
          title: 'Microsoft OneDrive / SharePoint — Restaurar sincronização',
          symptomsJson: ['OneDrive nao sincroniza'],
          tagsJson: ['onedrive', 'sharepoint', 'm365'],
        }),
      ],
      plan.normalizedQuery.split(/\s+/),
      { productOrSystem: plan.productOrSystem },
      3,
      plan,
    );

    expect(ids(ranked)).toEqual([314]);
  });
});

const runRealSmoke = process.env.INTEGAGLPI_KB_SMOKE_HML === '1';

describe.runIf(runRealSmoke)('KB operational search — REAL Postgres HML (searchCandidates → rankHits)', () => {
  it('loads hits from Postgres with needs_review when HML flag enabled', async () => {
    const { postgresPool } = await import('../src/infra/db/postgres.js');
    const { PostgresKbCandidateSearchRepository } = await import(
      '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js'
    );
    const { resolveKbSearchableStatuses } = await import(
      '../src/repositories/postgres/kbSearchStatusPolicy.js'
    );

    const runtimeEnv = {
      KB_SEARCH_INCLUDE_NEEDS_REVIEW_HML_ONLY: true,
      NODE_ENV: (process.env.NODE_ENV ?? 'development') as 'development' | 'test' | 'production',
      AI_PILOT_ENVIRONMENT: (process.env.AI_PILOT_ENVIRONMENT ?? 'homologation') as
        | 'test'
        | 'homologation'
        | 'production',
    };
    const statuses = resolveKbSearchableStatuses(runtimeEnv);
    expect(statuses).toContain('needs_review');

    const pool = postgresPool;
    const repo = new PostgresKbCandidateSearchRepository(pool, statuses);
    const hits = await repo.searchCandidates('teams login cache reuniao', 5);
    await pool.end().catch(() => undefined);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.id === 307)).toBe(true);
  });
});
