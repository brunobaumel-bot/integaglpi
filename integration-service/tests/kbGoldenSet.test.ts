/**
 * KB Golden Set — Gate determinístico (F2.1 + F2.5)
 *
 * Regras:
 *   - NUNCA usa Ollama (KbSearchPlannerService com ollamaPort=null)
 *   - Falha em qualquer regressão do Search Planner → bloqueia merge
 *   - Sem assert exato sobre métricas LLM (essas ficam no kbRagasHarness)
 *   - Inclui as 17 queries do G0.6 (nunca substituídas) + 33 de expansão = 50 total
 *
 * Este arquivo é o alvo de `npm run test:kb-regression`.
 * Roda também como parte normal de `npm test`.
 *
 * Phase: integaglpi_v9_kb_quality_001 — F2.1 / F2.5
 */

import { describe, expect, it } from 'vitest';

import { KbSearchPlannerService } from '../src/domain/services/KbSearchPlannerService.js';
import {
  GOLDEN_SET,
  GOLDEN_SET_META,
} from './fixtures/kbGoldenSetFixtures.js';

// Instância determinística — ollamaPort=null garante planSource='deterministic'
const planner = new KbSearchPlannerService(null);

// ── Sanidade do conjunto ───────────────────────────────────────────────────────

describe('KB Golden Set — meta', () => {
  it('conjunto tem exatamente 50 queries', () => {
    expect(GOLDEN_SET.length).toBe(50);
  });

  it('G0.6 tem 17 queries herdadas', () => {
    expect(GOLDEN_SET_META.g06_queries).toBe(17);
  });

  it('expansão tem 33 queries novas', () => {
    expect(GOLDEN_SET_META.expansion_queries).toBe(33);
  });

  it('todos os ids são únicos', () => {
    const ids = GOLDEN_SET.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('source_tier usa apenas valores do enum real', () => {
    const validTiers = new Set([
      'tier_1_product_specific',
      'tier_2_operational_kb',
      'tier_3_generic_playbook',
      'tier_4_automation',
    ]);
    for (const q of GOLDEN_SET) {
      expect(validTiers.has(q.expected.source_tier),
        `id=${q.id}: tier inválido "${q.expected.source_tier}"`).toBe(true);
    }
  });

  it('min_confidence está no intervalo [0, 1]', () => {
    for (const q of GOLDEN_SET) {
      expect(q.expected.min_confidence,
        `id=${q.id}: min_confidence fora do intervalo`).toBeGreaterThanOrEqual(0);
      expect(q.expected.min_confidence,
        `id=${q.id}: min_confidence fora do intervalo`).toBeLessThanOrEqual(1);
    }
  });
});

// ── Gate determinístico por query ─────────────────────────────────────────────

describe('KB Golden Set — gate determinístico', () => {
  for (const fixture of GOLDEN_SET) {
    it(`[${fixture.id}] "${fixture.query.slice(0, 60)}"`, async () => {
      const plan = await planner.buildPlan(
        fixture.query,
        fixture.clientContext ?? undefined,
      );

      // 1. planSource deve ser sempre determinístico (sem Ollama)
      expect(plan.planSource, `${fixture.id}: planSource`).toBe('deterministic');

      // 2. produto/sistema detectado
      if (fixture.expected.product !== null) {
        expect(plan.productOrSystem, `${fixture.id}: product`).toBe(fixture.expected.product);
      } else {
        // product=null: planner não deve ter resolvido âncora de produto
        expect(plan.productOrSystem, `${fixture.id}: product deve ser null`).toBeNull();
      }

      // 3. tier de fonte esperado está permitido no plano
      expect(
        plan.sourceTiersAllowed,
        `${fixture.id}: source_tier "${fixture.expected.source_tier}" não está em sourceTiersAllowed`,
      ).toContain(fixture.expected.source_tier);

      // 4. minimumConfidence atende ao mínimo do fixture
      expect(
        plan.minimumConfidence,
        `${fixture.id}: minimumConfidence ${plan.minimumConfidence} < ${fixture.expected.min_confidence}`,
      ).toBeGreaterThanOrEqual(fixture.expected.min_confidence);

      // 5. intent (quando especificado no fixture)
      if (fixture.expected.intent !== undefined) {
        expect(plan.intent, `${fixture.id}: intent`).toBe(fixture.expected.intent);
      }

      // 6. forbidden: nenhum termo proibido no normalizedQuery
      for (const term of fixture.forbidden) {
        expect(
          plan.normalizedQuery.toLowerCase(),
          `${fixture.id}: normalizedQuery contém termo proibido "${term}"`,
        ).not.toContain(term.toLowerCase());
      }

      // 7. Campos proibidos não estão no plano (safety gate — cobre todos os fixtures)
      const planAsAny = plan as unknown as Record<string, unknown>;
      expect(planAsAny['raw_sql'], `${fixture.id}: raw_sql presente`).toBeUndefined();
      expect(planAsAny['sql_query'], `${fixture.id}: sql_query presente`).toBeUndefined();
      expect(planAsAny['executable_command'], `${fixture.id}: executable_command presente`).toBeUndefined();
      expect(planAsAny['customer_response'], `${fixture.id}: customer_response presente`).toBeUndefined();
    });
  }
});

// ── Invariantes de isolamento de domínio ──────────────────────────────────────
//
// Estas queries verificam que o planner produz negativeDomains que isolam
// produtos irrelevantes — proteção crítica contra cross-contamination de KB.

describe('KB Golden Set — isolamento de domínio', () => {
  it('query Micromed exclui windows_activation de negativeDomains', async () => {
    const plan = await planner.buildPlan('micromed nao esta abrindo');
    expect(plan.negativeDomains).toContain('windows_activation');
  });

  it('query AD sync exclui windows_activation e micromed de negativeDomains', async () => {
    const plan = await planner.buildPlan('active directory nao sincroniza usuarios');
    expect(plan.negativeDomains).toContain('windows_activation');
    expect(plan.negativeDomains).toContain('micromed');
  });

  it('query Synology exclui windows_activation de negativeDomains', async () => {
    const plan = await planner.buildPlan('restaurar arquivo synology backup');
    expect(plan.negativeDomains).toContain('windows_activation');
  });

  it('queries muito genéricas (≤2 tokens) elevam minimumConfidence', async () => {
    const planOk = await planner.buildPlan('ok falhou');
    const planErro = await planner.buildPlan('erro sistema');
    expect(planOk.minimumConfidence).toBeGreaterThanOrEqual(0.75);
    expect(planErro.minimumConfidence).toBeGreaterThanOrEqual(0.75);
  });

  it('PII (telefone) é removido do normalizedQuery', async () => {
    const plan = await planner.buildPlan('micromed do usuario 41988334449 nao abre');
    expect(plan.normalizedQuery).not.toMatch(/\d{9,}/);
    expect(plan.normalizedQuery.toLowerCase()).toContain('micromed');
  });
});
