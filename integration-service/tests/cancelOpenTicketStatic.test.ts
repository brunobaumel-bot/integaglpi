import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

describe('open ticket cancellation guard', () => {
  it('handles customer cancellation before appending to an existing GLPI ticket', () => {
    const service = read('src/domain/services/InboundWebhookService.ts');

    expect(service).toContain('tryCancelOpenTicketFromInbound');
    expect(service).toContain('OPEN_TICKET_USER_CANCELLED_CONTENT');
    expect(service).toContain('OPEN_TICKET_CANCELLED_BY_USER');

    const decisionOffset = service.indexOf('[integration-service][inbound][DECISION]');
    const cancelOffset = service.indexOf('await this.tryCancelOpenTicketFromInbound');
    const appendOffset = service.indexOf("if (action === 'append')");

    expect(decisionOffset).toBeGreaterThan(0);
    expect(cancelOffset).toBeGreaterThan(decisionOffset);
    expect(appendOffset).toBeGreaterThan(cancelOffset);
  });

  it('closes the GLPI ticket before marking the conversation closed', () => {
    const service = read('src/domain/services/InboundWebhookService.ts');
    const helperStart = service.indexOf('private async tryCancelOpenTicketFromInbound');
    const helper = service.slice(helperStart, service.indexOf('private async handleInvalidPreTicketInput'));

    expect(helperStart).toBeGreaterThan(0);
    expect(helper).toContain('this.isPreTicketCancelText(input.inboundMessage.messageText)');
    expect(helper).toContain('this.glpiClient.updateTicketStatus(input.ticketId, GLPI_STATUS_CLOSED');
    expect(helper).toContain("this.conversationRepository.updateStatus(input.conversation.id, 'closed')");
    expect(helper.indexOf('this.glpiClient.updateTicketStatus')).toBeLessThan(
      helper.indexOf("this.conversationRepository.updateStatus(input.conversation.id, 'closed')"),
    );
    expect(helper).not.toContain('this.metaClient.sendTextMessage');
  });
});
