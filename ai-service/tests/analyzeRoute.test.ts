import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('POST /analyze', () => {
  it('returns a deterministic mock payload when AI_ENABLED=false', async () => {
    process.env.AI_ENABLED = 'false';
    process.env.AI_PROVIDER = 'openai';

    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).post('/analyze').send({
      text: 'Preciso de ajuda urgente no GLPI',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      shouldCreateTicket: true,
      title: 'Chamado via WhatsApp: Preciso de ajuda urg',
      description: 'Mensagem original: Preciso de ajuda urgente no GLPI',
      category: 'Suporte PoC',
      urgency: 3,
      analysis: 'Processado em modo Mock (Fase 2)',
    });
  });

  it('treats AI_PROVIDER as mock case-insensitively', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'MOCK';

    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).post('/analyze').send({ text: 'x' });

    expect(response.status).toBe(200);
    expect(response.body.analysis).toBe('Processado em modo Mock (Fase 2)');
  });

  it('returns the mock payload when AI_PROVIDER=mock even if AI_ENABLED=true', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'mock';

    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).post('/analyze/message').send({
      messageText: 'Mensagem de teste',
    });

    expect(response.status).toBe(200);
    expect(response.body.analysis).toBe('Processado em modo Mock (Fase 2)');
    expect(response.body.shouldCreateTicket).toBe(true);
  });

  it('returns 503 when mock is disabled and real provider is not implemented', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_PROVIDER = 'openai';

    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).post('/analyze').send({ text: 'hello' });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('ai_provider_unavailable');
  });

  it('uses safe fallbacks when the incoming text is empty', async () => {
    process.env.AI_ENABLED = 'false';
    process.env.AI_PROVIDER = 'mock';

    const { createApp } = await import('../src/app.js');
    const response = await request(createApp()).post('/analyze').send({
      text: '   ',
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      shouldCreateTicket: true,
      title: 'Chamado via WhatsApp: Mensagem sem texto',
      description: 'Mensagem original: a mensagem veio sem texto interpretável.',
      category: 'Suporte PoC',
      urgency: 3,
      analysis: 'Processado em modo Mock (Fase 2)',
    });
  });
});
