import { describe, expect, it, vi } from 'vitest';

import {
  ManualTicketWhatsappLinkError,
  ManualTicketWhatsappLinkService,
  type ManualTicketStartInput,
} from '../src/domain/services/ManualTicketWhatsappLinkService.js';
import type { OutboundMessageService } from '../src/domain/services/OutboundMessageService.js';
import type { PostgresManualTicketWhatsappRepository } from '../src/repositories/postgres/PostgresManualTicketWhatsappRepository.js';

function makeInput(overrides: Partial<ManualTicketStartInput> = {}): ManualTicketStartInput {
  return {
    ticketId: 123,
    requesterName: 'Bruno',
    requesterEmail: 'b@example.test',
    requesterPhones: ['+5541999999999'],
    phoneE164: '+5541999999999',
    glpiUserId: 7,
    templateName: 'aviso_atendimento_fora_janela',
    language: 'pt_BR',
    manualConfirmation: true,
    costAcknowledged: true,
    templateApproved: true,
    templateActive: true,
    ...overrides,
  };
}

function makeService(overrides: {
  conflict?: Record<string, unknown> | null;
  reusable?: Record<string, unknown> | null;
  lastInboundAt?: Date | null;
  outboundResult?: Awaited<ReturnType<OutboundMessageService['send']>>;
  ticketReader?: { getTicket: ReturnType<typeof vi.fn> };
} = {}) {
  const repo = {
    findOpenConflict: vi.fn().mockResolvedValue(overrides.conflict ?? null),
    findReusableConversation: vi.fn().mockResolvedValue(overrides.reusable ?? null),
    ensureContact: vi.fn().mockResolvedValue({ id: 'contact-1' }),
    markOrphanedTicketConversations: vi.fn().mockResolvedValue([{ id: 'conv-orphan', phone_e164: '+5541999999999' }]),
    createManualConversation: vi.fn().mockResolvedValue({
      id: 'conv-manual',
      phone_e164: '+5541999999999',
      contact_id: 'contact-1',
      glpi_ticket_id: 123,
      status: 'open',
      last_message_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    }),
    linkConversation: vi.fn().mockResolvedValue({
      id: 'conv-existing',
      phone_e164: '+5541999999999',
      contact_id: 'contact-1',
      glpi_ticket_id: 123,
      status: 'open',
      last_message_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    }),
    findLastInboundAt: vi.fn().mockResolvedValue(overrides.lastInboundAt ?? null),
    findProfiles: vi.fn().mockResolvedValue([]),
  } as unknown as PostgresManualTicketWhatsappRepository;
  const outbound = {
    send: vi.fn().mockResolvedValue(overrides.outboundResult ?? {
      httpStatus: 201,
      body: {
        status: 'sent',
        message_id: 'wamid.manual-template',
        conversation_id: 'conv-manual',
        postgres_message_row_id: 'row-1',
        idempotent: false,
      },
    }),
  } as unknown as OutboundMessageService;
  const ticketReader = overrides.ticketReader ?? {
    getTicket: vi.fn().mockResolvedValue({ status: 2, isDeleted: false }),
  };
  const service = new ManualTicketWhatsappLinkService(repo, outbound, null, null, ticketReader);

  return { service, repo, outbound, ticketReader };
}

describe('ManualTicketWhatsappLinkService', () => {
  it('creates a manual conversation and sends the approved start template with mapped variables', async () => {
    const { service, repo, outbound } = makeService();

    const result = await service.startTemplate(makeInput());

    expect(repo.createManualConversation).toHaveBeenCalledWith(expect.objectContaining({
      phoneE164: '+5541999999999',
      ticketId: 123,
      glpiUserId: 7,
    }));
    expect(outbound.send).toHaveBeenCalledWith(expect.objectContaining({
      ticket_id: 123,
      conversation_id: 'conv-manual',
      message_type: 'template',
      template_name: 'aviso_atendimento_fora_janela',
      template_parameters: ['Bruno', '123'],
    }), expect.any(Object));
    expect(result).toMatchObject({
      status: 'sent',
      conversation_id: 'conv-manual',
      message_id: 'wamid.manual-template',
      whatsapp_window: { is_open: false },
    });
  });

  it('blocks open conversations already linked to another ticket', async () => {
    const { service, outbound } = makeService({
      conflict: {
        id: 'conv-other',
        phone_e164: '+5541999999999',
        glpi_ticket_id: 999,
        status: 'open',
      },
    });

    await expect(service.startTemplate(makeInput())).rejects.toMatchObject({
      errorCode: 'OPEN_CONVERSATION_OTHER_TICKET',
    } satisfies Partial<ManualTicketWhatsappLinkError>);
    expect(outbound.send).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and cost acknowledgement', async () => {
    const { service, outbound } = makeService();

    await expect(service.startTemplate(makeInput({ costAcknowledged: false }))).rejects.toMatchObject({
      errorCode: 'MANUAL_CONFIRMATION_REQUIRED',
    } satisfies Partial<ManualTicketWhatsappLinkError>);
    expect(outbound.send).not.toHaveBeenCalled();
  });

  it('rejects invalid E.164 phones before creating or sending', async () => {
    const { service, repo, outbound } = makeService();

    await expect(service.startTemplate(makeInput({ phoneE164: '41999999999' }))).rejects.toMatchObject({
      errorCode: 'INVALID_PHONE_E164',
    } satisfies Partial<ManualTicketWhatsappLinkError>);
    expect(repo.createManualConversation).not.toHaveBeenCalled();
    expect(outbound.send).not.toHaveBeenCalled();
  });

  it('blocks start-template when the linked GLPI ticket is unavailable and never calls outbound', async () => {
    const { service, repo, outbound, ticketReader } = makeService({
      ticketReader: {
        getTicket: vi.fn().mockResolvedValue({ status: 2, isDeleted: true }),
      },
    });

    await expect(service.startTemplate(makeInput())).rejects.toMatchObject({
      errorCode: 'GLPI_TICKET_UNAVAILABLE',
    } satisfies Partial<ManualTicketWhatsappLinkError>);

    expect(ticketReader.getTicket).toHaveBeenCalledWith(123);
    expect(repo.markOrphanedTicketConversations).toHaveBeenCalledWith({
      ticketId: 123,
      reason: 'glpi_ticket_deleted',
    });
    expect(repo.createManualConversation).not.toHaveBeenCalled();
    expect(outbound.send).not.toHaveBeenCalled();
  });
});
