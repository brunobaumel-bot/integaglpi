import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inboundService = readFileSync(
  resolve(repoRoot, 'src/domain/services/InboundWebhookService.ts'),
  'utf8',
);

describe('InboundWebhookService stale contact profile reset contract', () => {
  it('resets stale complete pre-ticket state when the persisted profile was removed', () => {
    expect(inboundService).toContain('mayCarryStaleProfileState');
    expect(inboundService).toContain("activeConversation.status === 'awaiting_entity_selection'");
    expect(inboundService).toContain("activeConversation.status === 'collecting_contact_profile' && activeProfileStep === 'complete'");
    expect(inboundService).toContain('missing_persisted_contact_profile');
    expect(inboundService).toContain('[integration-service][contact_profile][STALE_PROFILE_STATE_RESET]');
  });

  it('restarts controlled profile collection before advancing a stale completed conversation', () => {
    const staleResetOffset = inboundService.indexOf('const mayCarryStaleProfileState');
    const resetStatusOffset = inboundService.indexOf("'collecting_contact_profile',", staleResetOffset);
    const promptOffset = inboundService.indexOf('await this.sendContactProfilePrompt({', staleResetOffset);
    const advanceOffset = inboundService.indexOf('await this.advanceCompletedProfileConversation({', staleResetOffset);

    expect(staleResetOffset).toBeGreaterThanOrEqual(0);
    expect(resetStatusOffset).toBeGreaterThan(staleResetOffset);
    expect(promptOffset).toBeGreaterThan(resetStatusOffset);
    expect(advanceOffset).toBeGreaterThan(promptOffset);
  });
});
