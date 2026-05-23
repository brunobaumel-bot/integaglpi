import { describe, expect, it } from 'vitest';

import { buildAiQualityPrompt, normalizeAiQualityKbContext } from '../src/ai/aiQualityPrompt.js';
import { parseAiQualityResult } from '../src/ai/parseAiQualityResult.js';
import { sanitizeAiQualityText } from '../src/ai/sanitizeAiQualityInput.js';
import type { AiQualityContext } from '../src/ai/aiQualityTypes.js';

const context: AiQualityContext = {
  conversationId: 'conv-1',
  glpiTicketId: 123,
  ticketStatus: 'open',
  conversationStatus: 'open',
  queueName: 'Suporte',
  entityName: 'Empresa Teste',
  serviceName: 'Service Desk',
  slaResponseDeadline: new Date('2026-05-16T13:00:00.000Z'),
  slaSolutionDeadline: new Date('2026-05-16T18:00:00.000Z'),
  accumulatedPausedMinutes: 10,
  reopenCount: 1,
  csatRating: 'satisfied',
  supervisorReviewRequired: false,
  inactivityStatus: null,
  inactivitySkipReason: null,
  requesterName: 'Maria Cliente',
  messages: [
    {
      direction: 'inbound',
      messageType: 'text',
      messageText: 'Sou Maria Cliente, telefone +55 41 99999-9999, email maria@example.com, contrato ACME Especial.',
      createdAt: new Date('2026-05-16T12:00:00.000Z'),
    },
  ],
  recentEvents: [{
    eventType: 'META_API_FAILED',
    status: 'failed',
    severity: 'warning',
    errorSummary: 'token=secret',
    createdAt: new Date('2026-05-16T12:05:00.000Z'),
  }],
  attachmentMetadata: [{
    messageType: 'document',
    status: 'validated',
    mimeDetected: 'application/pdf',
    sizeBytes: 2048,
    fileName: 'contrato.pdf',
    createdAt: new Date('2026-05-16T12:06:00.000Z'),
  }],
  deliveryFailures: [{
    messageType: 'template',
    deliveryStatus: 'failed',
    metaErrorMessage: 'OAuthException access_token=abc',
    createdAt: new Date('2026-05-16T12:07:00.000Z'),
  }],
  templateEvents: [{
    templateName: 'aviso_atendimento_fora_janela',
    deliveryStatus: 'failed',
    metaErrorMessage: 'Template rejected',
    createdAt: new Date('2026-05-16T12:08:00.000Z'),
  }],
  kbContext: [{
    articleId: 10,
    title: 'Procedimento <script>alert(1)</script>',
    category: 'Suporte',
    excerpt: 'Valide o cadastro e oriente o cliente. data:image/png;base64,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    internalUrl: '/front/knowbaseitem.form.php?id=10',
  }],
};

describe('AI quality prompt and sanitization', () => {
  it('limits native KB context before it reaches the prompt', () => {
    const normalized = normalizeAiQualityKbContext(Array.from({ length: 8 }, (_, index) => ({
      article_id: index + 1,
      title: `Artigo ${index + 1}`,
      category: 'Suporte',
      excerpt: 'texto seguro '.repeat(120),
      internal_url: `/front/knowbaseitem.form.php?id=${index + 1}`,
      raw_html: '<script>alert(1)</script>',
      creator_id: 99,
    })));

    expect(normalized.length).toBeLessThanOrEqual(5);
    expect((normalized[0]?.excerpt ?? '').length).toBeLessThanOrEqual(800);
    expect(normalized.map((article) => article.title + article.category + article.excerpt).join('').length).toBeLessThanOrEqual(3000);
    expect(JSON.stringify(normalized)).not.toContain('creator_id');
    expect(JSON.stringify(normalized)).not.toContain('raw_html');
  });

  it('masks PII before building the prompt', () => {
    const sanitized = sanitizeAiQualityText(
      'Maria Cliente +55 41 99999-9999 maria@example.com CPF 123.456.789-10 contrato Premium Authorization: Bearer abcdefghijklmnop token=secret https://lookaside.fbsbx.com/file?access_token=abc data:image/png;base64,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ['Maria Cliente'],
    );

    expect(sanitized).toContain('[CLIENTE]');
    expect(sanitized).toContain('[TELEFONE]');
    expect(sanitized).toContain('[EMAIL]');
    expect(sanitized).toContain('[DADO_REMOVIDO]');
    expect(sanitized).toContain('[CONTRATO]');
    expect(sanitized).toContain('[SEGREDO_REMOVIDO]');
    expect(sanitized).toContain('[URL_REMOVIDA]');
    expect(sanitized).toContain('[BINARIO_REMOVIDO]');
    expect(sanitized).not.toContain('99999-9999');
    expect(sanitized).not.toContain('maria@example.com');
    expect(sanitized).not.toContain('lookaside.fbsbx.com');
    expect(sanitized).not.toContain('abcdefghijklmnop');
  });

  it('builds a read-only JSON prompt without raw Meta payloads or attachments', () => {
    const prompt = buildAiQualityPrompt(context, 12000);

    expect(prompt).toContain('ai_quality_v2');
    expect(prompt).toContain('IA supervisora read-only');
    expect(prompt).toContain('Não converse com o cliente');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"urgency"');
    expect(prompt).toContain('"risk_level"');
    expect(prompt).toContain('sla');
    expect(prompt).toContain('attachments');
    expect(prompt).toContain('recent_events');
    expect(prompt).toContain('templates');
    expect(prompt).toContain('kb_articles');
    expect(prompt).toContain('kb_alignment');
    expect(prompt).toContain('procedure_followed');
    expect(prompt).toContain('Regra de consistência obrigatória');
    expect(prompt).toContain('related_kb_articles tiver qualquer artigo');
    expect(prompt).toContain('aviso_atendimento_fora_janela');
    expect(prompt).toContain('[CLIENTE]');
    expect(prompt).toContain('[TELEFONE]');
    expect(prompt).toContain('[EMAIL]');
    expect(prompt).not.toContain('payload_json');
    expect(prompt).not.toContain('base64');
    expect(prompt).not.toContain('<script>');
    expect(prompt).not.toContain('maria@example.com');
  });

  it('accepts valid structured JSON and rejects invalid JSON', () => {
    expect(parseAiQualityResult(JSON.stringify({
      summary: 'Atendimento resolvido.',
      sentiment: 'positive',
      urgency: 'medium',
      risk_level: 'low',
      risk_flags: ['missing_context', 'unknown_flag'],
      quality_flags: ['needs_follow_up', 'unknown_quality'],
      missing_context: ['número do patrimônio'],
      probable_cause: 'dúvida operacional',
      suggested_next_action: 'Técnico deve revisar o retorno antes de responder.',
      supervisor_notes: 'Sem ação automática.',
      confidence_score: 73,
      safety_notes: ['revisão humana obrigatória'],
      related_kb_articles: [{
        article_id: 10,
        title: 'Procedimento GLPI',
        category: 'Suporte',
        relevance_score: 91,
        why_relevant: 'Cobre o caso analisado.',
        internal_url: '/front/knowbaseitem.form.php?id=10',
      }],
      kb_alignment: 'aligned',
      procedure_followed: 'yes',
      procedure_notes: 'Procedimento seguido com ressalvas menores.',
      communication_quality: {
        clarity: 8,
        empathy: 7,
        completeness: 8,
        tone: 'professional',
      },
      client_satisfaction_risk: 'low',
      key_insights: ['Atendimento consultivo.'],
      suggested_improvements_for_technician: ['Registrar evidência da validação.'],
      supervisor_recommendation: ['Acompanhar sem ação automática.'],
      _allowed_kb_article_ids: [10],
    }))).toEqual({
      summary: 'Atendimento resolvido.',
      resolution: 'probably_resolved',
      sentiment: 'positive',
      urgency: 'medium',
      riskLevel: 'low',
      riskFlags: ['missing_context'],
      qualityFlags: ['needs_follow_up'],
      missingContext: ['número do patrimônio'],
      probableCause: 'Hipótese: dúvida operacional',
      suggestedNextAction: 'Técnico deve revisar o retorno antes de responder.',
      supervisorNotes: 'Sem ação automática.',
      confidenceScore: 73,
      safetyNotes: ['revisão humana obrigatória'],
      flags: ['supervisor_review_required'],
      recommendation: 'Técnico deve revisar o retorno antes de responder.',
      relatedKbArticles: [{
        articleId: 10,
        title: 'Procedimento GLPI',
        category: 'Suporte',
        relevanceScore: 91,
        whyRelevant: 'Cobre o caso analisado.',
        internalUrl: '/front/knowbaseitem.form.php?id=10',
      }],
      kbAlignment: 'aligned',
      procedureFollowed: 'yes',
      procedureNotes: 'Procedimento seguido com ressalvas menores.',
      communicationQuality: {
        clarity: 8,
        empathy: 7,
        completeness: 8,
        tone: 'professional',
      },
      clientSatisfactionRisk: 'low',
      keyInsights: ['Atendimento consultivo.'],
      suggestedImprovementsForTechnician: ['Registrar evidência da validação.'],
      supervisorRecommendation: ['Acompanhar sem ação automática.'],
    });

    expect(() => parseAiQualityResult('isso nao e json')).toThrow('AI_QUALITY_INVALID_JSON');
  });

  it('rejects invalid shape and invalid enum values', () => {
    expect(() => parseAiQualityResult(JSON.stringify({
      summary: 'Sem classificação.',
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'severe',
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar.',
      confidence_score: 40,
    }))).toThrow('AI_QUALITY_INVALID_CLASSIFICATION');

    expect(() => parseAiQualityResult(JSON.stringify({
      summary: 'Resumo',
      sentiment: 'send_whatsapp',
      urgency: 'low',
      risk_level: 'low',
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar.',
      confidence_score: 40,
    }))).toThrow('AI_QUALITY_INVALID_CLASSIFICATION');

    expect(() => parseAiQualityResult(JSON.stringify({
      summary: 'Resumo',
      sentiment: 'neutral',
      urgency: 'execute',
      risk_level: 'low',
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar.',
      confidence_score: 40,
    }))).toThrow('AI_QUALITY_INVALID_CLASSIFICATION');

    expect(() => parseAiQualityResult(JSON.stringify({
      summary: null,
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'low',
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar.',
      confidence_score: 40,
    }))).toThrow('AI_QUALITY_INVALID_SHAPE');
  });

  it('truncates long model fields', () => {
    const result = parseAiQualityResult(JSON.stringify({
      summary: 'Resumo longo. '.repeat(80),
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'low',
      risk_flags: [],
      quality_flags: ['supervisor_review_required'],
      missing_context: ['campo ausente '.repeat(20)],
      probable_cause: 'causa possível '.repeat(20),
      suggested_next_action: 'orientar supervisor '.repeat(20),
      supervisor_notes: 'nota ao supervisor '.repeat(30),
      confidence_score: 140,
      safety_notes: ['cuidado operacional '.repeat(20)],
      related_kb_articles: [],
      kb_alignment: 'no_article_found',
      procedure_followed: 'unknown',
      procedure_notes: 'nota procedimento '.repeat(30),
      communication_quality: {
        clarity: 20,
        empathy: 0,
        completeness: 8,
        tone: 'friendly',
      },
      client_satisfaction_risk: 'medium',
      key_insights: ['insight '.repeat(30), 'x', 'y', 'z'],
      suggested_improvements_for_technician: ['melhoria '.repeat(30), 'x', 'y', 'z'],
      supervisor_recommendation: ['recomendação '.repeat(30), 'x', 'y', 'z'],
    }));

    expect(result.summary).toHaveLength(500);
    expect(result.recommendation).toHaveLength(200);
    expect(result.probableCause).toMatch(/^Hipótese:/);
    expect(result.confidenceScore).toBe(100);
    expect(result.keyInsights).toHaveLength(3);
    expect(result.communicationQuality.clarity).toBe(10);
    expect(result.communicationQuality.empathy).toBe(1);
  });

  it('rejects unsafe executable suggestions', () => {
    expect(() => parseAiQualityResult(JSON.stringify({
      summary: 'Resumo',
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'low',
      risk_flags: [],
      quality_flags: [],
      missing_context: [],
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Enviei WhatsApp para o cliente.',
      supervisor_notes: '',
      confidence_score: 50,
      safety_notes: [],
      related_kb_articles: [],
      kb_alignment: 'no_article_found',
      procedure_followed: 'unknown',
      procedure_notes: '',
      communication_quality: {
        clarity: 5,
        empathy: 5,
        completeness: 5,
        tone: 'professional',
      },
      client_satisfaction_risk: 'low',
      key_insights: [],
      suggested_improvements_for_technician: [],
      supervisor_recommendation: [],
    }))).toThrow('AI_QUALITY_UNSAFE_ACTION');
  });

  it('rejects related KB articles not present in the supplied context list', () => {
    expect(() => parseAiQualityResult(JSON.stringify({
      summary: 'Resumo',
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'low',
      risk_flags: [],
      quality_flags: [],
      missing_context: [],
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar manualmente.',
      supervisor_notes: '',
      confidence_score: 50,
      safety_notes: [],
      related_kb_articles: [{
        article_id: 999,
        title: 'Não fornecido',
        category: 'Suporte',
        relevance_score: 80,
        why_relevant: 'Inventado.',
        internal_url: '/front/knowbaseitem.form.php?id=999',
      }],
      kb_alignment: 'aligned',
      procedure_followed: 'yes',
      procedure_notes: '',
      communication_quality: {
        clarity: 5,
        empathy: 5,
        completeness: 5,
        tone: 'professional',
      },
      client_satisfaction_risk: 'low',
      key_insights: [],
      suggested_improvements_for_technician: [],
      supervisor_recommendation: [],
      _allowed_kb_article_ids: [10],
    }))).toThrow('AI_QUALITY_UNKNOWN_KB_ARTICLE');
  });

  it('rejects no_article_found when related KB articles are present', () => {
    expect(() => parseAiQualityResult(JSON.stringify({
      summary: 'Resumo',
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'low',
      risk_flags: [],
      quality_flags: [],
      missing_context: [],
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar manualmente.',
      supervisor_notes: '',
      confidence_score: 50,
      safety_notes: [],
      related_kb_articles: [{
        article_id: 10,
        title: 'Ativação Office',
        category: 'Office',
        relevance_score: 88,
        why_relevant: 'Cobre ativação do Office.',
        internal_url: '/front/knowbaseitem.form.php?id=10',
      }],
      kb_alignment: 'no_article_found',
      procedure_followed: 'unknown',
      procedure_notes: '',
      communication_quality: {
        clarity: 5,
        empathy: 5,
        completeness: 5,
        tone: 'professional',
      },
      client_satisfaction_risk: 'low',
      key_insights: [],
      suggested_improvements_for_technician: [],
      supervisor_recommendation: [],
      _allowed_kb_article_ids: [10],
    }))).toThrow('AI_QUALITY_KB_ALIGNMENT_CONFLICT');
  });

  it('allows no_article_found only when no related KB article is returned', () => {
    const result = parseAiQualityResult(JSON.stringify({
      summary: 'Resumo',
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'low',
      risk_flags: [],
      quality_flags: [],
      missing_context: [],
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar manualmente.',
      supervisor_notes: '',
      confidence_score: 50,
      safety_notes: [],
      related_kb_articles: [],
      kb_alignment: 'no_article_found',
      procedure_followed: 'unknown',
      procedure_notes: '',
      communication_quality: {
        clarity: 5,
        empathy: 5,
        completeness: 5,
        tone: 'professional',
      },
      client_satisfaction_risk: 'low',
      key_insights: [],
      suggested_improvements_for_technician: [],
      supervisor_recommendation: [],
      _allowed_kb_article_ids: [10],
    }));

    expect(result.kbAlignment).toBe('no_article_found');
    expect(result.relatedKbArticles).toEqual([]);
  });

  it('allows related KB article with a concrete alignment', () => {
    const result = parseAiQualityResult(JSON.stringify({
      summary: 'Resumo',
      sentiment: 'neutral',
      urgency: 'low',
      risk_level: 'low',
      risk_flags: [],
      quality_flags: [],
      missing_context: [],
      probable_cause: 'Não identificado com segurança',
      suggested_next_action: 'Revisar manualmente.',
      supervisor_notes: '',
      confidence_score: 50,
      safety_notes: [],
      related_kb_articles: [{
        article_id: 10,
        title: 'Ativação Office',
        category: 'Office',
        relevance_score: 88,
        why_relevant: 'Cobre ativação do Office.',
        internal_url: '/front/knowbaseitem.form.php?id=10',
      }],
      kb_alignment: 'partially_aligned',
      procedure_followed: 'partial',
      procedure_notes: 'Houve referência parcial ao procedimento.',
      communication_quality: {
        clarity: 5,
        empathy: 5,
        completeness: 5,
        tone: 'professional',
      },
      client_satisfaction_risk: 'low',
      key_insights: [],
      suggested_improvements_for_technician: [],
      supervisor_recommendation: [],
      _allowed_kb_article_ids: [10],
    }));

    expect(result.kbAlignment).toBe('partially_aligned');
    expect(result.relatedKbArticles).toHaveLength(1);
  });
});
