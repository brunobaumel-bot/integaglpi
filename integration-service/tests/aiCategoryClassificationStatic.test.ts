/**
 * Static contract tests for AI category classification.
 * All assertions are file-content checks — no HTTP calls, no DB, no Redis.
 *
 * PHASE: integaglpi_ai_category_classification_001
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const classifier = readFileSync('src/domain/services/GlpiCategoryClassifierService.ts', 'utf8');
const webhook = readFileSync('src/domain/services/InboundWebhookService.ts', 'utf8');
const envTs = readFileSync('src/config/env.ts', 'utf8');

describe('AI Category Classification contract', () => {
  // ── Feature flag ───────────────────────────────────────────────────────────

  it('AI_CATEGORY_CLASSIFICATION_ENABLED flag defaults to false', () => {
    expect(envTs).toContain('AI_CATEGORY_CLASSIFICATION_ENABLED');
    expect(envTs).toContain(".default('false')");
    expect(envTs).toContain("value === 'true'");
  });

  it('auto and confirm thresholds are configurable with safe defaults', () => {
    expect(envTs).toContain('AI_CATEGORY_CLASSIFICATION_AUTO_THRESHOLD');
    expect(envTs).toContain("'0.85'");
    expect(envTs).toContain('AI_CATEGORY_CLASSIFICATION_CONFIRM_THRESHOLD');
    expect(envTs).toContain("'0.55'");
  });

  it('flag off: webhook preserves legacy awaiting_queue_selection path', () => {
    // Flag guard: AI_CATEGORY_CLASSIFICATION_ENABLED must gate new flow.
    expect(webhook).toContain('AI_CATEGORY_CLASSIFICATION_ENABLED');
    expect(webhook).toContain('awaiting_queue_selection');
    expect(webhook).toContain('awaiting_problem_description');
    // When AI off, conversation created with awaiting_queue_selection.
    expect(webhook).toContain("'awaiting_queue_selection'");
  });

  // ── PII sanitization ───────────────────────────────────────────────────────

  it('classifier calls anonymizeAiPilotPayload before any AI call', () => {
    expect(classifier).toContain('anonymizeAiPilotPayload');
    expect(classifier).toContain('from \'../../privacy/anonymizeForAiPilot.js\'');
    expect(classifier).toContain('sanitized.text');
    // sanitizedText used for heuristic and AI
    expect(classifier).toContain('runHeuristic(sanitizedText');
    expect(classifier).toContain('callLocalAi(sanitizedText');
  });

  it('sanitizedText is used for AI call, not raw text', () => {
    expect(classifier).toContain('callLocalAi(sanitizedText');
    expect(classifier).not.toContain('callLocalAi(rawText');
  });

  // ── Cloud AI forbidden ─────────────────────────────────────────────────────

  it('no cloud AI provider references in classifier or webhook', () => {
    const combined = `${classifier}\n${webhook}`;
    expect(combined).not.toMatch(/openai|gemini|deepseek|anthropic/i);
    expect(combined).not.toContain('api.openai.com');
    expect(combined).not.toContain('generativelanguage.googleapis.com');
    // Must have explicit ai_cloud: false in audit payloads.
    expect(webhook).toContain('ai_cloud: false');
  });

  // ── Confidence rules ───────────────────────────────────────────────────────

  it('auto-apply threshold is >= autoThreshold (not requiresConfirmation, not fallback)', () => {
    expect(classifier).toContain('requiresConfirmation');
    expect(classifier).toContain('fallbackRequired');
    expect(classifier).toContain('autoThreshold');
    expect(classifier).toContain('confirmThreshold');
    // Logic: requiresConfirmation = confidence >= confirmThreshold && confidence < autoThreshold.
    expect(classifier).toContain('confidence >= this.confirmThreshold && confidence < this.autoThreshold');
  });

  it('low confidence triggers fallback (fallbackRequired=true when confidence < confirmThreshold)', () => {
    expect(classifier).toContain('confidence < this.confirmThreshold');
    expect(classifier).toContain('fallbackRequired');
  });

  it('medium confidence sets requiresConfirmation=true and sends 1-Sim 2-Não prompt', () => {
    expect(webhook).toContain('requiresConfirmation');
    expect(webhook).toContain('1 - Sim');
    expect(webhook).toContain('2 - Não');
    expect(webhook).toContain('awaiting_category_confirmation');
  });

  // ── Entity guard ───────────────────────────────────────────────────────────

  it('classifier returns fallback when entityId is 0 or missing', () => {
    expect(classifier).toContain('entity_missing');
    expect(classifier).toContain('entityId');
    expect(classifier).toContain('<= 0');
    expect(classifier).toContain("source: 'fallback'");
  });

  it('webhook requires entity before starting AI classification', () => {
    const aiBlock = webhook.slice(webhook.indexOf('awaiting_problem_description'), webhook.indexOf('awaiting_category_confirmation'));
    expect(aiBlock).toContain('classifierEntityId');
    expect(aiBlock).toContain('<= 0');
    // Without entity, must fall back to menu.
    expect(aiBlock).toContain('awaiting_queue_selection');
    expect(aiBlock).toContain('ai_fallback_no_entity');
  });

  // ── Manual menu preserved ──────────────────────────────────────────────────

  it('manual menu is still used for fallback (low confidence, rejection, entity missing)', () => {
    expect(webhook).toContain('awaiting_queue_selection');
    expect(webhook).toContain('sendRoutingMenu');
    expect(webhook).toContain('ai_low_confidence');
    expect(webhook).toContain('ai_category_rejected');
  });

  it('confirmation rejection (2) shows manual menu', () => {
    expect(webhook).toContain("parsed === 2");
    expect(webhook).toContain('CATEGORY_CLASSIFICATION_REJECTED');
    // After rejection: reset to awaiting_queue_selection and show menu
    expect(webhook).toContain("ai_category_rejected");
    expect(webhook).toContain("'awaiting_queue_selection'");
  });

  // ── Audit ──────────────────────────────────────────────────────────────────

  it('classification decision is audited with confidence, source and entity_id', () => {
    expect(webhook).toContain('CATEGORY_CLASSIFICATION_DECISION');
    expect(webhook).toContain('confidence');
    expect(webhook).toContain('classification_source');
    expect(webhook).toContain('entity_id');
    expect(webhook).toContain('CATEGORY_CLASSIFICATION_CONFIRMED');
    expect(webhook).toContain('CATEGORY_CLASSIFICATION_REJECTED');
  });

  it('audit uses existing recordAudit() — no new DB table', () => {
    // Must use recordAudit() (which calls auditService.recordAuditEventFireAndForget).
    expect(webhook).toContain('this.recordAudit(');
    // Must not attempt to create a new table or repository.
    expect(webhook).not.toContain('categoryClassificationRepository');
    expect(webhook).not.toContain('CREATE TABLE.*category_classification');
  });

  // ── Webhook safety ─────────────────────────────────────────────────────────

  it('IA failure never blocks webhook — try/catch with fallback', () => {
    // classify() must have try/catch.
    expect(classifier).toContain('try {');
    expect(classifier).toContain('} catch');
    // Webhook also catches classifier failure.
    const webhookClassify = webhook.slice(webhook.indexOf('await this.categoryClassifier.classify'), webhook.indexOf('await this.categoryClassifier.classify') + 500);
    expect(webhookClassify).toContain('catch');
    expect(webhookClassify).toContain('classResult = null');
  });

  it('classifier timeout is bounded to 10 s', () => {
    expect(classifier).toContain('LOCAL_AI_CLASSIFY_TIMEOUT_MS');
    expect(classifier).toContain('10_000');
    expect(classifier).toContain('Math.min');
  });

  // ── No auto-ticket / alarm ─────────────────────────────────────────────────

  it('no alarm engine or auto-ticket in classifier', () => {
    expect(classifier).not.toMatch(/auto_ticket\s*:\s*true/i);
    expect(classifier).not.toMatch(/alarm_engine/i);
    expect(classifier).not.toMatch(/createTicket|addTicket/i);
  });

  // ── MariaDB guard ──────────────────────────────────────────────────────────

  it('no direct MariaDB access in classifier', () => {
    expect(classifier).not.toMatch(/mysql|mariadb|knex|typeorm/i);
  });
});
