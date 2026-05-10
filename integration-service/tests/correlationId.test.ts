import { describe, expect, it } from 'vitest';

import {
  createCorrelationId,
  getOrCreateCorrelationId,
  isGeneratedCorrelationId,
} from '../src/domain/services/correlationId.js';

describe('correlationId helpers', () => {
  it('createCorrelationId gera formato valido', () => {
    const correlationId = createCorrelationId(new Date('2026-05-10T15:30:22Z'));

    expect(correlationId).toMatch(/^WA-20260510153022-[a-f0-9]{6}$/);
    expect(isGeneratedCorrelationId(correlationId)).toBe(true);
  });

  it('createCorrelationId gera valores diferentes em chamadas consecutivas', () => {
    const first = createCorrelationId();
    const second = createCorrelationId();

    expect(first).not.toBe(second);
  });

  it('getOrCreateCorrelationId reutiliza valor existente', () => {
    expect(getOrCreateCorrelationId('  WA-20260510153022-a8f3c2  ')).toBe('WA-20260510153022-a8f3c2');
  });
});
