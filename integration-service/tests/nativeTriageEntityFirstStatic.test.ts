/**
 * Static audit: verifies that the entity-first invariant (Flow B strict) is enforced
 * in both GlpiItilCategoryNormalizer and InboundWebhookService.
 *
 * Key invariants checked:
 *   - GlpiItilCategoryNormalizer.getOptions() guards against null/0 entityId BEFORE cache/GLPI.
 *   - InboundWebhookService.resolveRoutingOptions() falls back to legacy catalog when entityId unknown.
 *   - Neither source contains a direct call to normalizer.getOptions() without entityId guard.
 *
 * PHASE: integaglpi_whatsapp_native_category_entity_first_flow_fix_001
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const normalizerPath = path.resolve(
  __dirname,
  '../src/adapters/glpi/GlpiItilCategoryNormalizer.ts',
);
const inboundPath = path.resolve(
  __dirname,
  '../src/domain/services/InboundWebhookService.ts',
);

const normalizerSrc = fs.readFileSync(normalizerPath, 'utf-8');
const inboundSrc = fs.readFileSync(inboundPath, 'utf-8');

describe('Flow B strict — GlpiItilCategoryNormalizer entity guard', () => {
  it('source contains "Flow B strict" comment documenting the invariant', () => {
    expect(normalizerSrc).toContain('Flow B strict');
  });

  it('source contains entityId <= 0 guard in getOptions()', () => {
    expect(normalizerSrc).toContain('entityId <= 0');
  });

  it('entity guard appears BEFORE cacheRepository.get() in getOptions()', () => {
    const getOptionsStart = normalizerSrc.indexOf('public async getOptions(');
    expect(getOptionsStart).toBeGreaterThan(-1);

    const guardIdx = normalizerSrc.indexOf('entityId <= 0', getOptionsStart);
    const cacheGetIdx = normalizerSrc.indexOf('cacheRepository.get', getOptionsStart);

    expect(guardIdx).toBeGreaterThan(-1);
    expect(cacheGetIdx).toBeGreaterThan(-1);
    // Guard must short-circuit before Redis is ever accessed
    expect(guardIdx).toBeLessThan(cacheGetIdx);
  });

  it('entity guard returns [] for invalid entityId (early return pattern)', () => {
    const getOptionsStart = normalizerSrc.indexOf('public async getOptions(');
    const guardIdx = normalizerSrc.indexOf('entityId <= 0', getOptionsStart);
    // Within ~5 lines of the guard, must have a return []
    const nearGuard = normalizerSrc.slice(guardIdx, guardIdx + 300);
    expect(nearGuard).toContain('return []');
  });

  it('no forbidden DB driver imports in normalizer source', () => {
    expect(normalizerSrc).not.toMatch(/^import\b.*\bfrom\b.*['"]mysql2['"]/im);
    expect(normalizerSrc).not.toMatch(/^import\b.*\bfrom\b.*['"]mariadb['"]/im);
    expect(normalizerSrc).not.toMatch(/^import\b.*\bfrom\b.*['"]knex['"]/im);
  });
});

describe('Flow B strict — InboundWebhookService.resolveRoutingOptions guard', () => {
  it('source contains "Flow B strict" comment documenting the invariant', () => {
    expect(inboundSrc).toContain('Flow B strict');
  });

  it('resolveRoutingOptions contains entityId guard before normalizer.getOptions()', () => {
    const resolveStart = inboundSrc.indexOf('private async resolveRoutingOptions(');
    expect(resolveStart).toBeGreaterThan(-1);

    const guardIdx = inboundSrc.indexOf('entityId <= 0', resolveStart);
    const normalizerCallIdx = inboundSrc.indexOf('normalizer.getOptions(', resolveStart);

    expect(guardIdx).toBeGreaterThan(-1);
    expect(normalizerCallIdx).toBeGreaterThan(-1);
    // Entity guard must come before the normalizer call
    expect(guardIdx).toBeLessThan(normalizerCallIdx);
  });

  it('resolveRoutingOptions falls back to routingRepository.getActiveOptions() when entityId is null/0', () => {
    const resolveStart = inboundSrc.indexOf('private async resolveRoutingOptions(');
    const resolveEnd = inboundSrc.indexOf('\n  private ', resolveStart + 1);
    const resolveRoutingFn = resolveEnd > resolveStart
      ? inboundSrc.slice(resolveStart, resolveEnd)
      : inboundSrc.slice(resolveStart, resolveStart + 600);

    // Must have the entity guard fallback to legacy options
    expect(resolveRoutingFn).toContain('entityId === null');
    expect(resolveRoutingFn).toContain('entityId <= 0');
    expect(resolveRoutingFn).toContain('getActiveOptions()');
    // Must call normalizer.getOptions only with valid entityId (after the guard)
    expect(resolveRoutingFn).toContain('normalizer.getOptions(entityId)');
  });

  it('NATIVE_GLPI_TRIAGE_ENABLED flag off preserves legacy behavior (resolveRoutingOptions without normalizer)', () => {
    // When normalizer is null (flag off), the function must still call getActiveOptions()
    const resolveStart = inboundSrc.indexOf('private async resolveRoutingOptions(');
    const resolveEnd = inboundSrc.indexOf('\n  private ', resolveStart + 1);
    const resolveRoutingFn = resolveEnd > resolveStart
      ? inboundSrc.slice(resolveStart, resolveEnd)
      : inboundSrc.slice(resolveStart, resolveStart + 600);

    // The function must have a final getActiveOptions() fallback for when normalizer is null
    const lastGetActive = resolveRoutingFn.lastIndexOf('getActiveOptions()');
    const normalizerIf = resolveRoutingFn.indexOf('if (normalizer)');
    expect(lastGetActive).toBeGreaterThan(normalizerIf);
  });
});

describe('Flow B strict — cross-file consistency', () => {
  it('both source files document "Flow B strict" invariant', () => {
    expect(normalizerSrc).toContain('Flow B strict');
    expect(inboundSrc).toContain('Flow B strict');
  });

  it('RoutingRepository contract has glpiFormId optional field (for Forms triage)', () => {
    const routingPath = path.resolve(
      __dirname,
      '../src/repositories/contracts/RoutingRepository.ts',
    );
    const routingSrc = fs.readFileSync(routingPath, 'utf-8');
    expect(routingSrc).toContain('glpiFormId');
  });

  it('glpiTypes.ts has glpiFormId in CreateGlpiTicketInput', () => {
    const typesPath = path.resolve(__dirname, '../src/adapters/glpi/glpiTypes.ts');
    const typesSrc = fs.readFileSync(typesPath, 'utf-8');
    expect(typesSrc).toContain('glpiFormId');
  });
});
