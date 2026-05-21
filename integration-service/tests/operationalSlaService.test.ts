import { describe, expect, it } from 'vitest';

import {
  addWaitingCustomerTime,
  calculateSlaDeadlines,
  calculateSlaStatus,
  incrementReopenCount,
} from '../src/domain/services/OperationalSlaService.js';

const startedAt = new Date('2026-05-21T12:00:00.000Z');

describe('OperationalSlaService', () => {
  it('calculates persisted response and solution deadlines', () => {
    const deadlines = calculateSlaDeadlines(
      { responseMinutes: 15, solutionMinutes: 60 },
      { startedAt, accumulatedPausedMinutes: 10 },
    );

    expect(deadlines.responseDeadline?.toISOString()).toBe('2026-05-21T12:15:00.000Z');
    expect(deadlines.solutionDeadline?.toISOString()).toBe('2026-05-21T13:10:00.000Z');
  });

  it('returns visual status thresholds without blocking the workflow', () => {
    const status = calculateSlaStatus(
      { responseMinutes: 100, solutionMinutes: 100 },
      { startedAt, now: new Date('2026-05-21T13:30:00.000Z') },
    );

    expect(status.response.status).toBe('critical');
    expect(status.response.breached).toBe(false);

    const breached = calculateSlaStatus(
      { responseMinutes: 10, solutionMinutes: 10 },
      { startedAt, now: new Date('2026-05-21T12:11:00.000Z') },
    );
    expect(breached.solution.status).toBe('breached');
    expect(breached.solution.breached).toBe(true);
  });

  it('reports unconfigured SLA honestly when no deadline can be calculated', () => {
    const status = calculateSlaStatus(
      { responseMinutes: null, solutionMinutes: null },
      { startedAt, now: new Date('2026-05-21T12:05:00.000Z') },
    );

    expect(status.response.status).toBe('not_configured');
    expect(status.solution.status).toBe('not_configured');
    expect(status.response.deadline).toBeNull();
    expect(status.solution.deadline).toBeNull();
  });

  it('accumulates waiting-customer time and increments reopen count without deleting history', () => {
    expect(addWaitingCustomerTime(
      5,
      new Date('2026-05-21T12:00:00.000Z'),
      new Date('2026-05-21T12:20:30.000Z'),
    )).toBe(25);
    expect(incrementReopenCount(2)).toBe(3);
  });
});
