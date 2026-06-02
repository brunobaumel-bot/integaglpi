import { describe, expect, it, vi } from 'vitest';

import { CoachingService, ONBOARDING_TICKET_WINDOW } from '../src/domain/services/CoachingService.js';
import type { KbDraftPort, OnboardingStatusPort } from '../src/domain/services/CoachingService.js';

// CoachingService's constructor builds a repository from the executor; a no-op
// executor is enough since getChecklist/suggestKbArticle do not touch it.
const noopExecutor = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };

describe('CoachingService.getChecklist (onboarding, non-punitive)', () => {
  it('returns extra checklist + POPs for an onboarding tech within the first 30 tickets', async () => {
    const onboarding: OnboardingStatusPort = { getStatus: vi.fn(async () => ({ onboardingActive: true, ticketsHandled: 5 })) };
    const service = new CoachingService(noopExecutor as never, undefined, onboarding);

    const result = await service.getChecklist({ ticketId: 1, technicianId: 12 });

    expect(result.onboarding).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.pops.length).toBeGreaterThan(0);
  });

  it('returns empty once the technician passes the onboarding ticket window', async () => {
    const onboarding: OnboardingStatusPort = {
      getStatus: vi.fn(async () => ({ onboardingActive: true, ticketsHandled: ONBOARDING_TICKET_WINDOW })),
    };
    const service = new CoachingService(noopExecutor as never, undefined, onboarding);

    const result = await service.getChecklist({ ticketId: 1, technicianId: 12 });

    expect(result.onboarding).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.pops).toEqual([]);
  });

  it('returns empty when onboarding is not active', async () => {
    const onboarding: OnboardingStatusPort = { getStatus: vi.fn(async () => ({ onboardingActive: false, ticketsHandled: 2 })) };
    const service = new CoachingService(noopExecutor as never, undefined, onboarding);

    const result = await service.getChecklist({ ticketId: 1, technicianId: 12 });
    expect(result.onboarding).toBe(false);
  });

  it('returns empty (no crash) when no onboarding port or no technician id', async () => {
    const service = new CoachingService(noopExecutor as never);
    const r1 = await service.getChecklist({ ticketId: 1, technicianId: 12 });
    expect(r1.onboarding).toBe(false);

    const onboarding: OnboardingStatusPort = { getStatus: vi.fn() };
    const service2 = new CoachingService(noopExecutor as never, undefined, onboarding);
    const r2 = await service2.getChecklist({ ticketId: 1, technicianId: null });
    expect(r2.onboarding).toBe(false);
    expect(onboarding.getStatus).not.toHaveBeenCalled();
  });
});

describe('CoachingService.suggestKbArticle (post-resolution, manual review)', () => {
  it('returns a draft candidate for human review and never publishes', async () => {
    const kbDraft: KbDraftPort = {
      buildDraftFromTicket: vi.fn(async () => ({ title: 'Office não ativa', contentMarkdown: '# Office', confidenceScore: 55 })),
    };
    const service = new CoachingService(noopExecutor as never, undefined, undefined, kbDraft);

    const result = await service.suggestKbArticle(900);

    expect(result.ok).toBe(true);
    expect(result.candidate?.title).toBe('Office não ativa');
    expect(kbDraft.buildDraftFromTicket).toHaveBeenCalledWith(900);
  });

  it('returns not-ok when there is no reusable knowledge', async () => {
    const kbDraft: KbDraftPort = { buildDraftFromTicket: vi.fn(async () => null) };
    const service = new CoachingService(noopExecutor as never, undefined, undefined, kbDraft);

    const result = await service.suggestKbArticle(901);
    expect(result.ok).toBe(false);
    expect(result.candidate).toBeNull();
  });

  it('returns not-ok (no crash) when no draft port is configured', async () => {
    const service = new CoachingService(noopExecutor as never);
    const result = await service.suggestKbArticle(902);
    expect(result.ok).toBe(false);
  });
});
