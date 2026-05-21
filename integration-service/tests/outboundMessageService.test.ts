import { describe, expect, it, vi } from 'vitest';

import type { Conversation } from '../src/domain/entities/Conversation.js';
import { OutboundMessageService } from '../src/domain/services/OutboundMessageService.js';
import type { AuditService } from '../src/domain/services/AuditService.js';
import type { ConversationRepository } from '../src/repositories/contracts/ConversationRepository.js';
import type { InactivityTrackingRepository } from '../src/repositories/contracts/InactivityTrackingRepository.js';
import type { InsertOutboundMessageInput, MessageRepository } from '../src/repositories/contracts/MessageRepository.js';

const PDF_BUFFER = Buffer.from('%PDF-1.4\n');
const OGG_BUFFER = Buffer.from('OggS\x00audio');
const MP3_BUFFER = Buffer.from('ID3\x03\x00');
const MP4_BUFFER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const M4A_BUFFER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const AAC_BUFFER = Buffer.from([0xff, 0xf1, 0x50, 0x80]);
const WEBM_BUFFER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]);
const THREE_GP_BUFFER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x70, 0x35]);

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    phoneE164: '+5541999999999',
    contactId: 'contact-1',
    glpiTicketId: 123,
    queueId: 3,
    status: 'open',
    lastMessageAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepositories(conversation: Conversation | null = makeConversation()) {
  const insertedMessages: InsertOutboundMessageInput[] = [];
  const conversationRepository = {
    findByIdAndGlpiTicketId: vi.fn().mockResolvedValue(conversation),
    touch: vi.fn().mockResolvedValue(undefined),
  } as unknown as ConversationRepository;
  const messageRepository = {
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    insertOutbound: vi.fn(async (input: InsertOutboundMessageInput) => {
      insertedMessages.push(input);
      return { id: `row-${insertedMessages.length}`, messageId: input.messageId };
    }),
  } as unknown as MessageRepository;

  return { conversationRepository, messageRepository, insertedMessages };
}

describe('OutboundMessageService media outbound', () => {
  it('uploads and sends PDF documents through Meta without storing base64 in raw payload', async () => {
    const { conversationRepository, messageRepository, insertedMessages } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn().mockResolvedValue('uploaded-media-id'),
      sendDocumentMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.document' }] }),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );
    const contentBase64 = PDF_BUFFER.toString('base64');

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Anexo do chamado #123: relatorio.pdf.',
      message_type: 'document',
      glpi_user_id: 7,
      idempotency_key: 'notify_document_1_55',
      media: {
        document_id: 55,
        filename: 'relatorio.pdf',
        mime_type: 'application/pdf',
        content_base64: contentBase64,
      },
    }, { correlationId: 'WA-test-document' });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.uploadMedia).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'relatorio.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_BUFFER,
    }));
    expect(metaClient.sendDocumentMessage).toHaveBeenCalledWith({
      to: '5541999999999',
      mediaId: 'uploaded-media-id',
      filename: 'relatorio.pdf',
      caption: 'Anexo do chamado #123: relatorio.pdf.',
    });
    expect(insertedMessages[0]).toMatchObject({
      messageId: 'wamid.document',
      conversationId: 'conv-1',
      messageType: 'document',
      mediaInfo: expect.objectContaining({
        filename: 'relatorio.pdf',
        mime_type: 'application/pdf',
        document_id: 55,
      }),
    });
    expect(JSON.stringify(insertedMessages[0]?.rawPayload)).not.toContain(contentBase64);
  });

  it('uploads and sends audio media through Meta as audio', async () => {
    const { conversationRepository, messageRepository, insertedMessages } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn().mockResolvedValue('uploaded-audio-id'),
      sendAudioMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.audio' }] }),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendVideoMessage: vi.fn(),
      sendTextMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );
    const contentBase64 = OGG_BUFFER.toString('base64');

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Audio do chamado #123.',
      message_type: 'audio',
      glpi_user_id: 7,
      media: {
        document_id: 56,
        filename: 'audio.ogg',
        mime_type: 'audio/ogg',
        content_base64: contentBase64,
      },
    }, { correlationId: 'WA-test-audio' });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.uploadMedia).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'audio.ogg',
      mimeType: 'audio/ogg',
      buffer: OGG_BUFFER,
    }));
    expect(metaClient.sendAudioMessage).toHaveBeenCalledWith({
      to: '5541999999999',
      mediaId: 'uploaded-audio-id',
    });
    expect(metaClient.sendDocumentMessage).not.toHaveBeenCalled();
    expect(insertedMessages[0]).toMatchObject({
      messageId: 'wamid.audio',
      messageType: 'audio',
      mediaInfo: expect.objectContaining({
        message_type: 'audio',
        mime_type: 'audio/ogg',
        document_id: 56,
      }),
    });
    expect(JSON.stringify(insertedMessages[0]?.rawPayload)).not.toContain(contentBase64);
  });

  it.each([
    ['audio/mpeg', 'audio.mp3', MP3_BUFFER],
    ['audio/mp4', 'audio.m4a', M4A_BUFFER],
    ['audio/aac', 'audio.aac', AAC_BUFFER],
    ['audio/webm', 'audio.webm', WEBM_BUFFER],
  ])('accepts outbound %s as audio', async (mimeType, filename, buffer) => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn().mockResolvedValue('uploaded-audio-id'),
      sendAudioMessage: vi.fn().mockResolvedValue({ messages: [{ id: `wamid.${mimeType}` }] }),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendVideoMessage: vi.fn(),
      sendTextMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Audio do chamado #123.',
      message_type: 'audio',
      glpi_user_id: 7,
      media: {
        filename,
        mime_type: mimeType,
        content_base64: buffer.toString('base64'),
      },
    }, { correlationId: `WA-test-${mimeType}` });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ mimeType }));
    expect(metaClient.sendAudioMessage).toHaveBeenCalled();
    expect(metaClient.sendDocumentMessage).not.toHaveBeenCalled();
  });

  it('uploads and sends video media through Meta as video', async () => {
    const { conversationRepository, messageRepository, insertedMessages } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn().mockResolvedValue('uploaded-video-id'),
      sendAudioMessage: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendVideoMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.video' }] }),
      sendTextMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Video do chamado #123.',
      message_type: 'video',
      glpi_user_id: 7,
      media: {
        document_id: 57,
        filename: 'video.3gp',
        mime_type: 'video/3gpp',
        content_base64: THREE_GP_BUFFER.toString('base64'),
      },
    }, { correlationId: 'WA-test-video' });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.uploadMedia).toHaveBeenCalledWith(expect.objectContaining({
      filename: 'video.3gp',
      mimeType: 'video/3gpp',
    }));
    expect(metaClient.sendVideoMessage).toHaveBeenCalledWith({
      to: '5541999999999',
      mediaId: 'uploaded-video-id',
      caption: 'Video do chamado #123.',
    });
    expect(metaClient.sendDocumentMessage).not.toHaveBeenCalled();
    expect(insertedMessages[0]).toMatchObject({
      messageId: 'wamid.video',
      messageType: 'video',
      mediaInfo: expect.objectContaining({
        message_type: 'video',
        mime_type: 'video/3gpp',
        document_id: 57,
      }),
    });
  });

  it('accepts outbound video/mp4 as video', async () => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn().mockResolvedValue('uploaded-video-id'),
      sendAudioMessage: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendVideoMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.video.mp4' }] }),
      sendTextMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Video do chamado #123.',
      message_type: 'video',
      glpi_user_id: 7,
      media: {
        filename: 'video.mp4',
        mime_type: 'video/mp4',
        content_base64: MP4_BUFFER.toString('base64'),
      },
    }, { correlationId: 'WA-test-video-mp4' });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'video/mp4' }));
    expect(metaClient.sendVideoMessage).toHaveBeenCalled();
    expect(metaClient.sendDocumentMessage).not.toHaveBeenCalled();
  });

  it('rejects oversized audio without calling Meta', async () => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn(),
      sendAudioMessage: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendVideoMessage: vi.fn(),
      sendTextMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Audio grande.',
      message_type: 'audio',
      glpi_user_id: 7,
      media: {
        filename: 'audio.ogg',
        mime_type: 'audio/ogg',
        content_base64: Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64'),
      },
    }, { correlationId: 'WA-test-large-audio' });

    expect(result).toMatchObject({
      httpStatus: 400,
      body: {
        status: 'failed',
        error_code: 'MEDIA_SIZE_INVALID',
      },
    });
    expect(metaClient.uploadMedia).not.toHaveBeenCalled();
    expect(messageRepository.insertOutbound).not.toHaveBeenCalled();
  });

  it('rejects oversized video without calling Meta', async () => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn(),
      sendAudioMessage: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendVideoMessage: vi.fn(),
      sendTextMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Video grande.',
      message_type: 'video',
      glpi_user_id: 7,
      media: {
        filename: 'video.mp4',
        mime_type: 'video/mp4',
        content_base64: Buffer.alloc(64 * 1024 * 1024 + 1).toString('base64'),
      },
    }, { correlationId: 'WA-test-large-video' });

    expect(result).toMatchObject({
      httpStatus: 400,
      body: {
        status: 'failed',
        error_code: 'MEDIA_SIZE_INVALID',
      },
    });
    expect(metaClient.uploadMedia).not.toHaveBeenCalled();
    expect(messageRepository.insertOutbound).not.toHaveBeenCalled();
  });

  it('falls back to a safe text message when Meta document sending fails', async () => {
    const { conversationRepository, messageRepository, insertedMessages } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn().mockRejectedValue(new Error('Meta upload failed')),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.fallback' }] }),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Anexo do chamado #123: relatorio.pdf.',
      message_type: 'document',
      glpi_user_id: 7,
      media: {
        document_id: 55,
        filename: 'relatorio.pdf',
        mime_type: 'application/pdf',
        content_base64: PDF_BUFFER.toString('base64'),
      },
    }, { correlationId: 'WA-test-document-fallback' });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.sendTextMessage).toHaveBeenCalledWith({
      to: '5541999999999',
      body: 'Não consegui enviar o anexo pelo WhatsApp. Acesse o GLPI para visualizar o arquivo.',
    });
    expect(insertedMessages[0]).toMatchObject({
      messageId: 'wamid.fallback',
      messageType: 'text',
      messageText: 'Não consegui enviar o anexo pelo WhatsApp. Acesse o GLPI para visualizar o arquivo.',
    });
  });

  it('ignores generic outbound sends for a closed conversation without calling Meta', async () => {
    const { conversationRepository, messageRepository } = makeRepositories(makeConversation({ status: 'closed' }));
    const metaClient = {
      uploadMedia: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn(),
    };
    const audit = {
      recordAuditEventFireAndForget: vi.fn(),
    } as unknown as AuditService;
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
      audit,
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Mensagem apos fechamento.',
      message_type: 'text',
      glpi_user_id: 7,
    }, { correlationId: 'WA-closed-outbound' });

    expect(result).toEqual({
      httpStatus: 200,
      body: {
        status: 'ignored',
        error_code: 'CONVERSATION_CLOSED',
        message: 'Outbound message ignored because the conversation is closed.',
      },
    });
    expect(metaClient.sendTextMessage).not.toHaveBeenCalled();
    expect(messageRepository.insertOutbound).not.toHaveBeenCalled();
    expect(audit.recordAuditEventFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'WA-closed-outbound',
        ticketId: 123,
        conversationId: 'conv-1',
        eventType: 'MESSAGE_IGNORED',
        status: 'ignored',
        severity: 'info',
        errorMessage: 'CONVERSATION_CLOSED',
      }),
    );
  });

  it('tracks regular outbound text activity for the inactivity ruler', async () => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.text' }] }),
    };
    const inactivityTrackingRepository = {
      trackOutboundActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as InactivityTrackingRepository;
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
      null,
      inactivityTrackingRepository,
    );

    await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Mensagem do tecnico.',
      message_type: 'text',
      glpi_user_id: 7,
      idempotency_key: 'manual_reply_123',
    }, { correlationId: 'WA-track-outbound' });

    expect(inactivityTrackingRepository.trackOutboundActivity).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      ticketId: 123,
      occurredAt: expect.any(Date),
    });
  });

  it('does not restart the inactivity ruler for inactivity reminder messages', async () => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.text' }] }),
    };
    const inactivityTrackingRepository = {
      trackOutboundActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as InactivityTrackingRepository;
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
      null,
      inactivityTrackingRepository,
    );

    await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Lembrete.',
      message_type: 'text',
      glpi_user_id: 0,
      idempotency_key: 'inactivity:reminder_1:conv-1:123',
    }, { correlationId: 'WA-inactivity-reminder' });

    expect(inactivityTrackingRepository.trackOutboundActivity).not.toHaveBeenCalled();
  });

  it('sends approved local templates without restarting the inactivity ruler', async () => {
    const { conversationRepository, messageRepository, insertedMessages } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn(),
      sendTemplateMessage: vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.template' }] }),
    };
    const inactivityTrackingRepository = {
      trackOutboundActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as InactivityTrackingRepository;
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
      null,
      inactivityTrackingRepository,
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Template preview',
      message_type: 'template',
      glpi_user_id: 0,
      template_name: 'integaglpi_inactivity_reminder',
      language: 'pt_BR',
      idempotency_key: 'inactivity:reminder_1:conv-1:123',
    }, { correlationId: 'WA-inactivity-template' });

    expect(result.httpStatus).toBe(201);
    expect(metaClient.sendTemplateMessage).toHaveBeenCalledWith({
      to: '5541999999999',
      templateName: 'integaglpi_inactivity_reminder',
      language: 'pt_BR',
    });
    expect(insertedMessages[0]).toMatchObject({
      messageId: 'wamid.template',
      messageType: 'template',
      messageText: 'Template preview',
    });
    expect(inactivityTrackingRepository.trackOutboundActivity).not.toHaveBeenCalled();
  });

  it('suppresses GLPI follow-up notifications generated by inactivity autoclose', async () => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn(),
    };
    const inactivityTrackingRepository = {
      trackOutboundActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as InactivityTrackingRepository;
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
      null,
      inactivityTrackingRepository,
    );

    const result = await service.send({
      ticket_id: 123,
      conversation_id: 'conv-1',
      text: 'Encerrado por falta de retorno do usuário\n\nComo não tivemos retorno.',
      message_type: 'text',
      glpi_user_id: 0,
      idempotency_key: 'notify_followup_123_999',
    }, { correlationId: 'WA-inactivity-followup' });

    expect(result).toMatchObject({
      httpStatus: 200,
      body: {
        status: 'ignored',
        error_code: 'INACTIVITY_AUTOCLOSE_FOLLOWUP_SUPPRESSED',
      },
    });
    expect(metaClient.sendTextMessage).not.toHaveBeenCalled();
    expect(messageRepository.insertOutbound).not.toHaveBeenCalled();
    expect(inactivityTrackingRepository.trackOutboundActivity).not.toHaveBeenCalled();
  });

  it('suppresses CSAT solution notifications generated by inactivity autoclose', async () => {
    const { conversationRepository, messageRepository } = makeRepositories();
    const metaClient = {
      uploadMedia: vi.fn(),
      sendDocumentMessage: vi.fn(),
      sendImageMessage: vi.fn(),
      sendTextMessage: vi.fn(),
      sendInteractiveButtonsMessage: vi.fn(),
    };
    const service = new OutboundMessageService(
      conversationRepository,
      messageRepository,
      metaClient as never,
      'real',
      '5511999999999',
    );

    const result = await service.sendSolutionApprovalRequest({
      ticket_id: 123,
      conversation_id: 'conv-1',
      glpi_user_id: 0,
      solution_content: 'Encerrado por falta de retorno do usuário',
      idempotency_key: 'notify_ticket_solved_123_inactivity',
    }, { correlationId: 'WA-inactivity-solution' });

    expect(result).toMatchObject({
      httpStatus: 200,
      body: {
        status: 'ignored',
        error_code: 'INACTIVITY_AUTOCLOSE_SOLUTION_SUPPRESSED',
      },
    });
    expect(metaClient.sendInteractiveButtonsMessage).not.toHaveBeenCalled();
    expect(messageRepository.insertOutbound).not.toHaveBeenCalled();
  });
});
