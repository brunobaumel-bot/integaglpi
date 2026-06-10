/**
 * KbCustomResponseService — F3 (integaglpi_v9_kb_enrichment_and_search_optimization_001)
 *
 * Garante:
 *   - CUSTOM_RESPONSE_ENABLED=false → null (feature desligada).
 *   - confiança < 0.60 → NÃO chama Ollama; mensagem obrigatória presente.
 *   - intent generic sem produto → gate ativado.
 *   - KB fonte SEMPRE visível (kb_sources) — complementa, nunca substitui.
 *   - sem KB → null (nunca inventa solução).
 *   - never_sent_to_customer / human_review_required literais.
 *   - falha de Ollama → fallback determinístico (sem exception).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  KbCustomResponseService,
  CUSTOM_RESPONSE_MIN_CONFIDENCE,
  INSUFFICIENT_CONTEXT_MESSAGE,
} from '../src/domain/services/KbCustomResponseService.js';
import type { TechnicianPlaybook, KbUsed } from '../src/domain/services/KbRagCopilotService.js';
import type { KbCandidateHit } from '../src/repositories/postgres/PostgresKbCandidateSearchRepository.js';
import type { SearchPlan } from '../src/domain/services/KbSearchPlannerService.js';
import { env } from '../src/config/env.js';

const mutableEnv = env as unknown as { CUSTOM_RESPONSE_ENABLED: boolean };

function makePlaybook(confidence: number): TechnicianPlaybook {
  return {
    resumo_do_incidente: 'Micromed não abre na estação.',
    sintomas_identificados: ['Aplicação não inicia'],
    hipoteses_por_camada: ['Aplicação: serviço local parado'],
    perguntas_de_triagem: ['Há mensagem de erro?'],
    verificacoes_ou_comandos_sugeridos: ['Verificar serviço Micromed (consultivo)'],
    causas_possiveis: ['Proxy local indisponível'],
    resolucao_sugerida: ['Reiniciar serviço local (com aprovação humana)'],
    validacao: ['Abrir o Micromed e confirmar login'],
    escalonamento: ['Escalar para N2 se persistir'],
    riscos_rollback: ['Sem riscos conhecidos'],
    kbs_utilizadas: [],
    nivel_de_confianca: confidence,
    avisos_de_seguranca: [],
  };
}

function makeHit(): KbCandidateHit {
  return {
    id: 7,
    candidateKey: 'kb-micromed-001',
    title: 'Micromed não abre — proxy local',
    articleType: 'procedimento_tecnico',
    categorySuggestion: 'Sistemas Clínicos',
    problemPattern: 'micromed nao abre; aplicacao nao inicia',
    symptomsJson: ['Aplicação não inicia', 'Tela travada na abertura'],
    probableCause: 'Serviço proxy local parado',
    recommendedProcedureJson: ['Verificar serviço', 'Reiniciar proxy'],
    checklistJson: ['Micromed abre normalmente'],
    tagsJson: ['micromed', 'proxy'],
    evidenceSummarySanitized: 'Casos recorrentes de proxy parado.',
    confidenceScore: 85,
    rawScore: 0.8,
  };
}

const kbsUsed: KbUsed[] = [{ id: 7, title: 'Micromed não abre — proxy local', category: 'Sistemas Clínicos', score: 0.82 }];

const anchoredPlan = {
  normalizedQuery: 'micromed nao abre',
  intent: 'application_not_opening',
  productOrSystem: 'Micromed',
  domain: 'clinical_systems',
  symptoms: [],
  mustTerms: ['micromed'],
  boostTerms: [],
  negativeTerms: [],
  negativeDomains: [],
  sourceTiersAllowed: ['tier_1_product_specific', 'tier_2_operational_kb'],
  minimumConfidence: 0.35,
  topK: 5,
  reason: 'test',
  planSource: 'deterministic',
} as unknown as SearchPlan;

const genericPlan = {
  ...anchoredPlan,
  intent: 'generic',
  productOrSystem: null,
} as unknown as SearchPlan;

describe('KbCustomResponseService — F3', () => {
  let originalFlag: boolean;

  beforeEach(() => {
    originalFlag = mutableEnv.CUSTOM_RESPONSE_ENABLED;
    mutableEnv.CUSTOM_RESPONSE_ENABLED = true;
  });

  afterEach(() => {
    mutableEnv.CUSTOM_RESPONSE_ENABLED = originalFlag;
  });

  it('flag off → retorna null sem chamar Ollama', async () => {
    mutableEnv.CUSTOM_RESPONSE_ENABLED = false;
    const ollama = { generateText: vi.fn() };
    const svc = new KbCustomResponseService(ollama);
    const r = await svc.buildCustomResponse('micromed nao abre', makePlaybook(0.9), [makeHit()], kbsUsed, anchoredPlan);
    expect(r).toBeNull();
    expect(ollama.generateText).not.toHaveBeenCalled();
  });

  it('sem KB fonte → null (nunca inventa solução)', async () => {
    const svc = new KbCustomResponseService({ generateText: vi.fn() });
    const r = await svc.buildCustomResponse('micromed nao abre', makePlaybook(0.9), [], [], anchoredPlan);
    expect(r).toBeNull();
  });

  it('confiança < 0.60 → NÃO chama Ollama e exibe mensagem obrigatória', async () => {
    const ollama = { generateText: vi.fn() };
    const svc = new KbCustomResponseService(ollama);
    const r = await svc.buildCustomResponse('micromed nao abre', makePlaybook(0.59), [makeHit()], kbsUsed, anchoredPlan);
    expect(r).not.toBeNull();
    expect(r!.mode).toBe('deterministic');
    expect(r!.gate_message).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
    expect(ollama.generateText).not.toHaveBeenCalled();
  });

  it('limiar do gate é exatamente 0.60', () => {
    expect(CUSTOM_RESPONSE_MIN_CONFIDENCE).toBe(0.60);
  });

  it('intent generic sem produto → gate ativado mesmo com confiança alta', async () => {
    const ollama = { generateText: vi.fn() };
    const svc = new KbCustomResponseService(ollama);
    const r = await svc.buildCustomResponse('teste sistema', makePlaybook(0.9), [makeHit()], kbsUsed, genericPlan);
    expect(r!.mode).toBe('deterministic');
    expect(r!.gate_message).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
    expect(ollama.generateText).not.toHaveBeenCalled();
  });

  it('confiança >= 0.60 + plano ancorado → personaliza via Ollama e mantém KB fonte visível', async () => {
    const ollama = {
      generateText: vi.fn().mockResolvedValue(JSON.stringify({
        sintomas_identificados: ['Micromed trava na splash screen'],
        hipoteses_por_camada: ['Aplicação: proxy local'],
        perguntas_de_triagem: ['O proxy local está em execução?'],
        verificacoes_consultivas: ['Checar serviço MicromedProxy (consultivo)'],
        causa_provavel: 'Proxy local parado',
        resolucao_sugerida: ['Reiniciar proxy com aprovação humana'],
        validacao: ['Micromed abre e autentica'],
        escalonamento: ['N2 se persistir'],
        riscos_rollback: [],
      })),
    };
    const svc = new KbCustomResponseService(ollama);
    const r = await svc.buildCustomResponse('micromed nao abre na recepcao', makePlaybook(0.8), [makeHit()], kbsUsed, anchoredPlan);
    expect(r!.mode).toBe('customized');
    expect(r!.gate_message).toBeNull();
    // KB fonte SEMPRE visível — complementa, nunca substitui.
    expect(r!.kb_sources).toHaveLength(1);
    expect(r!.kb_sources[0]!.title).toContain('Micromed');
    expect(r!.complementa_kb_original).toBe(true);
    expect(r!.never_sent_to_customer).toBe(true);
    expect(r!.human_review_required).toBe(true);
  });

  it('falha do Ollama → fallback determinístico sem exception', async () => {
    const ollama = { generateText: vi.fn().mockRejectedValue(new Error('timeout')) };
    const svc = new KbCustomResponseService(ollama);
    const r = await svc.buildCustomResponse('micromed nao abre na recepcao', makePlaybook(0.8), [makeHit()], kbsUsed, anchoredPlan);
    expect(r!.mode).toBe('deterministic');
    expect(r!.kb_sources).toHaveLength(1);
  });

  it('prompt não contém PII (telefone/email mascarados pelo guard)', async () => {
    const ollama = { generateText: vi.fn().mockResolvedValue('{}') };
    const svc = new KbCustomResponseService(ollama);
    await svc.buildCustomResponse(
      'micromed nao abre, contato joao@empresa.com tel 41 98833-4449',
      makePlaybook(0.8),
      [makeHit()],
      kbsUsed,
      anchoredPlan,
    );
    const prompt = String(ollama.generateText.mock.calls[0]?.[0] ?? '');
    expect(prompt).not.toContain('joao@empresa.com');
    expect(prompt).not.toContain('98833-4449');
  });

  it('resposta nunca contém mecanismo de envio ao cliente', async () => {
    const svc = new KbCustomResponseService(null);
    const r = await svc.buildCustomResponse('micromed nao abre na recepcao', makePlaybook(0.8), [makeHit()], kbsUsed, anchoredPlan);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/sendWhatsApp|send_to_customer|outbound/i);
    expect(r!.never_sent_to_customer).toBe(true);
  });
});
