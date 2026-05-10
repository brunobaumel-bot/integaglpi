import type { MetaWebhookPayload, ParsedMetaInboundMessage } from '../../adapters/meta/metaWebhookTypes.js';
import type { MediaProcessingService } from './MediaProcessingService.js';
import type { MetaClient } from '../../adapters/meta/MetaClient.js';
import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { Contact } from '../entities/Contact.js';
import type { ConversationRepository } from '../../repositories/contracts/ConversationRepository.js';
import type { MessageRepository } from '../../repositories/contracts/MessageRepository.js';
import type { WebhookEventRepository } from '../../repositories/contracts/WebhookEventRepository.js';
import type { ActiveRoutingOption, RoutingRepository } from '../../repositories/contracts/RoutingRepository.js';
import type { SolutionActionRepository } from '../../repositories/contracts/SolutionActionRepository.js';

import { logger } from '../../infra/logger/logger.js';
import { serializeInboundFailure } from '../../infra/logger/serializeInboundFailure.js';
import { parseMetaInboundMessages } from '../../adapters/meta/parseMetaWebhookPayload.js';
import { ContactResolutionService } from './ContactResolutionService.js';
import type { ScheduleService } from './ScheduleService.js';
import type { GlpiFailureStage } from '../../errors/GlpiRequestError.js';
import type { KeyLock } from '../contracts/KeyLock.js';
import { buildMenuMessage, parseMenuDigitChoice } from './routingMenuMessage.js';
import type { SettingsService } from './SettingsService.js';
import type { AuditService } from './AuditService.js';
import { createCorrelationId } from './correlationId.js';

export interface InboundWebhookProcessingResult {
  messageId: string;
  outcome: 'processed' | 'duplicate' | 'failed';
}

export interface InboundWebhookServiceResult {
  results: InboundWebhookProcessingResult[];
}

export interface InboundWebhookProcessOptions {
  correlationId?: string;
}

const GLPI_CONTACT_LOOKUP_FALLBACK_SOURCE = 'glpi_contact_lookup_fallback';
const ROUTING_GLPI_CREATE_TIMEOUT_MS = 5_000;
const GLPI_STATUS_SOLVED = 5;
const GLPI_STATUS_CLOSED = 6;
const GLPI_STATUS_PROCESSING = 2;

interface RoutingMenuSendInput {
  toMeta: string;
  routingOptions: ActiveRoutingOption[];
  menuHeading: string;
  menuBody: string;
  context: string;
  conversationId?: string | null;
  prefixText?: string;
}

type SolutionButtonAction = 'approve' | 'reopen';

interface ParsedSolutionButtonAction {
  action: SolutionButtonAction;
  ticketId: number;
  conversationId: string;
}

export class InboundWebhookService {
  public constructor(
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly messageRepository: MessageRepository,
    private readonly conversationRepository: ConversationRepository,
    private readonly contactResolutionService: ContactResolutionService,
    private readonly glpiClient: GlpiClient,
    private readonly keyLock: KeyLock,
    private readonly routingRepository: RoutingRepository,
    private readonly settingsService: Pick<SettingsService, 'getMessage'>,
    private readonly scheduleService: Pick<ScheduleService, 'isOpen' | 'shouldSendAfterHoursMessage'>,
    private readonly metaClient: MetaClient,
    private readonly mediaProcessingService: Pick<MediaProcessingService, 'processMedia'> | null = null,
    private readonly solutionActionRepository: SolutionActionRepository | null = null,
    private readonly auditService: AuditService | null = null,
  ) {}

  public async process(
    payload: MetaWebhookPayload,
    options: InboundWebhookProcessOptions = {},
  ): Promise<InboundWebhookServiceResult> {
    const correlationId = options.correlationId ?? createCorrelationId();
    const inboundMessages = parseMetaInboundMessages(payload);

    if (inboundMessages.length === 0) {
      await this.webhookEventRepository.create({
        eventId: `ignored:${Date.now()}`,
        eventType: 'ignored',
        payload,
        signatureValid: true,
        processingStatus: 'ignored',
      });
      this.recordAudit({
        correlationId,
        eventType: 'WEBHOOK_RECEIVED',
        status: 'ignored',
        severity: 'info',
        source: 'InboundWebhookService',
        payload: { reason: 'no_inbound_messages' },
      });

      return { results: [] };
    }

    const results: InboundWebhookProcessingResult[] = [];

    for (const inboundMessage of inboundMessages) {
      results.push(await this.processSingleMessage(inboundMessage, correlationId));
    }

    return { results };
  }

  private async processSingleMessage(
    inboundMessage: ParsedMetaInboundMessage,
    correlationId: string,
  ): Promise<InboundWebhookProcessingResult> {
    await this.webhookEventRepository.create({
      eventId: inboundMessage.eventId,
      eventType: inboundMessage.eventType,
      payload: inboundMessage.rawPayload,
      signatureValid: true,
      processingStatus: 'received',
    });

    const reservedMessage = await this.messageRepository.reserveInbound({
      messageId: inboundMessage.messageId,
      direction: 'inbound',
      senderPhone: inboundMessage.senderPhone,
      recipientPhone: inboundMessage.recipientPhone,
      messageType: inboundMessage.messageType,
      messageText: inboundMessage.messageText,
      rawPayload: inboundMessage.rawPayload,
      processingStatus: 'processing',
      glpiSyncStatus: 'not_sent',
    });
    this.recordAudit({
      correlationId,
      messageId: inboundMessage.messageId,
      direction: 'inbound',
      eventType: 'MESSAGE_RECEIVED',
      status: 'pending',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        message_type: inboundMessage.messageType,
        sender_phone: inboundMessage.senderPhone,
        recipient_phone: inboundMessage.recipientPhone,
      },
    });

    if (!reservedMessage) {
      await this.webhookEventRepository.updateStatus(inboundMessage.eventId, 'duplicate');
      logger.info(
        { correlation_id: correlationId, message_id: inboundMessage.messageId, event_type: 'WEBHOOK_DUPLICATED', status: 'duplicated' },
        'Duplicate inbound message ignored.',
      );
      this.recordAudit({
        correlationId,
        messageId: inboundMessage.messageId,
        direction: 'inbound',
        eventType: 'WEBHOOK_DUPLICATED',
        status: 'duplicated',
        severity: 'info',
        source: 'InboundWebhookService',
      });

      return {
        messageId: inboundMessage.messageId,
        outcome: 'duplicate',
      };
    }

    if (
      inboundMessage.messageType === 'image'
      || inboundMessage.messageType === 'document'
      || inboundMessage.messageType === 'audio'
    ) {
      logger.info(
        {
          message_id: inboundMessage.messageId,
          message_type: inboundMessage.messageType,
          sender_phone: inboundMessage.senderPhone,
          correlation_id: correlationId,
          event_type: 'MEDIA_RECEIVED',
          status: 'pending',
        },
        '[integration-service][media][RECEIVED]',
      );
      this.recordAudit({
        correlationId,
        messageId: inboundMessage.messageId,
        direction: 'inbound',
        eventType: 'MEDIA_RECEIVED',
        status: 'pending',
        severity: 'info',
        source: 'InboundWebhookService',
        payload: {
          message_type: inboundMessage.messageType,
          has_media_metadata: inboundMessage.mediaMetadata !== null,
        },
      });
    }

    let inboundGlpiStage: GlpiFailureStage | 'unknown' | undefined = 'glpi_contact_lookup';
    let conversationId: string | null = null;
    let phoneE164: string | null = null;

    try {
      const contact = await this.contactResolutionService.resolve(
        inboundMessage.senderPhone,
        inboundMessage.contactName,
      );

      phoneE164 = contact.phoneE164;
      await this.keyLock.withLock(`phone_e164:${contact.phoneE164}`, async () => {
        // FSM persistida válida: open, awaiting_queue_selection e closed. pending_glpi só é lido para recovery legado.
        const activeConversation = await this.conversationRepository.findReusableByPhoneE164(contact.phoneE164);
        const pendingGlpiOrphan = activeConversation
          ? null
          : await this.conversationRepository.findPendingGlpiOrphanByPhoneE164(contact.phoneE164);
        const closedConversation = activeConversation || pendingGlpiOrphan
          ? null
          : await this.conversationRepository.findLatestClosedByPhoneE164(contact.phoneE164);
        const existingConversation = activeConversation ?? pendingGlpiOrphan ?? closedConversation;

        conversationId = existingConversation?.id ?? null;

        const toMeta = InboundWebhookService.digitsOnlyForMeta(contact.phoneE164);
        const routingOptions = await this.routingRepository.getActiveOptions();
        const menuHeading = await this.settingsService.getMessage('menu_message');
        const menuBody = buildMenuMessage(routingOptions, menuHeading);
        let closedConversationNoticeSent = false;
        let knownExistingTicketStatus: 'open' | 'closed' | 'unknown' | null = null;
        const solutionButtonAction = inboundMessage.messageType === 'interactive'
          ? this.parseSolutionButtonAction(inboundMessage.messageText)
          : null;

        if (solutionButtonAction) {
          await this.handleSolutionButtonAction({
            action: solutionButtonAction,
            contact,
            inboundMessage,
            toMeta,
            correlationId,
          });
          conversationId = solutionButtonAction.conversationId;
          return;
        }

        if (closedConversation?.glpiTicketId) {
          inboundGlpiStage = 'glpi_ticket_read';
          knownExistingTicketStatus = await this.glpiClient.getTicketStatus(closedConversation.glpiTicketId);
          inboundGlpiStage = undefined;

          if (knownExistingTicketStatus === 'closed') {
            await this.sendClosedConversationMessage(
              toMeta,
              closedConversation.id,
              closedConversation.glpiTicketId,
            );
            closedConversationNoticeSent = true;
          }
        }

        if (
          pendingGlpiOrphan
          && pendingGlpiOrphan.glpiTicketId === null
        ) {
          logger.warn(
            {
              conversation_id: pendingGlpiOrphan.id,
              phone_e164: contact.phoneE164,
            },
            '[integration-service][routing][RECOVER_PENDING_GLPI_ORPHAN]',
          );
          await this.conversationRepository.updateStatus(pendingGlpiOrphan.id, 'awaiting_queue_selection');
          if (routingOptions.length > 0) {
            await this.sendRoutingMenu({
              toMeta,
              routingOptions,
              menuHeading,
              menuBody,
              context: 'recover',
              conversationId: pendingGlpiOrphan.id,
            });
            logger.info(
              { conversation_id: pendingGlpiOrphan.id, context: 'recover' },
              '[integration-service][routing][MENU_RESENT]',
            );
          } else {
            logger.warn(
              { conversation_id: pendingGlpiOrphan.id },
              '[integration-service][routing][RECOVER_PENDING_GLPI_ORPHAN] menu not sent: no active routing options',
            );
          }
          await this.conversationRepository.touch(pendingGlpiOrphan.id, new Date());
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: pendingGlpiOrphan.id,
            processingStatus: 'processed',
            glpiSyncStatus: 'synced',
          });
          return;
        }

        if (activeConversation?.status !== 'open' && !await this.scheduleService.isOpen()) {
          const shouldSendMessage = this.scheduleService.shouldSendAfterHoursMessage(contact.phoneE164);
          if (shouldSendMessage) {
            const afterHoursMessage = await this.settingsService.getMessage('after_hours_message');
            await this.metaClient.sendTextMessage({ to: toMeta, body: afterHoursMessage });
          }

          logger.info(
            {
              phone_e164: contact.phoneE164,
              conversation_id: conversationId,
              conversation_status: existingConversation?.status ?? null,
              message_sent: shouldSendMessage,
            },
            '[schedule][OUT_OF_HOURS]',
          );
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: conversationId ?? undefined,
            processingStatus: 'processed',
            glpiSyncStatus: 'synced',
          });
          return;
        }

        const isDetectableMedia =
          inboundMessage.messageType === 'image'
          || inboundMessage.messageType === 'document'
          || inboundMessage.messageType === 'audio';

        if (isDetectableMedia && activeConversation?.status === 'awaiting_queue_selection') {
          const invalidMediaText = await this.settingsService.getMessage('invalid_media_message');
          if (routingOptions.length > 0) {
            await this.sendRoutingMenu({
              toMeta,
              routingOptions,
              menuHeading,
              menuBody,
              context: 'invalid_media',
              conversationId,
              prefixText: invalidMediaText,
            });
          } else {
            await this.metaClient.sendTextMessage({ to: toMeta, body: invalidMediaText });
          }
          logger.info(
            {
              message_id: inboundMessage.messageId,
              message_type: inboundMessage.messageType,
              conversation_id: conversationId,
              conversation_status: activeConversation?.status ?? null,
            },
            '[integration-service][media][SKIPPED_INVALID_STATE]',
          );
          if (activeConversation) {
            await this.conversationRepository.touch(activeConversation.id, new Date());
          }
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: conversationId ?? undefined,
            processingStatus: 'processed',
            glpiSyncStatus: 'synced',
          });
          return;
        }

        // TODO 8.0C: when isDetectableMedia && activeConversation?.status === 'open',
        // download and attach media to GLPI ticket.
        // For now the existing flow appends [image]/[audio]/[document] as text.

        const hasOpenConversationWithTicket =
          activeConversation?.status === 'open' && activeConversation.glpiTicketId !== null;
        const willRoute = routingOptions.length > 0 && !hasOpenConversationWithTicket;
        const routingBranchReason =
          routingOptions.length === 0
            ? 'no_routing_options'
            : hasOpenConversationWithTicket
              ? 'active_open_conversation_with_ticket'
              : activeConversation?.status === 'awaiting_queue_selection'
                ? 'awaiting_queue_selection'
                : 'routing_menu_required';
        logger.info(
          {
            phone_e164: contact.phoneE164,
            conversation_id: conversationId,
            options_count: routingOptions.length,
          },
          '[integration-service][routing][OPTIONS_LOADED]',
        );
        logger.info(
          {
            options_count: routingOptions.length,
            existing_conversation_id: existingConversation?.id ?? null,
            existing_conversation_status: existingConversation?.status ?? null,
            existing_conversation_ticket_id: existingConversation?.glpiTicketId ?? null,
            will_route: willRoute,
            reason: routingBranchReason,
          },
          '[integration-service][routing][BRANCH_CHECK]',
        );

        if (routingOptions.length === 0) {
          logger.info(
            {
              phone_e164: contact.phoneE164,
              conversation_id: conversationId,
            },
            '[integration-service][routing][STANDARD_FLOW]',
          );
        }

        if (willRoute) {
          if (activeConversation?.status === 'awaiting_queue_selection') {
            const menuResponseText = inboundMessage.messageText?.trim();
            if (!menuResponseText) {
              const invalidMediaText = await this.settingsService.getMessage('invalid_media_message');
              await this.sendRoutingMenu({
                toMeta,
                routingOptions,
                menuHeading,
                menuBody,
                context: 'invalid_input',
                conversationId: activeConversation.id,
                prefixText: invalidMediaText,
              });
              logger.info(
                {
                  conversation_id: activeConversation.id,
                  phone_e164: contact.phoneE164,
                  message_type: inboundMessage.messageType,
                },
                '[integration-service][routing][INVALID_INPUT_TYPE]',
              );
              logger.info(
                { conversation_id: activeConversation.id, context: 'invalid_input' },
                '[integration-service][routing][INVALID_MEDIA_MESSAGE_SENT]',
              );
              await this.conversationRepository.touch(activeConversation.id, new Date());
              await this.messageRepository.updateState({
                messageId: inboundMessage.messageId,
                conversationId: activeConversation.id,
                processingStatus: 'processed',
                glpiSyncStatus: 'synced',
              });
              return;
            }

            const resolvedOption = this.resolveSelectedRoutingOption(inboundMessage, menuResponseText, routingOptions);
            if (!resolvedOption) {
              const invalidOptionText = await this.settingsService.getMessage('invalid_option_message');
              await this.sendRoutingMenu({
                toMeta,
                routingOptions,
                menuHeading,
                menuBody,
                context: 'invalid_option',
                conversationId: activeConversation.id,
                prefixText: invalidOptionText,
              });
              logger.info(
                {
                  conversation_id: activeConversation.id,
                  phone_e164: contact.phoneE164,
                  message_type: inboundMessage.messageType,
                  message_preview: inboundMessage.messageText?.slice(0, 80) ?? null,
                },
                '[integration-service][routing][INVALID_OPTION]',
              );
              logger.info(
                { conversation_id: activeConversation.id, context: 'invalid_option' },
                '[integration-service][routing][INVALID_OPTION_MESSAGE_SENT]',
              );
              await this.conversationRepository.touch(activeConversation.id, new Date());
              await this.messageRepository.updateState({
                messageId: inboundMessage.messageId,
                conversationId: activeConversation.id,
                processingStatus: 'processed',
                glpiSyncStatus: 'synced',
              });
              return;
            }

            const { choice, selectedOption } = resolvedOption;
            if (inboundMessage.messageType === 'interactive') {
              logger.info(
                {
                  conversation_id: activeConversation.id,
                  selected_option_key: selectedOption.optionKey,
                  routing_option_id: selectedOption.id,
                },
                '[integration-service][routing][INTERACTIVE_OPTION_SELECTED]',
              );
            }
              logger.info(
                {
                  conversation_id: activeConversation.id,
                  routing_option_id: selectedOption.id,
                  selected_option_key: selectedOption.optionKey,
                queue_id: selectedOption.queueId,
                glpi_group_id: selectedOption.glpiGroupId,
                glpi_user_id: selectedOption.glpiUserId,
                choice,
                },
                '[integration-service][routing][OPTION_SELECTED]',
              );
            this.recordAudit({
              correlationId,
              conversationId: activeConversation.id,
              messageId: inboundMessage.messageId,
              direction: 'inbound',
              eventType: 'QUEUE_SELECTED',
              status: 'success',
              severity: 'info',
              source: 'InboundWebhookService',
              payload: {
                routing_option_id: selectedOption.id,
                selected_option_key: selectedOption.optionKey,
                queue_id: selectedOption.queueId,
                glpi_group_id: selectedOption.glpiGroupId,
                glpi_user_id: selectedOption.glpiUserId,
              },
            });

            inboundGlpiStage = 'glpi_ticket_create';
            await this.keyLock.withLock(`conversation:${activeConversation.id}`, async () => {
              const lockedConversation = await this.conversationRepository.findById(activeConversation.id);

              if (!lockedConversation) {
                logger.warn(
                  { conversation_id: activeConversation.id },
                  '[integration-service][routing][CONVERSATION_NOT_FOUND]',
                );
                await this.sendRoutingMenu({
                  toMeta,
                  routingOptions,
                  menuHeading,
                  menuBody,
                  context: 'conversation_not_found',
                  conversationId: activeConversation.id,
                });
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: activeConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'error',
                });
                return;
              }

              if (lockedConversation.glpiTicketId !== null) {
                logger.warn(
                  {
                    conversation_id: lockedConversation.id,
                    glpi_ticket_id: lockedConversation.glpiTicketId,
                  },
                  '[integration-service][routing][DUPLICATE_PREVENTED]',
                );
                await this.conversationRepository.touch(lockedConversation.id, new Date());
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'synced',
                });
                return;
              }

              if (lockedConversation.status === 'pending_glpi') {
                logger.warn(
                  {
                    conversation_id: lockedConversation.id,
                    phone_e164: contact.phoneE164,
                  },
                  '[integration-service][routing][RECOVER_PENDING_GLPI_ORPHAN]',
                );
                await this.conversationRepository.updateStatus(lockedConversation.id, 'awaiting_queue_selection');
                await this.sendRoutingMenu({
                  toMeta,
                  routingOptions,
                  menuHeading,
                  menuBody,
                  context: 'recover_locked',
                  conversationId: lockedConversation.id,
                });
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'synced',
                });
                return;
              }

              if (lockedConversation.status !== 'awaiting_queue_selection') {
                logger.warn(
                  {
                    conversation_id: lockedConversation.id,
                    status: lockedConversation.status,
                  },
                  '[integration-service][routing][INVALID_STATE]',
                );
                await this.sendRoutingMenu({
                  toMeta,
                  routingOptions,
                  menuHeading,
                  menuBody,
                  context: 'invalid_state',
                  conversationId: lockedConversation.id,
                });
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'error',
                });
                return;
              }

              const routedTicketPayload = this.buildNewTicketPayload(contact, inboundMessage);
              let ticketId: number;
              try {
                ticketId = await this.glpiClient.createTicket(
                  {
                    title: routedTicketPayload.title,
                    content: routedTicketPayload.content,
                    requesterPhone: contact.phoneE164,
                    requesterName: contact.name,
                    assignedUserId: selectedOption.glpiUserId,
                    assignedGroupId: selectedOption.glpiGroupId,
                  },
                  { timeoutMs: ROUTING_GLPI_CREATE_TIMEOUT_MS },
                );
              } catch (error: unknown) {
                logger.error(
                  {
                    conversation_id: lockedConversation.id,
                    phone_e164: contact.phoneE164,
                    selected_option_key: selectedOption.optionKey,
                    queue_id: selectedOption.queueId,
                    glpi_group_id: selectedOption.glpiGroupId,
                    glpi_user_id: selectedOption.glpiUserId,
                    failed_at: new Date().toISOString(),
                    ...serializeInboundFailure(error, inboundGlpiStage),
                  },
                  '[integration-service][routing][GLPI_FAILURE]',
                );
                const errorText = await this.settingsService.getMessage('error_fallback_message');
                await this.sendRoutingMenu({
                  toMeta,
                  routingOptions,
                  menuHeading,
                  menuBody,
                  context: 'glpi_ticket_create_failed',
                  conversationId: lockedConversation.id,
                  prefixText: errorText,
                });
                logger.info(
                  { conversation_id: lockedConversation.id, context: 'glpi_ticket_create_failed' },
                  '[integration-service][routing][MENU_RESENT]',
                );
                await this.conversationRepository.touch(lockedConversation.id, new Date());
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'error',
                });
                return;
              }

              this.logTicketCreatedWithFallback(contact, inboundMessage.messageId, ticketId);
              logger.info(
                {
                  conversation_id: lockedConversation.id,
                  ticket_id: ticketId,
                  queue_id: selectedOption.queueId,
                  glpi_group_id: selectedOption.glpiGroupId,
                },
                '[integration-service][routing][ATTRIBUTION]',
              );
              inboundGlpiStage = undefined;

              const qId = selectedOption.queueId;
              try {
                const linked = await this.conversationRepository.linkGlpiTicket(
                  lockedConversation.id,
                  ticketId,
                  typeof qId === 'number' && Number.isFinite(qId) ? qId : undefined,
                );
                if (!linked) {
                  logger.warn(
                    {
                      conversation_id: lockedConversation.id,
                      glpi_ticket_id: ticketId,
                    },
                    '[integration-service][routing][DUPLICATE_PREVENTED]',
                  );
                  await this.messageRepository.updateState({
                    messageId: inboundMessage.messageId,
                    conversationId: lockedConversation.id,
                    processingStatus: 'processed',
                    glpiSyncStatus: 'synced',
                  });
                  return;
                }
              } catch (linkError: unknown) {
                logger.error(
                  {
                    conversation_id: lockedConversation.id,
                    glpi_ticket_id: ticketId,
                    message: linkError instanceof Error ? linkError.message : String(linkError),
                  },
                  '[integration-service][routing][CRITICAL] Ticket created in GLPI but PostgreSQL link failed - reconcile',
                );
                throw linkError;
              }
              await this.conversationRepository.touch(lockedConversation.id, new Date());

              const confirmText = await this.buildTicketCreatedConfirmation(selectedOption, ticketId);
              await this.metaClient.sendTextMessage({ to: toMeta, body: confirmText });

              await this.messageRepository.updateState({
                messageId: inboundMessage.messageId,
                conversationId: lockedConversation.id,
                processingStatus: 'processed',
                glpiSyncStatus: 'synced',
              });
            logger.info(
              {
                conversation_id: lockedConversation.id,
                glpi_ticket_id: ticketId,
                  routing_option_id: selectedOption.id,
                  selected_option_key: selectedOption.optionKey,
                  queue_id: selectedOption.queueId,
              },
              '[integration-service][routing][TICKET_CREATED]',
            );
              this.recordAudit({
                correlationId,
                ticketId,
                conversationId: lockedConversation.id,
                messageId: inboundMessage.messageId,
                direction: 'inbound',
                eventType: 'TICKET_CREATED',
                status: 'success',
                severity: 'info',
                source: 'InboundWebhookService',
                payload: {
                  routing_option_id: selectedOption.id,
                  queue_id: selectedOption.queueId,
                },
              });
            });
            return;
          }

          const awaitingConversation = await this.conversationRepository.create({
            phoneE164: contact.phoneE164,
            contactId: contact.id,
            glpiTicketId: null,
            status: 'awaiting_queue_selection',
            lastMessageAt: new Date(),
          });
          conversationId = awaitingConversation.id;
          await this.sendRoutingMenu({
            toMeta,
            routingOptions,
            menuHeading,
            menuBody,
            context: 'initial_menu',
            conversationId: awaitingConversation.id,
          });
          logger.info(
            {
              conversation_id: awaitingConversation.id,
              previous_conversation_id: existingConversation?.id ?? null,
              previous_conversation_status: existingConversation?.status ?? null,
              previous_conversation_ticket_id: existingConversation?.glpiTicketId ?? null,
              phone_e164: contact.phoneE164,
              options_count: routingOptions.length,
            },
            '[integration-service][routing][MENU_SENT]',
          );
          await this.conversationRepository.touch(awaitingConversation.id, new Date());
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: awaitingConversation.id,
            processingStatus: 'processed',
            glpiSyncStatus: 'synced',
          });
          return;
        }

        // ── Existe conversa com ticket vinculado → decisão baseada em status ──
        if (existingConversation?.glpiTicketId) {
          let glpiTicketStatus = knownExistingTicketStatus;
          if (glpiTicketStatus === null) {
            inboundGlpiStage = 'glpi_ticket_read';
            glpiTicketStatus = await this.glpiClient.getTicketStatus(existingConversation.glpiTicketId);
            inboundGlpiStage = undefined;
          }

          const conversationStatus = existingConversation.status;

          // Ticket GLPI tem prioridade sobre o status da conversa.
          let action: 'append' | 'reopen_conversation' | 'new_ticket';
          if (glpiTicketStatus === 'closed') {
            action = 'new_ticket';
          } else if (conversationStatus === 'closed') {
            action = 'reopen_conversation';
          } else {
            action = 'append';
          }

          logger.info(
            {
              conversation_id:    existingConversation.id,
              old_ticket_id:      existingConversation.glpiTicketId,
              conversation_status: conversationStatus,
              glpi_ticket_status: glpiTicketStatus,
              action,
            },
            '[integration-service][inbound][DECISION]',
          );

          if (action === 'append') {
            inboundGlpiStage = 'glpi_followup_create';

            let followUpContent: string;
            let mediaInfoRecord: Record<string, unknown> | null = null;

            if (
              isDetectableMedia
              && inboundMessage.mediaMetadata
              && this.mediaProcessingService
            ) {
              const mediaResult = await this.mediaProcessingService.processMedia({
                messageType: inboundMessage.messageType,
                mediaMetadata: inboundMessage.mediaMetadata,
                ticketId: existingConversation.glpiTicketId,
              });
              followUpContent = mediaResult.followUpContent;
              mediaInfoRecord = mediaResult.mediaInfo as unknown as Record<string, unknown>;
              await this.messageRepository.updateMediaInfo(inboundMessage.messageId, mediaInfoRecord);
            } else if (isDetectableMedia) {
              mediaInfoRecord = this.buildMediaMetadataMissingInfo(inboundMessage.messageType, existingConversation.glpiTicketId);
              await this.messageRepository.updateMediaInfo(inboundMessage.messageId, mediaInfoRecord);
              logger.error(
                {
                  message_id: inboundMessage.messageId,
                  message_type: inboundMessage.messageType,
                  conversation_id: existingConversation.id,
                  ticket_id: existingConversation.glpiTicketId,
                  correlation_id: correlationId,
                  event_type: 'MEDIA_REJECTED',
                  status: 'failed',
                  has_media_processing_service: this.mediaProcessingService !== null,
                  has_media_metadata: inboundMessage.mediaMetadata !== null,
                },
                '[integration-service][media][ERROR]',
              );
              this.recordAudit({
                correlationId,
                ticketId: existingConversation.glpiTicketId,
                conversationId: existingConversation.id,
                messageId: inboundMessage.messageId,
                direction: 'inbound',
                eventType: 'MEDIA_REJECTED',
                status: 'failed',
                severity: 'warning',
                source: 'InboundWebhookService',
                payload: {
                  message_type: inboundMessage.messageType,
                  has_media_processing_service: this.mediaProcessingService !== null,
                  has_media_metadata: inboundMessage.mediaMetadata !== null,
                },
              });
              throw new Error('MEDIA_METADATA_MISSING');
            } else {
              followUpContent = this.buildFollowUpContent(contact, inboundMessage);
            }

            try {
              await this.glpiClient.addFollowUp({
                ticketId: existingConversation.glpiTicketId,
                content: followUpContent,
              });
            } catch (error: unknown) {
              if (mediaInfoRecord) {
                await this.messageRepository.updateMediaInfo(
                  inboundMessage.messageId,
                  this.buildMediaFollowUpFailedInfo(mediaInfoRecord, error),
                );
              }
              throw error;
            }
            inboundGlpiStage = undefined;

            await this.conversationRepository.touch(existingConversation.id, new Date());

            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: existingConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'synced',
            });
            logger.info(
              { actionTaken: 'append', conversationId: existingConversation.id, glpiTicketId: existingConversation.glpiTicketId },
              'Inbound message appended as GLPI follow-up.',
            );
            this.recordAudit({
              correlationId,
              ticketId: existingConversation.glpiTicketId,
              conversationId: existingConversation.id,
              messageId: inboundMessage.messageId,
              direction: 'inbound',
              eventType: 'TICKET_UPDATED',
              status: 'success',
              severity: 'info',
              source: 'InboundWebhookService',
              payload: { action: 'append_followup', media_status: mediaInfoRecord?.status ?? null },
            });
            return;
          }

          if (action === 'reopen_conversation') {
            await this.conversationRepository.updateStatus(existingConversation.id, 'open');
            conversationId = existingConversation.id;
            inboundGlpiStage = 'glpi_followup_create';
            await this.glpiClient.addFollowUp({
              ticketId: existingConversation.glpiTicketId,
              content: this.buildFollowUpContent(contact, inboundMessage),
            });
            inboundGlpiStage = undefined;
            await this.conversationRepository.touch(existingConversation.id, new Date());
            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: existingConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'synced',
            });
            logger.info(
              { actionTaken: 'reopen_conversation', conversationId: existingConversation.id, glpiTicketId: existingConversation.glpiTicketId },
              'Inbound on closed conversation with open GLPI ticket: conversation reopened and follow-up added.',
            );
            return;
          }

          // action === 'new_ticket'
          if (
            conversationStatus === 'closed'
            && glpiTicketStatus === 'closed'
            && !closedConversationNoticeSent
          ) {
            await this.sendClosedConversationMessage(
              toMeta,
              existingConversation.id,
              existingConversation.glpiTicketId,
            );
          }

          if (conversationStatus !== 'closed') {
            await this.conversationRepository.updateStatus(existingConversation.id, 'closed');
          }
          inboundGlpiStage = 'glpi_ticket_create';
          const newTicketPayload = this.buildNewTicketPayload(contact, inboundMessage);
          const newTicketId = await this.glpiClient.createTicket({
            title: newTicketPayload.title,
            content: newTicketPayload.content,
            requesterPhone: contact.phoneE164,
            requesterName: contact.name,
          });
          this.logTicketCreatedWithFallback(contact, inboundMessage.messageId, newTicketId);
          inboundGlpiStage = undefined;

          const newConversation = await this.conversationRepository.create({
            phoneE164: contact.phoneE164,
            contactId: contact.id,
            glpiTicketId: newTicketId,
            status: 'open',
            lastMessageAt: new Date(),
          });
          conversationId = newConversation.id;
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: newConversation.id,
            processingStatus: 'processed',
            glpiSyncStatus: 'synced',
          });
          logger.info(
            { actionTaken: 'new_ticket', oldConversationId: existingConversation.id, newConversationId: newConversation.id, newGlpiTicketId: newTicketId },
            'Inbound on closed conversation+ticket: new GLPI ticket and conversation created.',
          );
          this.recordAudit({
            correlationId,
            ticketId: newTicketId,
            conversationId: newConversation.id,
            messageId: inboundMessage.messageId,
            direction: 'inbound',
            eventType: 'TICKET_CREATED',
            status: 'success',
            severity: 'info',
            source: 'InboundWebhookService',
            payload: { action: 'new_ticket', old_conversation_id: existingConversation.id },
          });
          return;
        }

        // ── Conversa ativa sem ticket → criar e vincular ──
        if (activeConversation && !activeConversation.glpiTicketId) {
          inboundGlpiStage = 'glpi_ticket_create';
          const ticketPayload = this.buildNewTicketPayload(contact, inboundMessage);
          const ticketId = await this.glpiClient.createTicket({
            title: ticketPayload.title,
            content: ticketPayload.content,
            requesterPhone: contact.phoneE164,
            requesterName: contact.name,
          });
          this.logTicketCreatedWithFallback(contact, inboundMessage.messageId, ticketId);
          inboundGlpiStage = undefined;

          const linked = await this.conversationRepository.linkGlpiTicket(activeConversation.id, ticketId);
          if (!linked) {
            logger.warn(
              {
                conversation_id: activeConversation.id,
                glpi_ticket_id: ticketId,
              },
              '[integration-service][routing][DUPLICATE_PREVENTED]',
            );
            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: activeConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'synced',
            });
            return;
          }
          await this.conversationRepository.touch(activeConversation.id, new Date());
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: activeConversation.id,
            processingStatus: 'processed',
            glpiSyncStatus: 'synced',
          });
          logger.info(
            { actionTaken: 'link_ticket', conversationId: activeConversation.id, newGlpiTicketId: ticketId },
            'Inbound message linked existing conversation to a new GLPI ticket.',
          );
          this.recordAudit({
            correlationId,
            ticketId,
            conversationId: activeConversation.id,
            messageId: inboundMessage.messageId,
            direction: 'inbound',
            eventType: 'TICKET_CREATED',
            status: 'success',
            severity: 'info',
            source: 'InboundWebhookService',
            payload: { action: 'link_ticket' },
          });
          return;
        }

        // ── Nenhuma conversa (ou fechada sem ticket) → novo ticket + nova conversa ──
        inboundGlpiStage = 'glpi_ticket_create';
        const ticketPayload = this.buildNewTicketPayload(contact, inboundMessage);
        const ticketId = await this.glpiClient.createTicket({
          title: ticketPayload.title,
          content: ticketPayload.content,
          requesterPhone: contact.phoneE164,
          requesterName: contact.name,
        });
        this.logTicketCreatedWithFallback(contact, inboundMessage.messageId, ticketId);
        inboundGlpiStage = undefined;

        const createdConversation = await this.conversationRepository.create({
          phoneE164: contact.phoneE164,
          contactId: contact.id,
          glpiTicketId: ticketId,
          status: 'open',
          lastMessageAt: new Date(),
        });
        conversationId = createdConversation.id;
        await this.messageRepository.updateState({
          messageId: inboundMessage.messageId,
          conversationId: createdConversation.id,
          processingStatus: 'processed',
          glpiSyncStatus: 'synced',
        });
        logger.info(
          { actionTaken: 'create_ticket', newConversationId: createdConversation.id, newGlpiTicketId: ticketId },
          'Inbound message created a new GLPI ticket and conversation.',
        );
        this.recordAudit({
          correlationId,
          ticketId,
          conversationId: createdConversation.id,
          messageId: inboundMessage.messageId,
          direction: 'inbound',
          eventType: 'TICKET_CREATED',
          status: 'success',
          severity: 'info',
          source: 'InboundWebhookService',
          payload: { action: 'create_ticket' },
        });
      });

      inboundGlpiStage = undefined;
      await this.webhookEventRepository.updateStatus(inboundMessage.eventId, 'processed');

      return {
        messageId: inboundMessage.messageId,
        outcome: 'processed',
      };
    } catch (error: unknown) {
      logger.error(
        {
          messageId: inboundMessage.messageId,
          conversationId,
          phoneE164,
          correlation_id: correlationId,
          event_type: 'GLPI_SYNC_FAILED',
          status: 'failed',
          ...serializeInboundFailure(error, inboundGlpiStage),
        },
        'Inbound message failed during GLPI synchronization (conversation status was not set to pending_glpi).',
      );
      this.recordAudit({
        correlationId,
        conversationId,
        messageId: inboundMessage.messageId,
        direction: 'inbound',
        eventType: 'GLPI_SYNC_FAILED',
        status: 'failed',
        severity: 'error',
        source: 'InboundWebhookService',
        errorMessage: error instanceof Error ? error.message : String(error),
        payload: { stage: inboundGlpiStage ?? 'unknown' },
      });

      await this.messageRepository.updateState({
        messageId: inboundMessage.messageId,
        conversationId: conversationId ?? undefined,
        processingStatus: 'failed',
        glpiSyncStatus: 'error',
      });
      await this.webhookEventRepository.updateStatus(inboundMessage.eventId, 'failed');

      return {
        messageId: inboundMessage.messageId,
        outcome: 'failed',
      };
    }
  }

  private isGlpiContactLookupFallback(contact: Contact): boolean {
    return contact.source === GLPI_CONTACT_LOOKUP_FALLBACK_SOURCE;
  }

  private buildNewTicketPayload(
    contact: Contact,
    inboundMessage: ParsedMetaInboundMessage,
  ): { title: string; content: string } {
    if (!this.isGlpiContactLookupFallback(contact)) {
      return {
        title: `WhatsApp inbound ${contact.phoneE164}`,
        content: inboundMessage.messageText ?? `[${inboundMessage.messageType}]`,
      };
    }

    return {
      title: `[PoC fallback] WhatsApp ${contact.phoneE164}`,
      content: [
        'Contato nao resolvido automaticamente no GLPI (lookup falhou neste pedido).',
        `Telefone do remetente: ${contact.phoneE164}`,
        `Nome utilizado: ${contact.name ?? '(n/d)'}`,
        '',
        'Mensagem original:',
        inboundMessage.messageText ?? `[${inboundMessage.messageType}]`,
      ].join('\n'),
    };
  }

  private buildFollowUpContent(contact: Contact, inboundMessage: ParsedMetaInboundMessage): string {
    const contentLines = [
      'Mensagem recebida via WhatsApp',
      '',
      `Telefone: ${contact.phoneE164}`,
      `Nome: ${contact.name ?? '(n/d)'}`,
      'Origem: WhatsApp',
      'Texto:',
      inboundMessage.messageText ?? `[${inboundMessage.messageType}]`,
    ];

    if (this.isGlpiContactLookupFallback(contact)) {
      contentLines.unshift('Contato nao resolvido automaticamente no GLPI.', '');
    }

    return contentLines.join('\n');
  }

  private buildMediaFollowUpFailedInfo(
    mediaInfo: Record<string, unknown>,
    error: unknown,
  ): Record<string, unknown> {
    const safeMessage = error instanceof Error ? error.message : String(error);

    return {
      ...mediaInfo,
      status: 'error',
      stage: 'followup_failed',
      error: {
        code: 'GLPI_FOLLOWUP_FAILED',
        message: safeMessage.slice(0, 240),
      },
      processed_at: new Date().toISOString(),
    };
  }

  private buildMediaMetadataMissingInfo(messageType: string, ticketId: number): Record<string, unknown> {
    return {
      status: 'error',
      stage: 'metadata_missing',
      provider: 'meta_whatsapp',
      media_id: 'unknown',
      message_type: messageType,
      mime_type: 'unknown',
      download_content_type: null,
      file_name: `${messageType || 'media'}`,
      file_size: 0,
      caption: null,
      glpi_document_id: null,
      glpi_ticket_id: ticketId,
      error: {
        code: 'MEDIA_METADATA_MISSING',
        message: 'Payload de midia sem identificador Meta para download.',
      },
      processed_at: new Date().toISOString(),
    };
  }

  private parseSolutionButtonAction(messageText: string | null): ParsedSolutionButtonAction | null {
    const value = messageText?.trim() ?? '';
    const match = /^(solution_approve|solution_reopen):(\d+):(.+)$/.exec(value);
    if (!match) {
      return null;
    }

    const ticketId = Number.parseInt(match[2], 10);
    const conversationId = match[3].trim();
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0 || conversationId.length === 0) {
      return null;
    }

    return {
      action: match[1] === 'solution_approve' ? 'approve' : 'reopen',
      ticketId,
      conversationId,
    };
  }

  private async handleSolutionButtonAction(input: {
    action: ParsedSolutionButtonAction;
    contact: Contact;
    inboundMessage: ParsedMetaInboundMessage;
    toMeta: string;
    correlationId: string;
  }): Promise<void> {
    if (this.solutionActionRepository === null) {
      throw new Error('SOLUTION_ACTION_REPOSITORY_NOT_CONFIGURED');
    }

    const conversation = await this.conversationRepository.findByIdAndGlpiTicketId(
      input.action.conversationId,
      input.action.ticketId,
    );

    if (
      conversation === null
      || InboundWebhookService.digitsOnlyForMeta(conversation.phoneE164)
        !== InboundWebhookService.digitsOnlyForMeta(input.contact.phoneE164)
    ) {
      await this.sendExpiredSolutionActionMessage(input.toMeta, input.action);
      await this.messageRepository.updateState({
        messageId: input.inboundMessage.messageId,
        conversationId: conversation?.id ?? undefined,
        processingStatus: 'processed',
        glpiSyncStatus: 'synced',
      });
      logger.warn(
        {
          ticket_id: input.action.ticketId,
          conversation_id: input.action.conversationId,
          sender_phone: input.contact.phoneE164,
          reason: conversation === null ? 'conversation_not_found' : 'phone_mismatch',
        },
        '[integration-service][solution][STALE_OR_INVALID]',
      );
      return;
    }

    const actionKey = `solution:${input.action.action}:${input.action.ticketId}:${conversation.id}`;

    await this.keyLock.withLock(`solution_action:${input.action.ticketId}`, async () => {
      const ticket = await this.glpiClient.getTicket(input.action.ticketId);
      const reserved = await this.solutionActionRepository?.reserveAction({
        actionKey,
        whatsappMessageId: input.inboundMessage.messageId,
        ticketId: input.action.ticketId,
        conversationId: conversation.id,
        phoneE164: conversation.phoneE164,
        action: input.action.action,
        previousTicketStatus: ticket.status,
      });

      if (!reserved?.reserved) {
        logger.info(
          {
            ticket_id: input.action.ticketId,
            conversation_id: conversation.id,
            action: input.action.action,
            action_key: actionKey,
            existing_status: reserved?.action.status ?? null,
          },
          '[integration-service][solution][DUPLICATE]',
        );
        return;
      }

      const successfulAction = await this.solutionActionRepository?.findSuccessfulAction(actionKey);
      if (successfulAction !== null && successfulAction !== undefined && successfulAction.id !== reserved.action.id) {
        await this.solutionActionRepository?.markIgnored(
          reserved.action.id,
          'SOLUTION_ACTION_DUPLICATE',
          'A successful solution action already exists for this ticket and conversation.',
        );
        logger.info(
          {
            ticket_id: input.action.ticketId,
            conversation_id: conversation.id,
            action: input.action.action,
            action_key: actionKey,
            previous_action_id: successfulAction.id,
            action_id: reserved.action.id,
          },
          '[integration-service][solution][DUPLICATE]',
        );
        return;
      }

      if (ticket.status !== GLPI_STATUS_SOLVED) {
        await this.solutionActionRepository?.markIgnored(
          reserved.action.id,
          'GLPI_TICKET_STATUS_INVALID',
          `Ticket status ${ticket.status ?? 'unknown'} is not SOLVED.`,
        );
        await this.sendExpiredSolutionActionMessage(input.toMeta, input.action);
        logger.info(
          {
            ticket_id: input.action.ticketId,
            conversation_id: conversation.id,
            ticket_status: ticket.status,
            action: input.action.action,
          },
          '[integration-service][solution][ACTION_EXPIRED]',
        );
        return;
      }

      let solutionStage: 'glpi_solution_approve' | 'glpi_solution_reopen' | 'glpi_followup_create' = 'glpi_solution_approve';
      try {
        if (input.action.action === 'approve') {
          solutionStage = 'glpi_solution_approve';
          const auditContent = this.buildSolutionActionFollowUpContent(input.contact, conversation.id, 'approve');
          await this.glpiClient.approveTicketSolution(input.action.ticketId, auditContent);
          await this.conversationRepository.updateStatus(conversation.id, 'closed');
          await this.conversationRepository.touch(conversation.id, new Date());
          await this.solutionActionRepository?.markSuccess(reserved.action.id, GLPI_STATUS_CLOSED);
          this.recordAudit({
            correlationId: input.correlationId,
            ticketId: input.action.ticketId,
            conversationId: conversation.id,
            messageId: input.inboundMessage.messageId,
            direction: 'inbound',
            eventType: 'TICKET_CLOSED',
            status: 'success',
            severity: 'info',
            source: 'InboundWebhookService',
            payload: { action: 'solution_approve' },
          });
          logger.info(
            {
              ticket_id: input.action.ticketId,
              conversation_id: conversation.id,
              action_id: reserved.action.id,
            },
            '[integration-service][solution][APPROVED]',
          );
        } else {
          solutionStage = 'glpi_solution_reopen';
          const auditContent = this.buildSolutionActionFollowUpContent(input.contact, conversation.id, 'reopen');
          await this.glpiClient.reopenTicketSolution(input.action.ticketId, auditContent);
          await this.conversationRepository.reopenConversation(conversation.id);
          await this.conversationRepository.touch(conversation.id, new Date());
          await this.solutionActionRepository?.markSuccess(reserved.action.id, GLPI_STATUS_PROCESSING);
          this.recordAudit({
            correlationId: input.correlationId,
            ticketId: input.action.ticketId,
            conversationId: conversation.id,
            messageId: input.inboundMessage.messageId,
            direction: 'inbound',
            eventType: 'TICKET_UPDATED',
            status: 'success',
            severity: 'info',
            source: 'InboundWebhookService',
            payload: { action: 'solution_reopen' },
          });
          await this.sendSolutionActionConfirmation(input.toMeta, input.action);
          logger.info(
            {
              ticket_id: input.action.ticketId,
              conversation_id: conversation.id,
              action_id: reserved.action.id,
            },
            '[integration-service][solution][REOPENED]',
          );
        }
      } catch (error: unknown) {
        const errorCode = this.classifySolutionActionError(solutionStage);
        await this.solutionActionRepository?.markError(
          reserved.action.id,
          errorCode,
          error instanceof Error ? error.message : String(error),
        );
        logger.error(
          {
            ticket_id: input.action.ticketId,
            conversation_id: conversation.id,
            action: input.action.action,
            action_id: reserved.action.id,
            error_code: errorCode,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][solution][ERROR]',
        );
        this.recordAudit({
          correlationId: input.correlationId,
          ticketId: input.action.ticketId,
          conversationId: conversation.id,
          messageId: input.inboundMessage.messageId,
          direction: 'inbound',
          eventType: input.action.action === 'approve' ? 'TICKET_CLOSED' : 'TICKET_UPDATED',
          status: 'failed',
          severity: 'error',
          source: 'InboundWebhookService',
          errorMessage: error instanceof Error ? error.message : String(error),
          payload: {
            action: input.action.action === 'approve' ? 'solution_approve' : 'solution_reopen',
            error_code: errorCode,
          },
        });

        if (input.action.action === 'reopen') {
          await this.metaClient.sendTextMessage({
            to: input.toMeta,
            body: 'Não conseguimos concluir sua ação agora. Tente novamente mais tarde.',
          });
        }
      }
    });

    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  }

  private async sendExpiredSolutionActionMessage(
    toMeta: string,
    action: ParsedSolutionButtonAction,
  ): Promise<void> {
    await this.metaClient.sendTextMessage({
      to: toMeta,
      body: 'Esta ação não está mais disponível para este chamado.',
    });
    logger.info(
      {
        ticket_id: action.ticketId,
        conversation_id: action.conversationId,
        action: action.action,
      },
      '[integration-service][solution][EXPIRED_MESSAGE_SENT]',
    );
  }

  private buildSolutionActionFollowUpContent(
    contact: Contact,
    conversationId: string,
    action: SolutionButtonAction,
  ): string {
    const actionText = action === 'approve'
      ? 'Cliente aprovou a solução via WhatsApp.'
      : 'Cliente solicitou reabertura via WhatsApp.';

    return [
      actionText,
      '',
      `Telefone: ${contact.phoneE164}`,
      `Conversation ID: ${conversationId}`,
      `Ação: ${action}`,
      'Origem: WhatsApp',
    ].join('\n');
  }

  private classifySolutionActionError(
    stage: 'glpi_solution_approve' | 'glpi_solution_reopen' | 'glpi_followup_create',
  ): 'GLPI_TICKET_UPDATE_FAILED' | 'GLPI_REOPEN_FAILED' | 'GLPI_FOLLOWUP_FAILED' {
    if (stage === 'glpi_solution_approve') {
      return 'GLPI_TICKET_UPDATE_FAILED';
    }

    if (stage === 'glpi_solution_reopen') {
      return 'GLPI_REOPEN_FAILED';
    }

    return 'GLPI_FOLLOWUP_FAILED';
  }

  private async sendSolutionActionConfirmation(
    toMeta: string,
    action: ParsedSolutionButtonAction,
  ): Promise<void> {
    try {
      await this.metaClient.sendTextMessage({
        to: toMeta,
        body: `Seu chamado #${action.ticketId} foi reaberto com sucesso.`,
      });
    } catch (error: unknown) {
      logger.error(
        {
          ticket_id: action.ticketId,
          conversation_id: action.conversationId,
          action: action.action,
          error_code: 'WHATSAPP_CONFIRMATION_FAILED',
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][solution][CONFIRMATION_ERROR]',
      );
    }
  }

  private resolveSelectedRoutingOption(
    inboundMessage: ParsedMetaInboundMessage,
    menuResponseText: string,
    routingOptions: ActiveRoutingOption[],
  ): { selectedOption: ActiveRoutingOption; choice: number | null } | null {
    if (inboundMessage.messageType === 'interactive') {
      const selectedOptionKey = menuResponseText.trim();
      if (!selectedOptionKey) {
        return null;
      }

      const selectedOption = routingOptions.find((option) => option.optionKey === selectedOptionKey);
      return selectedOption ? { selectedOption, choice: null } : null;
    }

    const choice = parseMenuDigitChoice(menuResponseText, routingOptions.length);
    if (choice === null) {
      return null;
    }

    return {
      selectedOption: routingOptions[choice - 1],
      choice,
    };
  }

  private async sendRoutingMenu(input: RoutingMenuSendInput): Promise<void> {
    const textBody = input.prefixText
      ? `${input.prefixText.trim()}\n\n${input.menuBody}`
      : input.menuBody;

    const interactiveBody = input.prefixText
      ? `${input.prefixText.trim()}\n\n${input.menuHeading.trim()}`
      : input.menuHeading.trim();

    const sendReplyButtons = (this.metaClient as unknown as {
      sendReplyButtons?: (
        to: string,
        bodyText: string,
        buttons: Array<{ id: string; title: string }>,
      ) => Promise<unknown>;
    }).sendReplyButtons;

    const canSendInteractive =
      input.routingOptions.length >= 1
      && input.routingOptions.length <= 3
      && typeof sendReplyButtons === 'function'
      && input.routingOptions.every((option) => option.optionKey.trim() !== '');

    if (canSendInteractive) {
      try {
        await sendReplyButtons.call(
          this.metaClient,
          input.toMeta,
          interactiveBody,
          input.routingOptions.map((option) => ({
            id: option.optionKey,
            title: option.label,
          })),
        );
        logger.info(
          {
            conversation_id: input.conversationId ?? null,
            context: input.context,
            options_count: input.routingOptions.length,
          },
          '[integration-service][routing][INTERACTIVE_MENU_SENT]',
        );
        return;
      } catch (error: unknown) {
        logger.warn(
          {
            conversation_id: input.conversationId ?? null,
            context: input.context,
            options_count: input.routingOptions.length,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][routing][INTERACTIVE_MENU_FALLBACK_TEXT]',
        );
      }
    }

    await this.metaClient.sendTextMessage({ to: input.toMeta, body: textBody });
  }

  private recordAudit(input: Parameters<AuditService['recordAuditEventFireAndForget']>[0]): void {
    this.auditService?.recordAuditEventFireAndForget(input);
  }

  private static digitsOnlyForMeta(phoneE164: string): string {
    return phoneE164.replace(/\D/g, '');
  }

  private async sendClosedConversationMessage(
    toMeta: string,
    conversationId: string,
    glpiTicketId: number,
  ): Promise<void> {
    const message = await this.settingsService.getMessage('conversation_closed_message');
    await this.metaClient.sendTextMessage({ to: toMeta, body: message });
    logger.info(
      {
        conversation_id: conversationId,
        glpi_ticket_id: glpiTicketId,
      },
      '[integration-service][routing][CLOSED_CONVERSATION_MESSAGE_SENT]',
    );
  }

  private async buildTicketCreatedConfirmation(
    selectedOption: ActiveRoutingOption,
    ticketId: number,
  ): Promise<string> {
    const optionTemplate = selectedOption.confirmationMessage?.trim();
    const template = optionTemplate
      || await this.settingsService.getMessage('ticket_created_message');

    return template.replace(/\{ticket_id\}/g, String(ticketId));
  }

  private logTicketCreatedWithFallback(contact: Contact, messageId: string, ticketId: number): void {
    if (!this.isGlpiContactLookupFallback(contact)) {
      return;
    }

    logger.info(
      {
        messageId,
        stage: 'glpi_ticket_create',
        fallbackContactLookup: true,
        ticketId,
        phoneE164: contact.phoneE164,
      },
      '[PoC] Ticket GLPI criado em modo fallback (lookup de contato falhou).',
    );
  }
}
