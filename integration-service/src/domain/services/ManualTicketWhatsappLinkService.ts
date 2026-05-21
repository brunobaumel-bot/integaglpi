import type { KeyLock } from '../contracts/KeyLock.js';
import type { AuditStatus } from '../../repositories/contracts/AuditEventRepository.js';
import type { AuditService } from './AuditService.js';
import { createCorrelationId } from './correlationId.js';
import type { OutboundMessageService } from './OutboundMessageService.js';
import type { PostgresManualTicketWhatsappRepository } from '../../repositories/postgres/PostgresManualTicketWhatsappRepository.js';

const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const TEMPLATE_NAME = 'aviso_atendimento_fora_janela';
const WINDOW_MS = 24 * 60 * 60 * 1000;

export class ManualTicketWhatsappLinkError extends Error {
  public constructor(
    public readonly errorCode: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface ManualTicketResolveInput {
  ticketId: number;
  requesterName?: string | null;
  requesterEmail?: string | null;
  requesterPhones?: string[];
}

export interface ManualTicketStartInput extends ManualTicketResolveInput {
  phoneE164: string;
  glpiUserId: number;
  templateName: string;
  language: string;
  manualConfirmation: boolean;
  costAcknowledged: boolean;
  templateApproved: boolean;
  templateActive: boolean;
  idempotencyKey?: string | null;
}

function maskPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, '');
  if (digits.length < 8) {
    return '******';
  }

  return `+${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

function assertTicketId(ticketId: number): void {
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    throw new ManualTicketWhatsappLinkError('INVALID_TICKET_ID', 'ticket_id inválido.');
  }
}

function assertE164(phoneE164: string): void {
  if (!E164_PATTERN.test(phoneE164)) {
    throw new ManualTicketWhatsappLinkError('INVALID_PHONE_E164', 'Telefone inválido. Informe em E.164, por exemplo +5511999999999.');
  }
}

function normalizeTemplateValue(value: string | null | undefined, fallback: string): string {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? fallback : trimmed.slice(0, 200);
}

function isWindowOpen(lastInboundAt: Date | null, now = Date.now()): boolean {
  return lastInboundAt !== null && now - lastInboundAt.getTime() <= WINDOW_MS;
}

export class ManualTicketWhatsappLinkService {
  public constructor(
    private readonly repository: PostgresManualTicketWhatsappRepository,
    private readonly outboundMessageService: OutboundMessageService,
    private readonly keyLock: KeyLock | null = null,
    private readonly auditService: AuditService | null = null,
  ) {}

  public async resolve(input: ManualTicketResolveInput) {
    assertTicketId(input.ticketId);
    const normalizedPhones = [...new Set((input.requesterPhones ?? [])
      .map((phone) => phone.trim())
      .filter((phone) => E164_PATTERN.test(phone)))];
    const primaryPhone = normalizedPhones[0] ?? null;
    const profiles = await this.repository.findProfiles({
      phoneE164: primaryPhone,
      email: input.requesterEmail,
      limit: 10,
    });
    const profilePhones = profiles.map((profile) => profile.phone_e164).filter((phone) => E164_PATTERN.test(phone));
    const phones = [...new Set([...normalizedPhones, ...profilePhones])];
    const candidates = await Promise.all(phones.map(async (phone) => {
      const conflict = await this.repository.findOpenConflict(phone, input.ticketId);
      const profile = profiles.find((item) => item.phone_e164 === phone) ?? null;
      const last = await this.repository.findReusableConversation(phone, input.ticketId);
      const lastInboundAt = last ? await this.repository.findLastInboundAt(String(last.id)) : null;

      return {
        phone_e164: phone,
        masked_phone: maskPhone(phone),
        source: normalizedPhones.includes(phone) ? 'glpi_requester' : 'contact_profile',
        requester_name: profile?.requester_name ?? input.requesterName ?? null,
        email_address: profile?.email_address ?? input.requesterEmail ?? null,
        has_open_conflict: conflict !== null,
        conflict_ticket_id: conflict?.glpi_ticket_id ? Number(conflict.glpi_ticket_id) : null,
        reusable_conversation_id: last?.id ?? null,
        whatsapp_window: {
          is_open: isWindowOpen(lastInboundAt),
          last_inbound_at: lastInboundAt?.toISOString() ?? null,
        },
      };
    }));

    return {
      ticket_id: input.ticketId,
      candidates,
      template: {
        name: TEMPLATE_NAME,
        language: 'pt_BR',
        requires_manual_confirmation: true,
        cost_warning_enabled: true,
      },
    };
  }

  public async startTemplate(input: ManualTicketStartInput) {
    assertTicketId(input.ticketId);
    assertE164(input.phoneE164);
    if (!Number.isInteger(input.glpiUserId) || input.glpiUserId <= 0) {
      throw new ManualTicketWhatsappLinkError('INVALID_GLPI_USER_ID', 'Usuário GLPI inválido.');
    }
    if (input.templateName !== TEMPLATE_NAME) {
      throw new ManualTicketWhatsappLinkError('INVALID_TEMPLATE', 'Template inicial não suportado para esta ação.');
    }
    if (!input.templateApproved || !input.templateActive) {
      throw new ManualTicketWhatsappLinkError('TEMPLATE_NOT_AVAILABLE', 'Template aprovado/ativo não encontrado.');
    }
    if (!input.manualConfirmation || !input.costAcknowledged) {
      throw new ManualTicketWhatsappLinkError('MANUAL_CONFIRMATION_REQUIRED', 'Confirmação humana e ciência de custo são obrigatórias.');
    }

    const lockKey = `manual-ticket-whatsapp:${input.phoneE164}:${input.ticketId}`;
    const execute = async () => {
      const conflict = await this.repository.findOpenConflict(input.phoneE164, input.ticketId);
      if (conflict !== null) {
        this.audit(input, 'MANUAL_TICKET_WHATSAPP_LINK_BLOCKED', 'ignored', 'warning', {
          reason: 'open_conversation_other_ticket',
          conflict_ticket_id: conflict.glpi_ticket_id,
          phone_masked: maskPhone(input.phoneE164),
        });
        throw new ManualTicketWhatsappLinkError(
          'OPEN_CONVERSATION_OTHER_TICKET',
          'Este telefone já possui conversa aberta vinculada a outro chamado ativo.',
          409,
        );
      }

      const reusable = await this.repository.findReusableConversation(input.phoneE164, input.ticketId);
      let conversation = reusable;
      if (conversation === null) {
        const contact = await this.repository.ensureContact({
          phoneE164: input.phoneE164,
          name: normalizeTemplateValue(input.requesterName, 'Cliente'),
        });
        conversation = await this.repository.createManualConversation({
          phoneE164: input.phoneE164,
          contactId: contact.id,
          ticketId: input.ticketId,
          glpiUserId: input.glpiUserId,
        });
      } else {
        conversation = await this.repository.linkConversation({
          conversationId: String(conversation.id),
          ticketId: input.ticketId,
          glpiUserId: input.glpiUserId,
        });
      }

      const lastInboundAt = await this.repository.findLastInboundAt(String(conversation.id));
      const windowOpen = isWindowOpen(lastInboundAt);
      const templateParameters = [
        normalizeTemplateValue(input.requesterName, 'Cliente'),
        String(input.ticketId),
      ];
      const idempotencyKey = input.idempotencyKey?.trim()
        || `manual_ticket_template:${input.ticketId}:${conversation.id}:${input.templateName}`;

      const result = await this.outboundMessageService.send({
        ticket_id: input.ticketId,
        conversation_id: String(conversation.id),
        text: `Template ${input.templateName} enviado para iniciar atendimento do chamado #${input.ticketId}.`,
        message_type: 'template',
        glpi_user_id: input.glpiUserId,
        template_name: input.templateName,
        language: input.language || 'pt_BR',
        template_parameters: templateParameters,
        idempotency_key: idempotencyKey,
      }, { correlationId: createCorrelationId() });

      if (result.httpStatus < 200 || result.httpStatus >= 300 || result.body.status !== 'sent') {
        this.audit(input, 'MANUAL_TICKET_WHATSAPP_TEMPLATE_FAILED', 'failed', 'error', {
          conversation_id: conversation.id,
          reason: 'template_send_failed',
          error_code: 'error_code' in result.body ? result.body.error_code : null,
        });
        throw new ManualTicketWhatsappLinkError(
          'TEMPLATE_SEND_FAILED',
          'Falha ao enviar template aprovado pelo WhatsApp.',
          result.httpStatus >= 400 ? result.httpStatus : 502,
        );
      }

      this.audit(input, 'MANUAL_TICKET_WHATSAPP_TEMPLATE_SENT', 'success', 'info', {
        conversation_id: conversation.id,
        message_id: result.body.message_id,
        template_name: input.templateName,
        window_open: windowOpen,
        phone_masked: maskPhone(input.phoneE164),
      });

      return {
        status: 'sent' as const,
        ticket_id: input.ticketId,
        conversation_id: String(conversation.id),
        message_id: result.body.message_id,
        whatsapp_window: {
          is_open: windowOpen,
          last_inbound_at: lastInboundAt?.toISOString() ?? null,
        },
      };
    };

    return this.keyLock ? this.keyLock.withLock(lockKey, execute) : execute();
  }

  private audit(
    input: Pick<ManualTicketStartInput, 'ticketId' | 'phoneE164' | 'glpiUserId'>,
    eventType: string,
    status: AuditStatus,
    severity: 'info' | 'warning' | 'error',
    payload: Record<string, unknown>,
  ): void {
    this.auditService?.recordAuditEventFireAndForget({
      ticketId: input.ticketId,
      eventType,
      status,
      severity,
      source: 'ManualTicketWhatsappLinkService',
      payload: {
        glpi_user_id: input.glpiUserId,
        ...payload,
      },
    });
  }
}
