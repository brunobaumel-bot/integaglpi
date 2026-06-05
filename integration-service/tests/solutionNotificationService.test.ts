import { describe, expect, it, vi } from 'vitest';

import { OutboundMessageService } from '../src/domain/services/OutboundMessageService.js';
import type { AuditService } from '../src/domain/services/AuditService.js';
import type { Conversation } from '../src/domain/entities/Conversation.js';

const conversation: Conversation = {
  id: 'c42dd866-4569-44a7-86f2-d7d4869256bd',
  phoneE164: '+5511999999999',
  contactId: 'contact-1',
  glpiTicketId: 2112319051,
  queueId: 5,
  status: 'closed',
  lastMessageAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(metaOverrides: Record<string, unknown> = {}, audit?: AuditService, messageConfigurationService: unknown = null) {
  const conversationRepository = {
    findByIdAndGlpiTicketId: vi.fn().mockResolvedValue(conversation),
    touch: vi.fn().mockResolvedValue(undefined),
  };
  const messageRepository = {
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    insertOutbound: vi.fn().mockResolvedValue({ id: 'row-1', messageId: 'wamid.solution' }),
  };
  const metaClient = {
    sendReplyButtons: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.solution' }] }),
    sendTextMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.text' }] }),
    ...metaOverrides,
  };
  const service = new OutboundMessageService(
    conversationRepository as never,
    messageRepository as never,
    metaClient as never,
    'real',
    '5511300000000',
    audit ?? null,
    null,
    messageConfigurationService as never,
  );

  return { service, conversationRepository, messageRepository, metaClient };
}

describe('OutboundMessageService solution approval notification', () => {
  const approveReopenButtons = [
    {
      id: `solution_approve:2112319051:${conversation.id}`,
      title: 'Aprovar',
    },
    {
      id: `solution_reopen:2112319051:${conversation.id}`,
      title: 'Reabrir',
    },
  ];

  it('sends solved notification with approval/reopen buttons', async () => {
    const { service, metaClient, messageRepository } = makeService();

    const result = await service.sendSolutionApprovalRequest({
      ticket_id: 2112319051,
      conversation_id: conversation.id,
      glpi_user_id: 1,
      idempotency_key: 'notify_ticket_solved_2112319051_77',
      solution_id: 77,
      solution_status: 2,
      solution_content: '<p>Troca de senha realizada &amp; acesso validado.</p><script>alert(1)</script>',
    });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.sendReplyButtons).toHaveBeenCalledWith(
      '5511999999999',
      [
        'Seu chamado #2112319051 foi solucionado.',
        '',
        'Solução:',
        'Troca de senha realizada & acesso validado.',
        '',
        'A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.',
      ].join('\n'),
      approveReopenButtons,
    );
    expect(messageRepository.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'notify_ticket_solved_2112319051_77',
        messageText: [
          'Seu chamado #2112319051 foi solucionado.',
          '',
          'Solução:',
          'Troca de senha realizada & acesso validado.',
          '',
          'A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.',
        ].join('\n'),
        rawPayload: expect.objectContaining({
          ticket_id: 2112319051,
          solution_id: 77,
          solution_status: 2,
          request: expect.objectContaining({
            body_text_preview: [
              'Seu chamado #2112319051 foi solucionado.',
              '',
            'Solução:',
            'Troca de senha realizada & acesso validado.',
            '',
            'A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.',
          ].join('\n'),
            has_solution_content: true,
          }),
        }),
      }),
    );
  });

  it('records MESSAGE_SENT audit event for solved notification', async () => {
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const { service } = makeService({}, audit);

    await service.sendSolutionApprovalRequest(
      {
        ticket_id: 2112319051,
        conversation_id: conversation.id,
        glpi_user_id: 1,
        idempotency_key: 'notify_ticket_solved_2112319051_77',
      },
      { correlationId: 'WA-20260510153022-a8f3c2' },
    );

    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'WA-20260510153022-a8f3c2',
        ticketId: 2112319051,
        conversationId: conversation.id,
        messageId: 'wamid.solution',
        eventType: 'TICKET_CLOSED',
        status: 'success',
      }),
    );
  });

  it('falls back to textual solved notification when interactive send fails', async () => {
    const { service, metaClient } = makeService({
      sendReplyButtons: vi.fn().mockRejectedValue(new Error('Meta buttons unavailable')),
    });

    const result = await service.sendSolutionApprovalRequest({
      ticket_id: 2112319051,
      conversation_id: conversation.id,
      glpi_user_id: 1,
      idempotency_key: 'notify_ticket_solved_2112319051',
      solution_content: '<div>Foi aplicado ajuste no cadastro.</div>',
    });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.sendTextMessage).toHaveBeenCalledWith({
      to: '5511999999999',
      body: [
        'Seu chamado #2112319051 foi solucionado.',
        '',
        'Solução:',
        'Foi aplicado ajuste no cadastro.',
        '',
        'A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.',
      ].join('\n'),
    });
  });

  it('sanitizes HTML entities and removes script/style blocks from solution content', async () => {
    const { service, metaClient, messageRepository } = makeService();

    const result = await service.sendSolutionApprovalRequest({
      ticket_id: 2112319051,
      conversation_id: conversation.id,
      glpi_user_id: 1,
      idempotency_key: 'notify_ticket_solved_2112319051_78',
      solution_id: 78,
      solution_status: 2,
      solution_content: [
        '<style>.x{display:none}</style>',
        '<p>Primeira linha&nbsp;&amp; validação</p>',
        '<script>alert("x")</script>',
        '<div>Segunda &lt;linha&gt;</div>',
      ].join(''),
    });

    const expectedText = [
      'Seu chamado #2112319051 foi solucionado.',
      '',
      'Solução:',
      'Primeira linha & validação',
      'Segunda <linha>',
      '',
      'A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.',
    ].join('\n');

    expect(result.httpStatus).toBe(201);
    expect(metaClient.sendReplyButtons).toHaveBeenCalledWith(
      '5511999999999',
      expectedText,
      approveReopenButtons,
    );
    expect(messageRepository.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        messageText: expectedText,
        idempotencyKey: 'notify_ticket_solved_2112319051_78',
        rawPayload: expect.objectContaining({
          request: expect.objectContaining({
            body_text_preview: expectedText,
            has_solution_content: true,
          }),
        }),
      }),
    );
  });

  it('uses solution id idempotency key to avoid duplicate solved notification', async () => {
    const { service, metaClient, messageRepository } = makeService();
    messageRepository.findByIdempotencyKey.mockResolvedValue({
      id: 'row-existing',
      messageId: 'wamid.existing',
      conversationId: conversation.id,
    });

    const result = await service.sendSolutionApprovalRequest({
      ticket_id: 2112319051,
      conversation_id: conversation.id,
      glpi_user_id: 1,
      idempotency_key: 'notify_ticket_solved_2112319051_77',
      solution_id: 77,
      solution_content: 'Solução já enviada.',
    });

    expect(result.body).toEqual({
      status: 'sent',
      message_id: 'wamid.existing',
      conversation_id: conversation.id,
      postgres_message_row_id: 'row-existing',
      idempotent: true,
    });
    expect(metaClient.sendReplyButtons).not.toHaveBeenCalled();
  });

  it('keeps fallback solved notification format when solution content is missing', async () => {
    const { service, metaClient, messageRepository } = makeService();

    const result = await service.sendSolutionApprovalRequest({
      ticket_id: 2112319051,
      conversation_id: conversation.id,
      glpi_user_id: 1,
      idempotency_key: 'notify_ticket_solved_2112319051',
    });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.sendReplyButtons).toHaveBeenCalledWith(
      '5511999999999',
      'Seu chamado #2112319051 foi solucionado. A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.',
      approveReopenButtons,
    );
    expect(messageRepository.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'notify_ticket_solved_2112319051',
        rawPayload: expect.objectContaining({
          request: expect.objectContaining({
            body_text_preview: 'Seu chamado #2112319051 foi solucionado. A solução atendeu sua necessidade? Toque no botão ou digite: 1 - Aprovar, 2 - Reabrir.',
            has_solution_content: false,
          }),
        }),
      }),
    );
  });

  it('uses configured approval prompt and button titles when available', async () => {
    const messageConfigurationService = {
      resolveSendPlan: vi.fn().mockResolvedValue({
        eventKey: 'solution_approve_reopen_prompt',
        sendType: 'interactive_buttons',
        text: 'Chamado #{ticket_id} resolvido. Confirma?',
        active: true,
        shouldSend: true,
        reason: null,
        templateName: null,
        language: 'pt_BR',
        buttons: [
          { id: 'ignored-approve-id', title: 'Aprovar solução' },
          { id: 'ignored-reopen-id', title: 'Reabrir chamado' },
        ],
        listOptions: [],
      }),
    };
    const { service, metaClient } = makeService({}, undefined, messageConfigurationService);

    const result = await service.sendSolutionApprovalRequest({
      ticket_id: 2112319051,
      conversation_id: conversation.id,
      glpi_user_id: 1,
      idempotency_key: 'notify_ticket_solved_2112319051_configured',
    });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.sendReplyButtons).toHaveBeenCalledWith(
      '5511999999999',
      'Chamado 2112319051 resolvido. Confirma?',
      [
        { id: `solution_approve:2112319051:${conversation.id}`, title: 'Aprovar solução' },
        { id: `solution_reopen:2112319051:${conversation.id}`, title: 'Reabrir chamado' },
      ],
    );
  });
});
