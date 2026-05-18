import { describe, expect, it } from 'vitest';

import { buildAiQualityPrompt } from '../src/ai/aiQualityPrompt.js';
import { parseAiQualityResult } from '../src/ai/parseAiQualityResult.js';
import { sanitizeAiQualityText } from '../src/ai/sanitizeAiQualityInput.js';
import type { AiQualityContext } from '../src/ai/aiQualityTypes.js';

const context: AiQualityContext = {
  conversationId: 'conv-1',
  glpiTicketId: 123,
  ticketStatus: 'open',
  csatRating: 'satisfied',
  supervisorReviewRequired: false,
  inactivityStatus: null,
  requesterName: 'Maria Cliente',
  messages: [
    {
      direction: 'inbound',
      messageType: 'text',
      messageText: 'Sou Maria Cliente, telefone +55 41 99999-9999, email maria@example.com, contrato ACME Especial.',
      createdAt: new Date('2026-05-16T12:00:00.000Z'),
    },
  ],
};

describe('AI quality prompt and sanitization', () => {
  it('masks PII before building the prompt', () => {
    const sanitized = sanitizeAiQualityText(
      'Maria Cliente +55 41 99999-9999 maria@example.com CPF 123.456.789-10 contrato Premium',
      ['Maria Cliente'],
    );

    expect(sanitized).toContain('[CLIENTE]');
    expect(sanitized).toContain('[TELEFONE]');
    expect(sanitized).toContain('[EMAIL]');
    expect(sanitized).toContain('[DADO_REMOVIDO]');
    expect(sanitized).toContain('[CONTRATO]');
    expect(sanitized).not.toContain('99999-9999');
    expect(sanitized).not.toContain('maria@example.com');
  });

  it('builds a read-only JSON prompt without raw Meta payloads or attachments', () => {
    const prompt = buildAiQualityPrompt(context, 12000);

    expect(prompt).toContain('ai_quality_v1');
    expect(prompt).toContain('IA supervisora read-only');
    expect(prompt).toContain('Não converse com o cliente');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('[CLIENTE]');
    expect(prompt).toContain('[TELEFONE]');
    expect(prompt).toContain('[EMAIL]');
    expect(prompt).not.toContain('payload_json');
    expect(prompt).not.toContain('base64');
    expect(prompt).not.toContain('maria@example.com');
  });

  it('accepts valid structured JSON and rejects invalid JSON', () => {
    expect(parseAiQualityResult(JSON.stringify({
      summary: 'Atendimento resolvido.',
      resolution: 'resolved',
      sentiment: 'satisfied',
      flags: ['needs_training', 'unknown_flag'],
      recommendation: 'Registrar orientação para o técnico.',
    }))).toEqual({
      summary: 'Atendimento resolvido.',
      resolution: 'resolved',
      sentiment: 'satisfied',
      flags: ['needs_training'],
      recommendation: 'Registrar orientação para o técnico.',
    });

    expect(() => parseAiQualityResult('isso nao e json')).toThrow('AI_QUALITY_INVALID_JSON');
  });
});
