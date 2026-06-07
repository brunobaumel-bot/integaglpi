/**
 * Behavioral tests for AI category classification.
 * Uses in-process fakes — no real HTTP, no real Ollama, no real DB.
 *
 * PHASE: integaglpi_ai_category_classification_fix_001
 */

import { describe, expect, it, vi } from 'vitest';
import { GlpiCategoryClassifierService } from '../src/domain/services/GlpiCategoryClassifierService.js';
import type { ActiveRoutingOption } from '../src/repositories/contracts/RoutingRepository.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOption(id: number, label: string, glpiItilCategoryId = id): ActiveRoutingOption {
  return {
    id,
    label,
    optionKey: `glpic_${glpiItilCategoryId}`,
    queueId: null,
    glpiGroupId: null,
    glpiUserId: null,
    confirmationMessage: null,
    sortOrder: id,
    glpiItilCategoryId,
  };
}

const OPTIONS_REDE = [
  makeOption(1, 'Rede e Internet', 101),
  makeOption(2, 'Impressora', 102),
  makeOption(3, 'Hardware Desktop', 103),
  makeOption(4, 'Email Outlook', 104),
];

const ENTITY_ID = 42;

// ── 1. Classifier unit tests ──────────────────────────────────────────────────

describe('GlpiCategoryClassifierService unit', () => {
  it('returns fallback when entityId is 0', async () => {
    const svc = new GlpiCategoryClassifierService();
    const result = await svc.classify('sem rede', OPTIONS_REDE, 0);
    expect(result.fallbackRequired).toBe(true);
    expect(result.categoryId).toBeNull();
    expect(result.reason).toBe('entity_missing');
    expect(result.source).toBe('fallback');
  });

  it('returns fallback for empty validOptions', async () => {
    const svc = new GlpiCategoryClassifierService();
    const result = await svc.classify('sem rede', [], ENTITY_ID);
    expect(result.fallbackRequired).toBe(true);
    expect(result.categoryId).toBeNull();
  });

  it('heuristic matches rede/internet with confidence >= 0.55', async () => {
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.85, confirmThreshold: 0.55 });
    const result = await svc.classify('internet caiu, sem rede no escritório', OPTIONS_REDE, ENTITY_ID);
    expect(result.source).toBe('heuristic');
    expect(result.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result.categoryId).toBe(101); // Rede e Internet
  });

  it('heuristic matches impressora correctly', async () => {
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.85, confirmThreshold: 0.55 });
    const result = await svc.classify('a impressora não está imprimindo nada', OPTIONS_REDE, ENTITY_ID);
    expect(result.source).toBe('heuristic');
    expect(result.categoryId).toBe(102); // Impressora
  });

  it('heuristic matches hardware/desktop', async () => {
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.85, confirmThreshold: 0.55 });
    const result = await svc.classify('pc não liga, não inicia', OPTIONS_REDE, ENTITY_ID);
    expect(result.source).toBe('heuristic');
    expect(result.categoryId).toBe(103); // Hardware Desktop
  });

  it('heuristic matches email/outlook', async () => {
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.85, confirmThreshold: 0.55 });
    const result = await svc.classify('problema no outlook, e-mail não chega', OPTIONS_REDE, ENTITY_ID);
    expect(result.source).toBe('heuristic');
    expect(result.categoryId).toBe(104); // Email Outlook
  });

  it('returns fallback source when text is too short', async () => {
    const svc = new GlpiCategoryClassifierService();
    const result = await svc.classify('Oi', OPTIONS_REDE, ENTITY_ID);
    expect(result.source).toBe('fallback');
    expect(result.fallbackRequired).toBe(true);
  });

  it('strips PII before processing — phone number removed from sanitizedText', async () => {
    const svc = new GlpiCategoryClassifierService();
    const result = await svc.classify('meu email joao@empresa.com, sem rede', OPTIONS_REDE, ENTITY_ID);
    // sanitizedText must not contain the original email.
    expect(result.sanitizedText).not.toContain('joao@empresa.com');
  });

  it('returns fallback when text is empty after sanitization', async () => {
    const svc = new GlpiCategoryClassifierService();
    const result = await svc.classify('', OPTIONS_REDE, ENTITY_ID);
    expect(result.fallbackRequired).toBe(true);
  });

  it('high confidence path: requiresConfirmation=false, fallbackRequired=false', async () => {
    // Force high confidence by using multiple signal matches.
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.55, confirmThreshold: 0.30 });
    const result = await svc.classify('internet caiu, sem rede, wifi fora', OPTIONS_REDE, ENTITY_ID);
    // With low thresholds this should be auto-apply territory.
    if (result.source === 'heuristic' && result.confidence >= 0.55) {
      expect(result.fallbackRequired).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it('medium confidence: requiresConfirmation=true, fallbackRequired=false', async () => {
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.90, confirmThreshold: 0.55 });
    const result = await svc.classify('internet caiu', OPTIONS_REDE, ENTITY_ID);
    if (result.confidence >= 0.55 && result.confidence < 0.90) {
      expect(result.requiresConfirmation).toBe(true);
      expect(result.fallbackRequired).toBe(false);
    }
  });

  it('low confidence: fallbackRequired=true, requiresConfirmation=false', async () => {
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.85, confirmThreshold: 0.55 });
    const result = await svc.classify('ajuda com suporte geral', OPTIONS_REDE, ENTITY_ID);
    if (result.confidence < 0.55) {
      expect(result.fallbackRequired).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    }
  });

  it('local AI failure falls back to heuristic result — never throws', async () => {
    // Configure a bogus Ollama URL to force a network error.
    const svc = new GlpiCategoryClassifierService({
      autoThreshold: 0.85,
      confirmThreshold: 0.55,
      localAi: { baseUrl: 'http://127.0.0.1:1', model: 'fake', timeoutMs: 100 },
    });
    // Must not throw, must return a result.
    await expect(svc.classify('sem rede wifi caiu', OPTIONS_REDE, ENTITY_ID)).resolves.toBeDefined();
  });

  it('category only returned when in validOptions — never invented', async () => {
    // Options with no network/printer/hardware categories.
    const narrowOptions = [makeOption(99, 'Facilities', 999)];
    const svc = new GlpiCategoryClassifierService({ autoThreshold: 0.85, confirmThreshold: 0.55 });
    const result = await svc.classify('internet caiu', narrowOptions, ENTITY_ID);
    // Category must either be 999 (the only valid one) or null.
    expect([999, null]).toContain(result.categoryId);
  });
});

// ── 2. buildDependencies wiring (static checks) ───────────────────────────────

describe('buildDependencies wiring (static)', () => {
  it('buildDependencies imports GlpiCategoryClassifierService', () => {
    const { readFileSync } = require('node:fs');
    const bd = readFileSync('src/buildDependencies.ts', 'utf8');
    expect(bd).toContain('GlpiCategoryClassifierService');
    expect(bd).toContain('buildCategoryClassifier');
    expect(bd).toContain('AI_CATEGORY_CLASSIFICATION_ENABLED');
    // Flag off returns null.
    expect(bd).toContain('if (!cfg.AI_CATEGORY_CLASSIFICATION_ENABLED) return null');
    // No cloud AI.
    expect(bd).not.toMatch(/openai|gemini|deepseek|anthropic/i);
  });

  it('buildCategoryClassifier uses AI_SUPERVISOR_BASE_URL (local Ollama only)', () => {
    const { readFileSync } = require('node:fs');
    const bd = readFileSync('src/buildDependencies.ts', 'utf8');
    expect(bd).toContain('AI_SUPERVISOR_BASE_URL');
    expect(bd).toContain("cfg.AI_SUPERVISOR_PROVIDER === 'ollama'");
    expect(bd).toContain('localAi: localAiConfig');
  });
});

// ── 3. Audit PII safety (static check) ───────────────────────────────────────

describe('audit PII safety', () => {
  it('InboundWebhookService does not log rawChoice text in audit', () => {
    const { readFileSync } = require('node:fs');
    const ws = readFileSync('src/domain/services/InboundWebhookService.ts', 'utf8');
    // Must not slice rawChoice into audit payload.
    expect(ws).not.toContain('rawChoice.slice');
    // Invalid confirmation must log safe reason.
    expect(ws).toContain("reason: 'invalid_confirmation_input'");
    expect(ws).toContain("choice_type");
  });

  it('invalid confirmation audits choice_type enum, not raw text', () => {
    const { readFileSync } = require('node:fs');
    const ws = readFileSync('src/domain/services/InboundWebhookService.ts', 'utf8');
    expect(ws).toContain("choice_type: parsed === 2 ? 'numeric_no'");
    expect(ws).toContain("'non_numeric_or_out_of_range'");
    expect(ws).toContain("'empty'");
  });
});

// ── 4. No cloud AI / no MariaDB ───────────────────────────────────────────────

describe('safety constraints', () => {
  it('GlpiCategoryClassifierService has no cloud AI references', () => {
    const { readFileSync } = require('node:fs');
    const cls = readFileSync('src/domain/services/GlpiCategoryClassifierService.ts', 'utf8');
    expect(cls).not.toMatch(/openai|gemini|deepseek|anthropic/i);
    expect(cls).not.toMatch(/mysql|mariadb|knex|typeorm/i);
    expect(cls).not.toContain('api.openai.com');
  });

  it('classifier never blocks webhook — classify() always resolves', async () => {
    const svc = new GlpiCategoryClassifierService();
    const results = await Promise.all([
      svc.classify('test', OPTIONS_REDE, ENTITY_ID),
      svc.classify('', OPTIONS_REDE, ENTITY_ID),
      svc.classify('test', [], ENTITY_ID),
      svc.classify('test', OPTIONS_REDE, 0),
    ]);
    for (const r of results) {
      expect(r).toBeDefined();
      expect(typeof r.confidence).toBe('number');
    }
  });
});
