import type { MetaWebhookPayload, ParsedMetaInboundMessage } from '../../adapters/meta/metaWebhookTypes.js';
import type { MediaProcessingService } from './MediaProcessingService.js';
import type { MetaClient } from '../../adapters/meta/MetaClient.js';
import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import type { CreateGlpiTicketInput, GlpiEntityOption } from '../../adapters/glpi/glpiTypes.js';
import type { Contact } from '../entities/Contact.js';
import type { Conversation } from '../entities/Conversation.js';
import type { ConversationRepository } from '../../repositories/contracts/ConversationRepository.js';
import type { MessageRepository } from '../../repositories/contracts/MessageRepository.js';
import type { WebhookEventRepository } from '../../repositories/contracts/WebhookEventRepository.js';
import type { ActiveRoutingOption, RoutingRepository } from '../../repositories/contracts/RoutingRepository.js';
import type { CsatRating, SolutionActionRepository } from '../../repositories/contracts/SolutionActionRepository.js';
import type { ContactEntityMemory, ContactEntityMemoryRepository } from '../repositories/ContactEntityMemoryRepository.js';

import { logger } from '../../infra/logger/logger.js';
import { serializeInboundFailure } from '../../infra/logger/serializeInboundFailure.js';
import { parseMetaInboundMessages, parseMetaStatusUpdates } from '../../adapters/meta/parseMetaWebhookPayload.js';
import { ContactResolutionService } from './ContactResolutionService.js';
import type { ScheduleService } from './ScheduleService.js';
import type { GlpiFailureStage } from '../../errors/GlpiRequestError.js';
import type { KeyLock } from '../contracts/KeyLock.js';
import { buildMenuMessage, formatMenuOptionLabel, parseMenuDigitChoice } from './routingMenuMessage.js';
import { env } from '../../config/env.js';
import { GlpiItilCategoryNormalizer } from '../../adapters/glpi/GlpiItilCategoryNormalizer.js';
import { GlpiFormCatalogAdapter } from '../../adapters/glpi/GlpiFormCatalogAdapter.js';
import { GlpiTriageCacheRepository } from '../../cache/GlpiTriageCacheRepository.js';
import type { SettingsService } from './SettingsService.js';
import type { AuditService } from './AuditService.js';
import type { ContactEntityResolutionService } from './ContactEntityResolutionService.js';
import type { ContactProfileCollectionState, ContactProfileData, ContactProfileService } from './ContactProfileService.js';
import type { CustomerExperienceService } from './CustomerExperienceService.js';
import type { MessageConfigurationService, MessageSendPlan } from './MessageConfigurationService.js';
import type { BusinessHoursService } from './BusinessHoursService.js';
import { hasValidGlpiTicketId } from './EntitySelectionService.js';
import { createCorrelationId } from './correlationId.js';
import type { GlpiCategoryClassifierService } from './GlpiCategoryClassifierService.js';
import type { AssetContextSummaryService } from './AssetContextSummaryService.js';
import type { LogmeinReadonlyCacheRepository } from './LogmeinReadonlyContextService.js';

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
const ENTITY_SELECTION_PENDING_MESSAGE =
  'Recebemos as suas informações, em breve um de nossos técnicos irá seguir com o atendimento.';
const PRETICKET_INVALID_INPUT_EVENT_KEY = 'preticket_invalid_input';
const PRETICKET_INVALID_INPUT_TEXT =
  'Neste momento preciso que você responda em texto. Envie uma breve descrição do problema.';
const PRETICKET_INVALID_REASON_INPUT_TEXT =
  'Neste momento preciso que você responda em texto. Envie uma breve descrição do problema.';
const PRETICKET_CANCEL_HINT =
  'Se quiser encerrar este atendimento, digite cancelar a qualquer momento.';
const PRETICKET_USER_CANCELLED_EVENT_KEY = 'preticket_cancelled_by_user';
const CSAT_THANK_YOU_CLOSURE_EVENT_KEY = 'csat_thank_you_closure';
const CSAT_THANK_YOU_CLOSURE_TEXT = 'Seu chamado foi encerrado. Obrigado pela avaliação.';
const PRETICKET_USER_CANCELLED_TEXT =
  'Atendimento cancelado. Nenhum chamado foi aberto. Se precisar, inicie um novo atendimento.';
const PRETICKET_CANCEL_WORDS = new Set(['cancelar', 'sair', 'encerrar']);
const OPEN_TICKET_USER_CANCELLED_CONTENT =
  'Cliente solicitou cancelamento via WhatsApp. Atendimento encerrado conforme solicitacao do cliente.';
const PRETICKET_BLOCKED_INPUT_TYPES = new Set(['image', 'audio', 'voice', 'video', 'document', 'sticker', 'location', 'contacts', 'contact']);
const REOPEN_REASON_OPTIONS: Array<{ key: ReopenReasonKey; eventKey: string; fallback: string }> = [
  { key: 'problem_persists', eventKey: 'reopen_reason_problem_persists', fallback: 'O problema permanece' },
  { key: 'missing_work', eventKey: 'reopen_reason_missing_work', fallback: 'Ficou faltando algo' },
  { key: 'not_understood', eventKey: 'reopen_reason_not_understood', fallback: 'Não entendi a solução' },
  { key: 'other', eventKey: 'reopen_reason_other', fallback: 'Outro motivo' },
];

interface RoutingMenuSendInput {
  toMeta: string;
  routingOptions: ActiveRoutingOption[];
  menuHeading: string;
  menuBody: string;
  context: string;
  conversationId?: string | null;
  correlationId?: string | null;
  messageId?: string | null;
  prefixText?: string;
}

type SolutionButtonAction = 'approve' | 'reopen';
type ReopenReasonKey = 'problem_persists' | 'missing_work' | 'not_understood' | 'other';

interface ParsedSolutionButtonAction {
  action: SolutionButtonAction;
  ticketId: number;
  conversationId: string;
  csatRating: CsatRating | null;
  reopenReason: ReopenReasonKey | null;
}

interface EntitySelectionDeferralInput {
  contact: Contact;
  inboundMessage: ParsedMetaInboundMessage;
  toMeta: string;
  conversationId: string | null;
  queueId?: number | null;
  message: string;
}

interface CompletedProfileTransitionInput {
  contact: Contact;
  inboundMessage: ParsedMetaInboundMessage;
  toMeta: string;
  conversation: Conversation;
}

interface ExistingEntitySelectionWaitInput {
  contact: Contact;
  inboundMessage: ParsedMetaInboundMessage;
  toMeta: string;
  conversation: Conversation;
  correlationId?: string | null;
}

/**
 * Narrow, fire-and-forget trigger for near-real-time supervisory alert analysis.
 * The implementation MUST be non-blocking and self-contained (swallow its own errors):
 * it is invoked without await so it can never block or break inbound ingestion.
 */
export interface AiOnlineAlertInboundTrigger {
  onInboundConversationActivity(conversationId: string): void;
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
    private readonly contactEntityResolutionService: ContactEntityResolutionService | null = null,
    private readonly contactEntityMemoryRepository: ContactEntityMemoryRepository | null = null,
    private readonly contactProfileService: ContactProfileService | null = null,
    private readonly customerExperienceService: Pick<CustomerExperienceService, 'resolveGlpiRequester'> | null = null,
    private readonly messageConfigurationService: MessageConfigurationService | null = null,
    private readonly businessHoursService: BusinessHoursService | null = null,
    private readonly aiOnlineAlertTrigger: AiOnlineAlertInboundTrigger | null = null,
    private readonly categoryClassifier: GlpiCategoryClassifierService | null = null,
    /**
     * Serviço opcional de contexto de ativo.
     * Quando não-null e ASSET_CONTEXT_SUMMARY_ENABLED=true, injeta nota interna
     * no chamado GLPI após a criação. Fire-and-forget — nunca bloqueia o fluxo.
     * PHASE: integaglpi_asset_context_summary_001
     */
    private readonly assetContextSummaryService: AssetContextSummaryService | null = null,
    private readonly logmeinReadonlyRepository: Pick<LogmeinReadonlyCacheRepository, 'findHostByEquipmentTag'> | null = null,
  ) {}

  /**
   * Normalizer de triagem nativa — inicializado lazily na primeira chamada.
   * `undefined` = ainda não verificado. `null` = flag desativada.
   * Instância isolada por service para não compartilhar estado entre requests.
   * PHASE: integaglpi_v8_native_catalog_dynamic_triage_001
   */
  private _nativeTriageNormalizer: GlpiItilCategoryNormalizer | null | undefined = undefined;

  private getNativeTriageNormalizer(): GlpiItilCategoryNormalizer | null {
    if (this._nativeTriageNormalizer === undefined) {
      this._nativeTriageNormalizer = env.NATIVE_GLPI_TRIAGE_ENABLED
        ? new GlpiItilCategoryNormalizer(
            this.glpiClient,
            new GlpiTriageCacheRepository(),
            new GlpiFormCatalogAdapter(),
            env.NATIVE_GLPI_TRIAGE_SOURCES,
          )
        : null;
    }
    return this._nativeTriageNormalizer;
  }

  /**
   * Fire-and-forget: gera contexto do ativo vinculado ao chamado e injeta como nota interna.
   * Chamado SEM await após createTicket — nunca bloqueia o fluxo de atendimento.
   * PHASE: integaglpi_asset_context_summary_001
   */
  private triggerAssetContextSummary(
    ticketId: number,
    entityId: number,
    profile: import('./ContactProfileService.js').ContactProfileData | null,
    conversationId: string | null,
  ): void {
    if (this.assetContextSummaryService === null) {
      return;
    }
    const equipmentTag = profile?.equipment_tag_unknown
      ? null
      : (profile?.last_equipment_tag?.trim() ?? null);
    if (!equipmentTag) {
      // Sem etiqueta conhecida: não há ativo a consultar.
      return;
    }
    // Fire-and-forget: erros são capturados dentro do serviço; esta chamada não propaga.
    void this.assetContextSummaryService.generate({
      equipmentTag,
      entityId,
      conversationId,
      ticketId,
    }).catch(() => {
      // O serviço já loga internamente; apenas garantia de dupla-cobertura.
    });
  }

  private async resolveRoutingOptions(entityId: number | null = null): Promise<ActiveRoutingOption[]> {
    const normalizer = this.getNativeTriageNormalizer();
    if (normalizer) {
      // Flow B strict: categories are always entity-scoped — entity must be known first.
      // When entityId is unknown (null or 0), fall back to legacy parallel catalog so the
      // user can still be routed while entity is being determined via profile/asset-tag flow.
      // This guarantees getOptions() is never called with null (cross-entity contamination).
      if (entityId === null || entityId <= 0) {
        return this.routingRepository.getActiveOptions();
      }
      return normalizer.getOptions(entityId);
    }
    return this.routingRepository.getActiveOptions();
  }

  /**
   * Fire-and-forget near-real-time supervisory analysis for a conversation that just
   * received an inbound text/interactive message. Never awaited, never throws into the
   * inbound flow — read-only beyond writing supervisory alert rows (no ticket mutation,
   * no WhatsApp). Media/status messages are skipped (no textual risk signal).
   */
  private triggerInboundAlertAnalysis(
    conversationId: string | null,
    messageType: string,
  ): void {
    if (this.aiOnlineAlertTrigger === null || conversationId === null) {
      return;
    }
    if (messageType !== 'text' && messageType !== 'interactive') {
      return;
    }
    try {
      this.aiOnlineAlertTrigger.onInboundConversationActivity(conversationId);
    } catch {
      // The trigger is best-effort: a failure here must never affect ingestion.
    }
  }

  public async process(
    payload: MetaWebhookPayload,
    options: InboundWebhookProcessOptions = {},
  ): Promise<InboundWebhookServiceResult> {
    const correlationId = options.correlationId ?? createCorrelationId();
    const statusUpdates = parseMetaStatusUpdates(payload);
    const inboundMessages = parseMetaInboundMessages(payload);

    const results: InboundWebhookProcessingResult[] = [];

    for (const statusUpdate of statusUpdates) {
      const status = normalizeMetaDeliveryStatus(statusUpdate.status);
      const logContext = {
        correlation_id: correlationId,
        meta_message_id_masked: maskSensitiveId(statusUpdate.metaMessageId),
        recipient_id_masked: statusUpdate.recipientId ? maskSensitiveId(statusUpdate.recipientId) : null,
        delivery_status: statusUpdate.status.trim().toLowerCase(),
      };
      if (status === null) {
        logger.info(
          {
            ...logContext,
            event_type: 'DELIVERY_STATUS_IGNORED',
            status: 'ignored',
            reason: 'unsupported_status',
          },
          '[integration-service][delivery][DELIVERY_STATUS_IGNORED]',
        );
        continue;
      }

      logger.info(
        {
          ...logContext,
          event_type: 'DELIVERY_STATUS_RECEIVED',
          status: 'received',
        },
        '[integration-service][delivery][DELIVERY_STATUS_RECEIVED]',
      );

      const result = await this.messageRepository.recordDeliveryStatus({
        metaMessageId: statusUpdate.metaMessageId,
        status,
        errorCode: sanitizeMetaStatusErrorCode(statusUpdate.errorCode),
        errorMessageSanitized: sanitizeMetaStatusErrorMessage(statusUpdate.errorMessage),
        correlationId,
        receivedAt: statusUpdate.timestamp !== null && /^\d+$/.test(statusUpdate.timestamp)
          ? new Date(Number(statusUpdate.timestamp) * 1000)
          : new Date(),
      });

      const deliveryEventType = result.matched && result.insertedEvent
        ? 'DELIVERY_STATUS_UPDATED'
        : 'DELIVERY_STATUS_IGNORED';
      const ignoreReason = result.matched
        ? 'duplicate_status_event'
        : 'message_not_found';
      logger.info(
        {
          ...logContext,
          delivery_status: status,
          matched: result.matched,
          inserted_event: result.insertedEvent,
          current_status: result.currentStatus,
          event_type: deliveryEventType,
          status: deliveryEventType === 'DELIVERY_STATUS_UPDATED' ? 'updated' : 'ignored',
          ...(deliveryEventType === 'DELIVERY_STATUS_IGNORED' ? { reason: ignoreReason } : {}),
        },
        `[integration-service][delivery][${deliveryEventType}]`,
      );
      this.recordAudit({
        correlationId,
        messageId: statusUpdate.metaMessageId,
        direction: 'outbound',
        eventType: 'MESSAGE_DELIVERY_STATUS',
        status: result.matched ? 'success' : 'ignored',
        severity: result.matched ? 'info' : 'warning',
        source: 'InboundWebhookService',
        payload: {
          delivery_event_type: deliveryEventType,
          delivery_status: status,
          matched: result.matched,
          inserted_event: result.insertedEvent,
          current_status: result.currentStatus,
          ...(deliveryEventType === 'DELIVERY_STATUS_IGNORED' ? { reason: ignoreReason } : {}),
        },
      });

      results.push({
        messageId: statusUpdate.metaMessageId,
        outcome: 'processed',
      });
    }

    if (inboundMessages.length === 0 && statusUpdates.length === 0) {
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
      || inboundMessage.messageType === 'video'
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

        const knownEntityForTriage = typeof activeConversation?.glpiEntityId === 'number' && activeConversation.glpiEntityId > 0
          ? activeConversation.glpiEntityId
          : (await this.findRememberedEntity(contact.phoneE164))?.glpiEntityId ?? null;
        const toMeta = InboundWebhookService.digitsOnlyForMeta(contact.phoneE164);
        const resolvedRoutingOptions = await this.resolveRoutingOptions(knownEntityForTriage);
        const customerTriageMenuEnabled = env.WHATSAPP_CUSTOMER_TRIAGE_MENU_ENABLED;
        const routingOptions = customerTriageMenuEnabled ? resolvedRoutingOptions : [];
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

        const closedConversationTicketId = closedConversation && hasValidGlpiTicketId(closedConversation.glpiTicketId)
          ? Number(closedConversation.glpiTicketId)
          : null;
        if (closedConversation && closedConversationTicketId !== null) {
          inboundGlpiStage = 'glpi_ticket_read';
          knownExistingTicketStatus = await this.glpiClient.getTicketStatus(closedConversationTicketId);
          inboundGlpiStage = undefined;

          const pendingSolutionActionHandled = await this.tryHandlePendingSolutionTextAction({
            inboundMessage,
            conversation: closedConversation,
            ticketId: closedConversationTicketId,
            contact,
            toMeta,
            correlationId,
          });
          if (pendingSolutionActionHandled) {
            conversationId = closedConversation.id;
            return;
          }

          if (knownExistingTicketStatus === 'closed') {
            closedConversationNoticeSent = false;
          }
        }

        if (
          pendingGlpiOrphan
          && !hasValidGlpiTicketId(pendingGlpiOrphan.glpiTicketId)
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

        const activeProfileStep = activeConversation?.profileCollectionState
          && typeof activeConversation.profileCollectionState === 'object'
          && !Array.isArray(activeConversation.profileCollectionState)
          ? String((activeConversation.profileCollectionState as Record<string, unknown>).step ?? '')
          : '';
        const mayCarryStaleProfileState =
          activeConversation
          && !hasValidGlpiTicketId(activeConversation.glpiTicketId)
          && this.contactProfileService
          && (
            activeConversation.status === 'awaiting_entity_selection'
            || (activeConversation.status === 'collecting_contact_profile' && activeProfileStep === 'complete')
          )
          && await this.contactProfileService.isCollectionEnabled();
        if (mayCarryStaleProfileState) {
          const persistedProfile = await this.contactProfileService!.findProfile(contact.phoneE164);
          const hasUsablePersistedProfile = persistedProfile !== null
            && await this.contactProfileService!.isProfileComplete(persistedProfile);

          if (!hasUsablePersistedProfile) {
            const rawState = activeConversation.profileCollectionState;
            const queueLabel = rawState
              && typeof rawState === 'object'
              && !Array.isArray(rawState)
              && typeof (rawState as Record<string, unknown>).queue_label === 'string'
              && String((rawState as Record<string, unknown>).queue_label).trim() !== ''
                ? String((rawState as Record<string, unknown>).queue_label).trim()
                : activeConversation.queueId
                  ? `Fila ${activeConversation.queueId}`
                  : null;
            const resetState = this.contactProfileService!.startNewCollectionState(queueLabel);
            await this.conversationRepository.updateQueueAndStatus(
              activeConversation.id,
              activeConversation.queueId ?? null,
              'collecting_contact_profile',
            );
            await this.conversationRepository.updateProfileCollectionState(activeConversation.id, resetState);
            await this.conversationRepository.touch(activeConversation.id, new Date());
            await this.sendContactProfilePrompt({
              toMeta,
              body: this.contactProfileService!.getCollectionPrompt(resetState),
              state: resetState,
              conversationId: activeConversation.id,
            });
            logger.info(
              {
                conversation_id: activeConversation.id,
                previous_status: activeConversation.status,
                previous_profile_step: activeProfileStep || null,
                reason: 'missing_persisted_contact_profile',
              },
              '[integration-service][contact_profile][STALE_PROFILE_STATE_RESET]',
            );
            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: activeConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'synced',
            });
            return;
          }
        }
        if (
          activeConversation
          && !hasValidGlpiTicketId(activeConversation.glpiTicketId)
          && (
            activeConversation.status === 'awaiting_entity_selection'
            || (activeConversation.status === 'collecting_contact_profile' && activeProfileStep === 'complete')
          )
        ) {
          if (activeConversation.status === 'collecting_contact_profile' && activeProfileStep === 'complete') {
            await this.advanceCompletedProfileConversation({
              contact,
              inboundMessage,
              toMeta,
              conversation: activeConversation,
            });
            return;
          }

          await this.acknowledgeExistingEntitySelectionWait({
            contact,
            inboundMessage,
            toMeta,
            conversation: activeConversation,
            correlationId,
          });
          return;
        }

        if (activeConversation?.status !== 'open') {
          const businessHoursDecision = this.businessHoursService
            ? await this.businessHoursService.evaluate()
            : {
                enabled: true,
                isOpen: await this.scheduleService.isOpen(),
                eventKey: 'outside_business_hours_message',
                cooldownMinutes: 60,
                reason: 'legacy_schedule_service',
              };
          if (!businessHoursDecision.isOpen) {
          const eventKey = businessHoursDecision.eventKey;
          const shouldSendMessage = this.businessHoursService
            ? await this.businessHoursService.shouldSendOutsideHoursMessage(
                conversationId,
                contact.phoneE164,
                eventKey,
                businessHoursDecision.cooldownMinutes,
              )
            : this.scheduleService.shouldSendAfterHoursMessage(contact.phoneE164);

          if (shouldSendMessage) {
            await this.sendOutsideBusinessHoursMessage({
              eventKey,
              toMeta,
              contactPhone: contact.phoneE164,
              conversationId,
              correlationId,
            });
          } else {
            await this.messageConfigurationService?.recordAutomationEvent({
              conversationId,
              phoneE164: contact.phoneE164,
              eventKey,
              status: 'not_sent_by_rule',
              reason: 'cooldown',
            });
          }

          logger.info(
            {
              phone_e164: contact.phoneE164,
              conversation_id: conversationId,
              conversation_status: existingConversation?.status ?? null,
              message_sent: shouldSendMessage,
              reason: businessHoursDecision.reason,
            },
            '[business_hours][OUT_OF_HOURS]',
          );
          }
        }

        const isDetectableMedia =
          inboundMessage.messageType === 'image'
          || inboundMessage.messageType === 'document'
          || inboundMessage.messageType === 'audio'
          || inboundMessage.messageType === 'video';

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
          activeConversation?.status === 'open' && hasValidGlpiTicketId(activeConversation.glpiTicketId);
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

        if (
          activeConversation?.status === 'awaiting_entity_selection'
          && !hasValidGlpiTicketId(activeConversation.glpiTicketId)
        ) {
          const cancelled = await this.tryCancelPreTicketFromInbound({
            contact,
            conversation: activeConversation,
            inboundMessage,
            toMeta,
            correlationId,
            state: activeConversation.profileCollectionState ?? null,
          });
          if (cancelled) {
            return;
          }

          if (this.shouldRejectPreTicketInput(inboundMessage)) {
            await this.handleInvalidPreTicketInput({
              contact,
              conversation: activeConversation,
              inboundMessage,
              toMeta,
              correlationId,
              state: activeConversation.profileCollectionState ?? null,
            });
            return;
          }
        }

        const categoryClassificationActive =
          customerTriageMenuEnabled
          && env.AI_CATEGORY_CLASSIFICATION_ENABLED
          && Boolean(this.categoryClassifier);

        if (
          activeConversation?.status === 'awaiting_category_confirmation'
          && !categoryClassificationActive
        ) {
          await this.handleCategoryDisabledProblemDescription({
            contact,
            conversation: activeConversation,
            inboundMessage,
            toMeta,
            routingOptions,
            menuHeading,
            menuBody,
          });
          return;
        }

        // ── AI Category Classification: awaiting_problem_description ──────────────
        // PHASE: integaglpi_ai_category_classification_001
        // Flag off: accept the problem summary and continue without customer category menus.
        if (activeConversation?.status === 'awaiting_problem_description') {
          const descriptionText = inboundMessage.messageText?.trim() ?? '';
          if (!descriptionText) {
            // Empty/media — ask again
            await this.metaClient.sendTextMessage({
              to: toMeta,
              body: 'Por favor, descreva o problema em texto para que eu possa te ajudar melhor.',
            });
            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: activeConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'synced',
            });
            return;
          }

          if (!categoryClassificationActive) {
            await this.handleCategoryDisabledProblemDescription({
              contact,
              conversation: activeConversation,
              inboundMessage,
              toMeta,
              routingOptions,
              menuHeading,
              menuBody,
            });
            return;
          }

          const classifierEntityId = activeConversation.glpiEntityId ?? knownEntityForTriage;
          if (!classifierEntityId || classifierEntityId <= 0 || !this.categoryClassifier) {
            // No entity or classifier not wired — fall back to menu
            await this.conversationRepository.updateStatus(activeConversation.id, 'awaiting_queue_selection');
            await this.sendRoutingMenu({ toMeta, routingOptions, menuHeading, menuBody, context: 'ai_fallback_no_entity', conversationId: activeConversation.id });
            await this.messageRepository.updateState({ messageId: inboundMessage.messageId, conversationId: activeConversation.id, processingStatus: 'processed', glpiSyncStatus: 'synced' });
            return;
          }

          let classResult;
          try {
            classResult = await this.categoryClassifier.classify(descriptionText, routingOptions, classifierEntityId);
          } catch {
            classResult = null;
          }

          this.recordAudit({
            eventType: 'CATEGORY_CLASSIFICATION_DECISION',
            conversationId: activeConversation.id,
            status: 'success',
            severity: 'info',
            source: 'InboundWebhookService',
            payload: {
              entity_id: classifierEntityId,
              category_id: classResult?.categoryId ?? null,
              category_name: classResult?.categoryName ?? null,
              confidence: classResult?.confidence ?? 0,
              classification_source: classResult?.source ?? 'fallback',
              reason: classResult?.reason ?? 'classifier_error',
              requires_confirmation: classResult?.requiresConfirmation ?? false,
              fallback_required: classResult?.fallbackRequired ?? true,
              description_hash: descriptionText.slice(0, 60).replace(/./g, '#'),
              ai_cloud: false,
            },
          });

          // High confidence: apply directly.
          if (classResult && !classResult.fallbackRequired && !classResult.requiresConfirmation && classResult.categoryId) {
            const selectedCat = routingOptions.find((o) => o.glpiItilCategoryId === classResult.categoryId);
            if (selectedCat) {
              await this.conversationRepository.updateStatus(activeConversation.id, 'awaiting_queue_selection');
              await this.handleCategoryAutoApplied({ option: selectedCat, conversation: activeConversation, toMeta, inboundMessage, contact, correlationId, entityId: classifierEntityId, routingOptions, menuHeading, menuBody });
              return;
            }
          }

          // Medium confidence: ask confirmation.
          if (classResult && classResult.requiresConfirmation && classResult.categoryId && classResult.categoryName) {
            const confirmMsg = `Parece ser: *${classResult.categoryName}*.\nPosso seguir com essa categoria? Responda:\n1 - Sim\n2 - Não`;
            await this.metaClient.sendTextMessage({ to: toMeta, body: confirmMsg });
            // Persist candidate in profileCollectionState (flexible JSONB).
            const existingState = (activeConversation.profileCollectionState ?? {}) as Record<string, unknown>;
            await this.conversationRepository.updateProfileCollectionState(activeConversation.id, {
              ...existingState,
              ai_category_candidate_id: classResult.categoryId,
              ai_category_candidate_name: classResult.categoryName,
              ai_category_confidence: classResult.confidence,
              ai_category_source: classResult.source,
            });
            await this.conversationRepository.updateStatus(activeConversation.id, 'awaiting_category_confirmation');
            await this.messageRepository.updateState({ messageId: inboundMessage.messageId, conversationId: activeConversation.id, processingStatus: 'processed', glpiSyncStatus: 'synced' });
            return;
          }

          // Low confidence / fallback: show menu.
          await this.conversationRepository.updateStatus(activeConversation.id, 'awaiting_queue_selection');
          await this.sendRoutingMenu({
            toMeta,
            routingOptions,
            menuHeading,
            menuBody,
            context: 'ai_low_confidence',
            conversationId: activeConversation.id,
            prefixText: 'Não consegui identificar a categoria com segurança. Escolha uma opção:',
          });
          await this.messageRepository.updateState({ messageId: inboundMessage.messageId, conversationId: activeConversation.id, processingStatus: 'processed', glpiSyncStatus: 'synced' });
          return;
        }

        // ── AI Category Classification: awaiting_category_confirmation ────────────
        if (activeConversation?.status === 'awaiting_category_confirmation') {
          const rawChoice = inboundMessage.messageText?.trim() ?? '';
          const parsed = parseMenuDigitChoice(rawChoice, 2);
          if (parsed === 1) {
            // User confirmed — apply the candidate category.
            const rawState = (activeConversation.profileCollectionState ?? {}) as Record<string, unknown>;
            const candidateId = typeof rawState.ai_category_candidate_id === 'number' ? rawState.ai_category_candidate_id : null;
            const candidateName = typeof rawState.ai_category_candidate_name === 'string' ? rawState.ai_category_candidate_name : null;
            const confirmedOption = candidateId ? routingOptions.find((o) => o.glpiItilCategoryId === candidateId) : null;

            this.recordAudit({
              eventType: 'CATEGORY_CLASSIFICATION_CONFIRMED',
              conversationId: activeConversation.id,
              status: 'success',
              severity: 'info',
              source: 'InboundWebhookService',
              payload: { category_id: candidateId, category_name: candidateName, user_response: 1, ai_cloud: false },
            });

            if (confirmedOption) {
              await this.conversationRepository.updateStatus(activeConversation.id, 'awaiting_queue_selection');
              await this.handleCategoryAutoApplied({ option: confirmedOption, conversation: activeConversation, toMeta, inboundMessage, contact, correlationId, entityId: activeConversation.glpiEntityId ?? knownEntityForTriage ?? 0, routingOptions, menuHeading, menuBody });
              return;
            }
            // Category no longer valid — fall through to menu.
          }

          if (parsed === 2 || !parsed) {
            this.recordAudit({
              eventType: 'CATEGORY_CLASSIFICATION_REJECTED',
              conversationId: activeConversation.id,
              status: 'success',
              severity: 'info',
              source: 'InboundWebhookService',
              payload: {
                // Never log rawChoice text — may contain PII.
                user_response: parsed === 2 ? 2 : null,
                choice_type: parsed === 2 ? 'numeric_no' : (!rawChoice ? 'empty' : 'non_numeric_or_out_of_range'),
                reason: 'invalid_confirmation_input',
                ai_cloud: false,
              },
            });
          }

          // Reject or invalid input: show manual menu.
          await this.conversationRepository.updateStatus(activeConversation.id, 'awaiting_queue_selection');
          await this.sendRoutingMenu({ toMeta, routingOptions, menuHeading, menuBody, context: 'ai_category_rejected', conversationId: activeConversation.id });
          await this.messageRepository.updateState({ messageId: inboundMessage.messageId, conversationId: activeConversation.id, processingStatus: 'processed', glpiSyncStatus: 'synced' });
          return;
        }

        if (activeConversation?.status === 'collecting_contact_profile') {
          if (!this.contactProfileService) {
            await this.metaClient.sendTextMessage({
              to: toMeta,
              body: 'Tivemos uma instabilidade ao coletar seus dados. Tente novamente mais tarde.',
            });
            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: activeConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'error',
            });
            return;
          }

          const profileText = inboundMessage.messageText?.trim();
          const existingProfile = await this.contactProfileService.findProfile(contact.phoneE164);
          const reliableExistingProfile = this.contactProfileService.isReliableForConfirmation(existingProfile)
            ? existingProfile
            : null;
          const rawState = activeConversation.profileCollectionState;
          const hasPersistedState = Boolean(
            rawState
            && typeof rawState === 'object'
            && !Array.isArray(rawState)
            && Object.keys(rawState).length > 0,
          );
          const collectionState = hasPersistedState
            ? this.contactProfileService.normalizeCollectionState(rawState)
            : reliableExistingProfile
              ? this.contactProfileService.startExistingProfileConfirmationState(reliableExistingProfile)
              : this.contactProfileService.startNewCollectionState();

          const cancelled = await this.tryCancelPreTicketFromInbound({
            contact,
            conversation: activeConversation,
            inboundMessage,
            toMeta,
            correlationId,
            state: collectionState,
          });
          if (cancelled) {
            return;
          }

          if (this.shouldRejectPreTicketInput(inboundMessage)) {
            await this.handleInvalidPreTicketInput({
              contact,
              conversation: activeConversation,
              inboundMessage,
              toMeta,
              correlationId,
              state: collectionState,
            });
            return;
          }

          if (!profileText) {
            await this.handleInvalidPreTicketInput({
              contact,
              conversation: activeConversation,
              inboundMessage,
              toMeta,
              correlationId,
              state: collectionState,
            });
            return;
          }

          logger.info(
            { conversation_id: activeConversation.id },
            '[integration-service][contact_profile][CONTACT_PROFILE_RESPONSE_RECEIVED]',
          );
          const stepResult = this.contactProfileService.processCollectionResponse({
            phoneE164: contact.phoneE164,
            state: collectionState,
            text: profileText,
            existingProfile: reliableExistingProfile,
          });
          // PARTE A: ContactProfileService.normalizeCollectionState() strips unknown keys.
          // Re-inject glpi_itil_category_id and glpi_form_id so they survive across multi-step collection.
          const stateToSave: Record<string, unknown> = { ...stepResult.state };
          const preservedCatId = typeof rawState?.glpi_itil_category_id === 'number' ? rawState.glpi_itil_category_id : undefined;
          if (preservedCatId !== undefined) {
            stateToSave.glpi_itil_category_id = preservedCatId;
          }
          const preservedFormId = typeof rawState?.glpi_form_id === 'number' ? rawState.glpi_form_id : undefined;
          if (preservedFormId !== undefined) {
            stateToSave.glpi_form_id = preservedFormId;
          }
          await this.conversationRepository.updateProfileCollectionState(activeConversation.id, stateToSave);
          logger.info(
            {
              conversation_id: activeConversation.id,
              profile_step: stepResult.state.step,
              completed: stepResult.completed,
            },
            '[integration-service][contact_profile][CONTACT_PROFILE_PARSED]',
          );

          if (!stepResult.completed || !stepResult.profile) {
            await this.sendContactProfilePrompt({
              toMeta,
              body: stepResult.reply,
              state: stepResult.state,
              conversationId: activeConversation.id,
            });
            logger.info(
              { conversation_id: activeConversation.id, profile_step: stepResult.state.step },
              '[integration-service][contact_profile][CONTACT_PROFILE_INCOMPLETE]',
            );
            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: activeConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'synced',
            });
            return;
          }

          const profile = await this.contactProfileService.saveProfileData(
            contact.phoneE164,
            stepResult.profile,
            activeConversation.id,
          );
          logger.info(
            { conversation_id: activeConversation.id },
            '[integration-service][contact_profile][CONTACT_PROFILE_SAVED]',
          );
          await this.contactProfileService.createSnapshot(
            activeConversation.id,
            contact.id,
            contact.phoneE164,
            profile,
          );
          logger.info(
            { conversation_id: activeConversation.id },
            '[integration-service][contact_profile][CONTACT_PROFILE_SNAPSHOT_CREATED]',
          );

          const resolvedEntity = await this.resolveEntityFromEquipmentTagOrMemory({
            phoneE164: contact.phoneE164,
            contactId: contact.id,
            profile,
            conversationId: activeConversation.id,
          });
          const entityMode = this.contactEntityResolutionService
            ? await this.contactEntityResolutionService.getMode()
            : 'defer_until_known';
          if (!resolvedEntity) {
            await this.conversationRepository.updateQueueAndStatus(
              activeConversation.id,
              activeConversation.queueId ?? null,
              'awaiting_entity_selection',
            );
            await this.sendEntitySelectionMenu({
              toMeta,
              conversation: activeConversation,
              reason: 'profile_completed_entity_selection_required',
            });
            logger.info(
              {
                conversation_id: activeConversation.id,
                reason: 'entity_selection_required',
              },
              '[integration-service][contact_profile][TICKET_CREATION_DEFERRED_ENTITY_PENDING]',
            );
            this.recordAudit({
              correlationId,
              conversationId: activeConversation.id,
              messageId: inboundMessage.messageId,
              direction: 'inbound',
              eventType: 'TICKET_CREATION_DEFERRED_ENTITY_PENDING',
              status: 'pending',
              severity: 'info',
              source: 'InboundWebhookService',
              payload: {
                reason: 'entity_selection_required',
                queue_id: activeConversation.queueId ?? null,
              },
            });
            await this.messageRepository.updateState({
              messageId: inboundMessage.messageId,
              conversationId: activeConversation.id,
              processingStatus: 'processed',
              glpiSyncStatus: 'synced',
            });
            return;
          }

          const assignment = activeConversation.queueId
            ? await this.routingRepository.findAssignmentByQueueId(activeConversation.queueId)
            : null;
          const ticketPayload = await this.buildProfileAwareTicketPayload({
            basePayload: this.buildNewTicketPayload(contact, inboundMessage),
            contact,
            conversationId: activeConversation.id,
            queueLabel: stepResult.state.queue_label || (assignment?.queueId ? `Fila ${assignment.queueId}` : null),
            profile,
            entityMode,
          });
          const requesterUserId = await this.resolveRequesterUserId(
            contact.phoneE164,
            profile,
            resolvedEntity.glpiEntityId,
            activeConversation.id,
          );
          // PARTE A: recover native GLPI IDs stored at queue-selection time.
          const nativeItilCategoryIdActive = this.resolveTicketCategoryId(
            typeof rawState?.glpi_itil_category_id === 'number' ? rawState.glpi_itil_category_id : null,
          );
          const nativeFormIdActive = this.resolveTicketFormId(
            typeof rawState?.glpi_form_id === 'number' ? rawState.glpi_form_id : null,
            nativeItilCategoryIdActive,
          );
          const ticketId = await this.createTicketWithNativeCategoryFallback(
            {
              title: ticketPayload.title,
              content: ticketPayload.content,
              requesterPhone: contact.phoneE164,
              requesterName: contact.name,
              entitiesId: resolvedEntity.glpiEntityId,
              assignedUserId: assignment?.glpiUserId ?? null,
              assignedGroupId: assignment?.glpiGroupId ?? null,
              requesterUserId,
              itilcategoriesId: nativeItilCategoryIdActive,
              glpiFormId: nativeFormIdActive,
            },
            { timeoutMs: ROUTING_GLPI_CREATE_TIMEOUT_MS },
            { conversationId: activeConversation.id, stage: 'profile_completed_active' },
          );
          // PHASE: integaglpi_asset_context_summary_001 — fire-and-forget, nunca bloqueia.
          if (nativeItilCategoryIdActive === null) {
            this.recordManualCategoryPending({
              correlationId,
              conversationId: activeConversation.id,
              messageId: inboundMessage.messageId,
              ticketId,
              entityId: resolvedEntity.glpiEntityId,
              stage: 'profile_completed_active',
            });
          }
          this.triggerAssetContextSummary(ticketId, resolvedEntity.glpiEntityId, profile, activeConversation.id);

          const linked = await this.conversationRepository.linkGlpiTicket(
            activeConversation.id,
            ticketId,
            activeConversation.queueId,
            resolvedEntity.glpiEntityId,
            resolvedEntity.glpiEntityName,
          );
          if (linked) {
            await this.metaClient.sendTextMessage({
              to: toMeta,
              body: await this.buildTicketCreatedConfirmation(null, ticketId),
            });
          }
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: activeConversation.id,
            processingStatus: 'processed',
            glpiSyncStatus: linked ? 'synced' : 'error',
          });
          return;
        }

        if (activeConversation?.status === 'awaiting_queue_selection' && routingOptions.length === 0) {
          const errorText = await this.settingsService.getMessage('error_fallback_message');
          await this.metaClient.sendTextMessage({ to: toMeta, body: errorText });
          logger.warn(
            { conversation_id: activeConversation.id },
            '[integration-service][routing][TICKET_CREATION_DEFERRED_QUEUE_PENDING]',
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

              if (hasValidGlpiTicketId(lockedConversation.glpiTicketId)) {
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

              if (lockedConversation.status === 'awaiting_entity_selection') {
                await this.metaClient.sendTextMessage({
                  to: toMeta,
                  body: 'Seu atendimento ja esta aguardando definicao de entidade pela nossa equipe.',
                });
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'synced',
                });
                return;
              }

              if (lockedConversation.status === 'collecting_contact_profile') {
                const profileText = inboundMessage.messageText?.trim();
                let profile = this.contactProfileService
                  ? await this.contactProfileService.findProfile(contact.phoneE164)
                  : null;
                if (profileText && this.contactProfileService) {
                  logger.info(
                    { conversation_id: lockedConversation.id },
                    '[integration-service][contact_profile][CONTACT_PROFILE_RESPONSE_RECEIVED]',
                  );
                  profile = await this.contactProfileService.saveProfileFromText(
                    contact.id,
                    contact.phoneE164,
                    profileText,
                    lockedConversation.id,
                  );
                  logger.info(
                    {
                      conversation_id: lockedConversation.id,
                      profile_status: profile.profile_status,
                    },
                    '[integration-service][contact_profile][CONTACT_PROFILE_PARSED]',
                  );
                  logger.info(
                    { conversation_id: lockedConversation.id },
                    '[integration-service][contact_profile][CONTACT_PROFILE_SAVED]',
                  );

                  if (!(await this.contactProfileService.isProfileComplete(profile))) {
                    await this.metaClient.sendTextMessage({
                      to: toMeta,
                      body: await this.contactProfileService.buildMissingFieldsPrompt(profile),
                    });
                    logger.info(
                      { conversation_id: lockedConversation.id },
                      '[integration-service][contact_profile][CONTACT_PROFILE_INCOMPLETE]',
                    );
                    await this.messageRepository.updateState({
                      messageId: inboundMessage.messageId,
                      conversationId: lockedConversation.id,
                      processingStatus: 'processed',
                      glpiSyncStatus: 'synced',
                    });
                    return;
                  }

                  await this.contactProfileService.createSnapshot(
                    lockedConversation.id,
                    contact.id,
                    contact.phoneE164,
                    profile,
                  );
                  logger.info(
                    { conversation_id: lockedConversation.id },
                    '[integration-service][contact_profile][CONTACT_PROFILE_SNAPSHOT_CREATED]',
                  );
                } else if (!profile || !this.contactProfileService) {
                  await this.metaClient.sendTextMessage({
                    to: toMeta,
                    body: this.contactProfileService
                      ? await this.contactProfileService.getInitialPrompt()
                      : 'Envie empresa, nome, equipamento e resumo do problema em uma unica mensagem.',
                  });
                  logger.info(
                    { conversation_id: lockedConversation.id },
                    '[integration-service][contact_profile][CONTACT_PROFILE_INCOMPLETE]',
                  );
                  await this.messageRepository.updateState({
                    messageId: inboundMessage.messageId,
                    conversationId: lockedConversation.id,
                    processingStatus: 'processed',
                    glpiSyncStatus: 'synced',
                  });
                  return;
                }

                const resolvedEntity = await this.resolveEntityFromEquipmentTagOrMemory({
                  phoneE164: contact.phoneE164,
                  contactId: contact.id,
                  profile,
                  conversationId: lockedConversation.id,
                });
                const entityMode = this.contactEntityResolutionService
                  ? await this.contactEntityResolutionService.getMode()
                  : 'defer_until_known';
                if (!resolvedEntity) {
                  await this.conversationRepository.updateQueueAndStatus(
                    lockedConversation.id,
                    lockedConversation.queueId ?? null,
                    'awaiting_entity_selection',
                  );
                  await this.sendEntitySelectionMenu({
                    toMeta,
                    conversation: lockedConversation,
                    reason: 'profile_completed_entity_selection_required',
                  });
                  await this.messageRepository.updateState({
                    messageId: inboundMessage.messageId,
                    conversationId: lockedConversation.id,
                    processingStatus: 'processed',
                    glpiSyncStatus: 'synced',
                  });
                  return;
                }

                const assignment = lockedConversation.queueId
                  ? await this.routingRepository.findAssignmentByQueueId(lockedConversation.queueId)
                  : null;
                const profileTicketPayload = await this.buildProfileAwareTicketPayload({
                  basePayload: this.buildNewTicketPayload(contact, inboundMessage),
                  contact,
                  conversationId: lockedConversation.id,
                  queueLabel: assignment?.queueId ? `Fila ${assignment.queueId}` : null,
                  profile,
                  entityMode,
                });
                const requesterUserId = await this.resolveRequesterUserId(
                  contact.phoneE164,
                  profile,
                  resolvedEntity.glpiEntityId,
                  lockedConversation.id,
                );
                // PARTE A: recover native GLPI IDs stored at queue-selection time.
                const nativeItilCategoryIdLocked = this.resolveTicketCategoryId(
                  typeof lockedConversation.profileCollectionState?.glpi_itil_category_id === 'number'
                    ? lockedConversation.profileCollectionState.glpi_itil_category_id
                    : null,
                );
                const nativeFormIdLocked = this.resolveTicketFormId(
                  typeof lockedConversation.profileCollectionState?.glpi_form_id === 'number'
                    ? lockedConversation.profileCollectionState.glpi_form_id
                    : null,
                  nativeItilCategoryIdLocked,
                );
                const ticketId = await this.createTicketWithNativeCategoryFallback(
                  {
                    title: profileTicketPayload.title,
                    content: profileTicketPayload.content,
                    requesterPhone: contact.phoneE164,
                    requesterName: contact.name,
                    entitiesId: resolvedEntity.glpiEntityId,
                    assignedUserId: assignment?.glpiUserId ?? null,
                    assignedGroupId: assignment?.glpiGroupId ?? null,
                    requesterUserId,
                    itilcategoriesId: nativeItilCategoryIdLocked,
                    glpiFormId: nativeFormIdLocked,
                  },
                  { timeoutMs: ROUTING_GLPI_CREATE_TIMEOUT_MS },
                  { conversationId: lockedConversation.id, stage: 'profile_completed_locked' },
                );
                // PHASE: integaglpi_asset_context_summary_001 — fire-and-forget, nunca bloqueia.
                if (nativeItilCategoryIdLocked === null) {
                  this.recordManualCategoryPending({
                    correlationId,
                    conversationId: lockedConversation.id,
                    messageId: inboundMessage.messageId,
                    ticketId,
                    entityId: resolvedEntity.glpiEntityId,
                    stage: 'profile_completed_locked',
                  });
                }
                this.triggerAssetContextSummary(ticketId, resolvedEntity.glpiEntityId, profile, lockedConversation.id);

                const linked = await this.conversationRepository.linkGlpiTicket(
                  lockedConversation.id,
                  ticketId,
                  lockedConversation.queueId,
                  resolvedEntity.glpiEntityId,
                  resolvedEntity.glpiEntityName,
                );
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: linked ? 'synced' : 'error',
                });
                if (linked) {
                  await this.metaClient.sendTextMessage({
                    to: toMeta,
                    body: await this.buildTicketCreatedConfirmation(null, ticketId),
                  });
                }
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

              const qId = selectedOption.queueId;
              const normalizedQueueId = typeof qId === 'number' && Number.isFinite(qId) ? qId : null;
              const profileCollectionEnabled = this.contactProfileService
                ? await this.contactProfileService.isCollectionEnabled()
                : false;
              const existingProfile = this.contactProfileService
                ? await this.contactProfileService.findProfile(contact.phoneE164)
                : null;
              const reliableExistingProfile = this.contactProfileService?.isReliableForConfirmation(existingProfile)
                ? existingProfile
                : null;
              if (this.contactProfileService && profileCollectionEnabled) {
                const profileState = reliableExistingProfile
                  ? this.contactProfileService.startExistingProfileConfirmationState(reliableExistingProfile, selectedOption.label)
                  : this.contactProfileService.startNewCollectionState(selectedOption.label);
                // PARTE A: persist native GLPI category ID so it survives profile-collection steps.
                // ContactProfileCollectionState has [key: string]: unknown — extra fields are allowed.
                if (selectedOption.glpiItilCategoryId != null) {
                  profileState.glpi_itil_category_id = selectedOption.glpiItilCategoryId;
                }
                // PARTE A (Forms): persist native GLPI form ID so it survives profile-collection steps.
                if (selectedOption.glpiFormId != null) {
                  profileState.glpi_form_id = selectedOption.glpiFormId;
                }
                await this.conversationRepository.updateQueueAndStatus(
                  lockedConversation.id,
                  normalizedQueueId,
                  'collecting_contact_profile',
                );
                await this.conversationRepository.updateProfileCollectionState(lockedConversation.id, profileState);
                await this.sendContactProfilePrompt({
                  toMeta,
                  body: this.contactProfileService.getCollectionPrompt(profileState, reliableExistingProfile),
                  state: profileState,
                  conversationId: lockedConversation.id,
                });
                logger.info(
                  { conversation_id: lockedConversation.id, profile_step: profileState.step },
                  '[integration-service][contact_profile][CONTACT_PROFILE_COLLECTION_STARTED]',
                );
                logger.info(
                  { conversation_id: lockedConversation.id, profile_step: profileState.step },
                  '[integration-service][contact_profile][CONTACT_PROFILE_PROMPT_SENT]',
                );
                logger.info(
                  { conversation_id: lockedConversation.id },
                  '[integration-service][contact_profile][TICKET_CREATION_DEFERRED_PROFILE_PENDING]',
                );
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'synced',
                });
                return;
              }

              const rememberedEntity = await this.findRememberedEntity(contact.phoneE164);
              const entityMode = this.contactEntityResolutionService
                ? await this.contactEntityResolutionService.getMode()
                : 'defer_until_known';
              if (!rememberedEntity) {
                await this.conversationRepository.updateQueueAndStatus(
                  lockedConversation.id,
                  normalizedQueueId,
                  'awaiting_entity_selection',
                );
                await this.sendEntitySelectionMenu({
                  toMeta,
                  conversation: {
                    ...lockedConversation,
                    queueId: normalizedQueueId,
                    status: 'awaiting_entity_selection',
                  },
                  reason: 'queue_selected_entity_selection_required',
                });
                await this.messageRepository.updateState({
                  messageId: inboundMessage.messageId,
                  conversationId: lockedConversation.id,
                  processingStatus: 'processed',
                  glpiSyncStatus: 'synced',
                });
                return;
              }

              const routedTicketPayload = await this.buildProfileAwareTicketPayload({
                basePayload: this.buildNewTicketPayload(contact, inboundMessage),
                contact,
                conversationId: lockedConversation.id,
                queueLabel: selectedOption.label,
                profile: null,
                entityMode,
              });
              const requesterUserId = await this.resolveRequesterUserId(
                contact.phoneE164,
                null,
                rememberedEntity.glpiEntityId,
                lockedConversation.id,
              );
              let ticketId: number;
              try {
                ticketId = await this.createTicketWithNativeCategoryFallback(
                  {
                    title: routedTicketPayload.title,
                    content: routedTicketPayload.content,
                    requesterPhone: contact.phoneE164,
                    requesterName: contact.name,
                    entitiesId: rememberedEntity.glpiEntityId,
                    assignedUserId: selectedOption.glpiUserId,
                    assignedGroupId: selectedOption.glpiGroupId,
                    requesterUserId,
                    itilcategoriesId: this.resolveTicketCategoryId(selectedOption.glpiItilCategoryId ?? null),
                    glpiFormId: this.resolveTicketFormId(
                      selectedOption.glpiFormId ?? null,
                      this.resolveTicketCategoryId(selectedOption.glpiItilCategoryId ?? null),
                    ),
                  },
                  { timeoutMs: ROUTING_GLPI_CREATE_TIMEOUT_MS },
                  { conversationId: lockedConversation.id, stage: 'queue_selected' },
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
              const selectedItilCategoryId = this.resolveTicketCategoryId(selectedOption.glpiItilCategoryId ?? null);
              if (selectedItilCategoryId === null) {
                this.recordManualCategoryPending({
                  correlationId,
                  conversationId: lockedConversation.id,
                  messageId: inboundMessage.messageId,
                  ticketId,
                  entityId: rememberedEntity.glpiEntityId,
                  stage: 'queue_selected',
                });
              }
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

              try {
                const linked = await this.conversationRepository.linkGlpiTicket(
                  lockedConversation.id,
                  ticketId,
                  normalizedQueueId,
                  rememberedEntity.glpiEntityId,
                  rememberedEntity.glpiEntityName,
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
            // When customer triage + AI classification are enabled and we have a valid entity: start
            // in awaiting_problem_description — user describes problem before menu.
            // Flag off: falls back to awaiting_queue_selection (unchanged legacy).
            status: (categoryClassificationActive && knownEntityForTriage && knownEntityForTriage > 0)
              ? 'awaiting_problem_description'
              : 'awaiting_queue_selection',
            lastMessageAt: new Date(),
          });
          conversationId = awaitingConversation.id;

          if (awaitingConversation.status === 'awaiting_problem_description') {
            // AI flow: ask user to describe the problem.
            const descPrompt = 'Olá! Para abrir um chamado, descreva o problema em poucas palavras.';
            await this.metaClient.sendTextMessage({ to: toMeta, body: descPrompt });
            logger.info(
              { conversation_id: awaitingConversation.id, ai_category_enabled: true },
              '[integration-service][routing][AI_CATEGORY_DESCRIPTION_PROMPT_SENT]',
            );
          } else {
            await this.sendRoutingMenu({
              toMeta,
              routingOptions,
              menuHeading,
              menuBody,
              context: 'initial_menu',
              conversationId: awaitingConversation.id,
            });
          }
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

        const profileCollectionEnabled = this.contactProfileService
          ? await this.contactProfileService.isCollectionEnabled()
          : false;
        if (profileCollectionEnabled && !activeConversation && routingOptions.length === 0) {
          const profileConversation = await this.conversationRepository.create({
            phoneE164: contact.phoneE164,
            contactId: contact.id,
            glpiTicketId: null,
            status: 'collecting_contact_profile',
            lastMessageAt: new Date(),
          });
          conversationId = profileConversation.id;
          const profileState = this.contactProfileService!.startNewCollectionState();
          await this.conversationRepository.updateProfileCollectionState(profileConversation.id, profileState);
          await this.sendContactProfilePrompt({
            toMeta,
            body: this.contactProfileService!.getCollectionPrompt(profileState),
            state: profileState,
            conversationId: profileConversation.id,
          });
          logger.info(
            { conversation_id: profileConversation.id },
            '[integration-service][contact_profile][CONTACT_PROFILE_COLLECTION_STARTED]',
          );
          logger.info(
            { conversation_id: profileConversation.id },
            '[integration-service][contact_profile][CONTACT_PROFILE_PROMPT_SENT]',
          );
          logger.info(
            { conversation_id: profileConversation.id },
            '[integration-service][contact_profile][TICKET_CREATION_DEFERRED_PROFILE_PENDING]',
          );
          await this.conversationRepository.touch(profileConversation.id, new Date());
          await this.messageRepository.updateState({
            messageId: inboundMessage.messageId,
            conversationId: profileConversation.id,
            processingStatus: 'processed',
            glpiSyncStatus: 'synced',
          });
          return;
        }

        // ── Existe conversa com ticket vinculado → decisão baseada em status ──
        const existingConversationTicketId = existingConversation && hasValidGlpiTicketId(existingConversation.glpiTicketId)
          ? Number(existingConversation.glpiTicketId)
          : null;
        if (existingConversation && existingConversationTicketId !== null) {
          let glpiTicketStatus = knownExistingTicketStatus;
          if (glpiTicketStatus === null) {
            inboundGlpiStage = 'glpi_ticket_read';
            glpiTicketStatus = await this.glpiClient.getTicketStatus(existingConversationTicketId);
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
              old_ticket_id:      existingConversationTicketId,
              conversation_status: conversationStatus,
              glpi_ticket_status: glpiTicketStatus,
              action,
            },
            '[integration-service][inbound][DECISION]',
          );

          if (
            glpiTicketStatus !== 'closed'
            && await this.tryCancelOpenTicketFromInbound({
              contact,
              conversation: existingConversation,
              ticketId: existingConversationTicketId,
              inboundMessage,
              correlationId,
            })
          ) {
            return;
          }

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
                ticketId: existingConversationTicketId,
                conversationId: existingConversation.id,
                messageId: inboundMessage.messageId,
                correlationId,
              });
              followUpContent = mediaResult.followUpContent;
              mediaInfoRecord = mediaResult.mediaInfo as unknown as Record<string, unknown>;
              await this.messageRepository.updateMediaInfo(inboundMessage.messageId, mediaInfoRecord);
            } else if (isDetectableMedia) {
              mediaInfoRecord = this.buildMediaMetadataMissingInfo(inboundMessage.messageType, existingConversationTicketId);
              await this.messageRepository.updateMediaInfo(inboundMessage.messageId, mediaInfoRecord);
              logger.error(
                {
                  message_id: inboundMessage.messageId,
                  message_type: inboundMessage.messageType,
                  conversation_id: existingConversation.id,
                  ticket_id: existingConversationTicketId,
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
                ticketId: existingConversationTicketId,
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
              followUpContent = await this.buildFollowUpContent(contact, inboundMessage);
            }

            try {
              await this.glpiClient.addFollowUp({
                ticketId: existingConversationTicketId,
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
              { actionTaken: 'append', conversationId: existingConversation.id, glpiTicketId: existingConversationTicketId },
              'Inbound message appended as GLPI follow-up.',
            );
            this.recordAudit({
              correlationId,
              ticketId: existingConversationTicketId,
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
              ticketId: existingConversationTicketId,
              content: await this.buildFollowUpContent(contact, inboundMessage),
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
              { actionTaken: 'reopen_conversation', conversationId: existingConversation.id, glpiTicketId: existingConversationTicketId },
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
            closedConversationNoticeSent = true;
          }

          if (conversationStatus !== 'closed') {
            await this.conversationRepository.updateStatus(existingConversation.id, 'closed');
          }
          const rememberedEntity = await this.findRememberedEntity(contact.phoneE164);
          if (!rememberedEntity) {
            conversationId = await this.deferTicketCreationForEntitySelection({
              contact,
              inboundMessage,
              toMeta,
              conversationId: null,
              queueId: existingConversation.queueId,
              message: ENTITY_SELECTION_PENDING_MESSAGE,
            });
            return;
          }
          inboundGlpiStage = 'glpi_ticket_create';
          const newTicketPayload = this.buildNewTicketPayload(contact, inboundMessage);
          const requesterUserId = await this.resolveRequesterUserId(
            contact.phoneE164,
            null,
            rememberedEntity.glpiEntityId,
            existingConversation.id,
          );
          const newTicketId = await this.glpiClient.createTicket({
            title: newTicketPayload.title,
            content: newTicketPayload.content,
            requesterPhone: contact.phoneE164,
            requesterName: contact.name,
            entitiesId: rememberedEntity.glpiEntityId,
            requesterUserId,
          });
          this.logTicketCreatedWithFallback(contact, inboundMessage.messageId, newTicketId);
          inboundGlpiStage = undefined;

          const newConversation = await this.conversationRepository.create({
            phoneE164: contact.phoneE164,
            contactId: contact.id,
            glpiTicketId: newTicketId,
            status: 'open',
            lastMessageAt: new Date(),
            glpiEntityId: rememberedEntity.glpiEntityId,
            glpiEntityName: rememberedEntity.glpiEntityName,
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
        if (activeConversation && !hasValidGlpiTicketId(activeConversation.glpiTicketId)) {
          const rememberedEntity = await this.findRememberedEntity(contact.phoneE164);
          if (!rememberedEntity) {
            conversationId = await this.deferTicketCreationForEntitySelection({
              contact,
              inboundMessage,
              toMeta,
              conversationId: activeConversation.id,
              queueId: activeConversation.queueId,
              message: activeConversation.status === 'awaiting_entity_selection'
                ? 'Seu atendimento ja esta aguardando definicao de entidade pela nossa equipe.'
                : ENTITY_SELECTION_PENDING_MESSAGE,
            });
            return;
          }
          inboundGlpiStage = 'glpi_ticket_create';
          const profile = this.contactProfileService
            ? await this.contactProfileService.findProfile(contact.phoneE164)
            : null;
          const assignment = activeConversation.queueId
            ? await this.routingRepository.findAssignmentByQueueId(activeConversation.queueId)
            : null;
          const entityMode = this.contactEntityResolutionService
            ? await this.contactEntityResolutionService.getMode()
            : 'defer_until_known';
          const ticketPayload = await this.buildProfileAwareTicketPayload({
            basePayload: this.buildNewTicketPayload(contact, inboundMessage),
            contact,
            conversationId: activeConversation.id,
            queueLabel: assignment?.queueId ? `Fila ${assignment.queueId}` : null,
            profile,
            entityMode,
          });
          const requesterUserId = await this.resolveRequesterUserId(
            contact.phoneE164,
            profile,
            rememberedEntity.glpiEntityId,
            activeConversation.id,
          );
          const ticketId = await this.glpiClient.createTicket({
            title: ticketPayload.title,
            content: ticketPayload.content,
            requesterPhone: contact.phoneE164,
            requesterName: contact.name,
            entitiesId: rememberedEntity.glpiEntityId,
            requesterUserId,
          });
          this.logTicketCreatedWithFallback(contact, inboundMessage.messageId, ticketId);
          inboundGlpiStage = undefined;

          const linked = await this.conversationRepository.linkGlpiTicket(
            activeConversation.id,
            ticketId,
            activeConversation.queueId,
            rememberedEntity.glpiEntityId,
            rememberedEntity.glpiEntityName,
          );
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
        const rememberedEntity = await this.findRememberedEntity(contact.phoneE164);
        if (!rememberedEntity) {
          conversationId = await this.deferTicketCreationForEntitySelection({
            contact,
            inboundMessage,
            toMeta,
            conversationId: null,
            queueId: null,
            message: ENTITY_SELECTION_PENDING_MESSAGE,
          });
          return;
        }
        inboundGlpiStage = 'glpi_ticket_create';
        const ticketPayload = this.buildNewTicketPayload(contact, inboundMessage);
        const requesterUserId = await this.resolveRequesterUserId(
          contact.phoneE164,
          null,
          rememberedEntity.glpiEntityId,
          null,
        );
        const ticketId = await this.glpiClient.createTicket({
          title: ticketPayload.title,
          content: ticketPayload.content,
          requesterPhone: contact.phoneE164,
          requesterName: contact.name,
          entitiesId: rememberedEntity.glpiEntityId,
          requesterUserId,
        });
        this.logTicketCreatedWithFallback(contact, inboundMessage.messageId, ticketId);
        inboundGlpiStage = undefined;

        const createdConversation = await this.conversationRepository.create({
          phoneE164: contact.phoneE164,
          contactId: contact.id,
          glpiTicketId: ticketId,
          status: 'open',
          lastMessageAt: new Date(),
          glpiEntityId: rememberedEntity.glpiEntityId,
          glpiEntityName: rememberedEntity.glpiEntityName,
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
    } finally {
      // Near-real-time supervisory analysis for the conversation that just received an
      // inbound message. Fire-and-forget: never awaited, never throws into ingestion.
      this.triggerInboundAlertAnalysis(conversationId, inboundMessage.messageType);
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

  private async buildProfileAwareTicketPayload(input: {
    basePayload: { title: string; content: string };
    contact: Contact;
    conversationId: string;
    queueLabel: string | null;
    profile: Awaited<ReturnType<ContactProfileService['findProfile']>> | null;
    entityMode?: 'use_default_entity' | 'defer_until_known' | string | null;
  }): Promise<{ title: string; content: string }> {
    if (!this.contactProfileService || !input.profile) {
      return input.basePayload;
    }

    const snapshot = await this.contactProfileService.createSnapshot(
      input.conversationId,
      input.contact.id,
      input.contact.phoneE164,
      input.profile,
    );

    return this.contactProfileService.enrichTicketPayload({
      baseTitle: input.basePayload.title,
      baseContent: input.basePayload.content,
      phoneE164: input.contact.phoneE164,
      queueLabel: input.queueLabel,
      profile: snapshot,
      entityMode: input.entityMode,
    });
  }

  private async resolveRequesterUserId(
    phoneE164: string,
    profile: Awaited<ReturnType<ContactProfileService['findProfile']>> | null,
    entitiesId: number,
    conversationId: string | null,
  ): Promise<number | null> {
    if (!this.customerExperienceService || !this.contactProfileService) {
      return null;
    }

    const effectiveProfile = profile ?? await this.contactProfileService.findProfile(phoneE164);
    if (!effectiveProfile) {
      return null;
    }

    const result = await this.customerExperienceService.resolveGlpiRequester({
      phoneE164,
      profile: effectiveProfile,
      entitiesId,
      conversationId,
    });

    return result.glpiUserId;
  }

  private async buildFollowUpContent(contact: Contact, inboundMessage: ParsedMetaInboundMessage): Promise<string> {
    const contentLines = [
      'Mensagem recebida via WhatsApp',
      '',
      `Telefone: ${contact.phoneE164}`,
      `Nome: ${contact.name ?? '(n/d)'}`,
      'Origem: WhatsApp',
      'Texto:',
      inboundMessage.messageText ?? `[${inboundMessage.messageType}]`,
    ];

    const replyContext = await this.buildReplyContextLines(inboundMessage);
    if (replyContext.length > 0) {
      contentLines.splice(5, 0, ...replyContext, '');
    }

    if (this.isGlpiContactLookupFallback(contact)) {
      contentLines.unshift('Contato nao resolvido automaticamente no GLPI.', '');
    }

    return contentLines.join('\n');
  }

  private async buildReplyContextLines(inboundMessage: ParsedMetaInboundMessage): Promise<string[]> {
    const context = inboundMessage.replyContext;
    if (!context) {
      return [];
    }

    const original = await this.messageRepository.findByMessageId(context.messageId);
    const preview = original?.messageText ? this.truncateReplyPreview(original.messageText) : null;
    const reference = preview ?? `mensagem WhatsApp ${context.messageId}`;

    return [`Em resposta a: ${reference}`];
  }

  private truncateReplyPreview(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 180) {
      return normalized;
    }

    return `${normalized.slice(0, 177).trimEnd()}...`;
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
    const reopenReasonMatch = /^solution_reopen_reason:(problem_persists|missing_work|not_understood|other):(\d+):(.+)$/.exec(value);
    if (reopenReasonMatch) {
      const ticketId = Number.parseInt(reopenReasonMatch[2], 10);
      const conversationId = reopenReasonMatch[3].trim();
      if (!Number.isSafeInteger(ticketId) || ticketId <= 0 || conversationId.length === 0) {
        return null;
      }

      return {
        action: 'reopen',
        ticketId,
        conversationId,
        csatRating: null,
        reopenReason: reopenReasonMatch[1] as ReopenReasonKey,
      };
    }

    const csatMatch = /^solution_csat:(very_satisfied|satisfied|dissatisfied):(\d+):(.+)$/.exec(value);
    if (csatMatch) {
      const ticketId = Number.parseInt(csatMatch[2], 10);
      const conversationId = csatMatch[3].trim();
      if (!Number.isSafeInteger(ticketId) || ticketId <= 0 || conversationId.length === 0) {
        return null;
      }

      const csatRating = csatMatch[1] as CsatRating;
      return {
        action: 'approve',
        ticketId,
        conversationId,
        csatRating,
        reopenReason: null,
      };
    }

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
      csatRating: null,
      reopenReason: null,
    };
  }

  private async tryHandlePendingSolutionTextAction(input: {
    inboundMessage: ParsedMetaInboundMessage;
    conversation: Conversation;
    ticketId: number;
    contact: Contact;
    toMeta: string;
    correlationId: string;
  }): Promise<boolean> {
    if (this.solutionActionRepository === null) {
      return false;
    }

    const pendingCsat = await this.solutionActionRepository.findPendingCsatAction(
      input.ticketId,
      input.conversation.id,
    );
    if (pendingCsat !== null) {
      const csatRating = this.parseCsatTextReply(input.inboundMessage.messageText);
      if (csatRating === null) {
        await this.sendInvalidPendingReplyMessage({
          toMeta: input.toMeta,
          conversation: input.conversation,
          inboundMessage: input.inboundMessage,
          ticketId: input.ticketId,
          correlationId: input.correlationId,
          kind: 'csat',
        });
        return true;
      }

      logger.info(
        {
          ticket_id: input.ticketId,
          conversation_id: input.conversation.id,
          correlation_id: input.correlationId,
          csat_rating: csatRating,
          event_type: 'csat_response_received',
        },
        '[integration-service][solution][CSAT_RESPONSE_RECEIVED]',
      );
      await this.handleSolutionButtonAction({
        action: {
          action: 'approve',
          ticketId: input.ticketId,
          conversationId: input.conversation.id,
          csatRating,
          reopenReason: null,
        },
        contact: input.contact,
        inboundMessage: input.inboundMessage,
        toMeta: input.toMeta,
        correlationId: input.correlationId,
      });
      return true;
    }

    const ticket = await this.glpiClient.getTicket(input.ticketId);
    if (ticket.status !== GLPI_STATUS_SOLVED) {
      logger.info(
        {
          ticket_id: input.ticketId,
          conversation_id: input.conversation.id,
          correlation_id: input.correlationId,
          ticket_status: ticket.status,
          event_type: 'numeric_menu_input_ignored_wrong_state',
        },
        '[integration-service][solution][NUMERIC_INPUT_IGNORED_WRONG_STATE]',
      );
      return false;
    }

    const action = this.parseSolutionApprovalTextReply(input.inboundMessage.messageText);
    if (action === null) {
      await this.sendInvalidPendingReplyMessage({
        toMeta: input.toMeta,
        conversation: input.conversation,
        inboundMessage: input.inboundMessage,
        ticketId: input.ticketId,
        correlationId: input.correlationId,
        kind: 'solution',
      });
      return true;
    }

    logger.info(
      {
        ticket_id: input.ticketId,
        conversation_id: input.conversation.id,
        correlation_id: input.correlationId,
        action,
        event_type: action === 'approve' ? 'solution_response_approved' : 'solution_response_reopened',
      },
      `[integration-service][solution][${action === 'approve' ? 'SOLUTION_RESPONSE_APPROVED' : 'SOLUTION_RESPONSE_REOPENED'}]`,
    );
    await this.handleSolutionButtonAction({
      action: {
        action,
        ticketId: input.ticketId,
        conversationId: input.conversation.id,
        csatRating: null,
        reopenReason: null,
      },
      contact: input.contact,
      inboundMessage: input.inboundMessage,
      toMeta: input.toMeta,
      correlationId: input.correlationId,
    });
    return true;
  }

  private parseCsatTextReply(messageText: string | null): CsatRating | null {
    const numericChoice = parseMenuDigitChoice(messageText, 3);
    if (numericChoice === 1) {
      return 'very_satisfied';
    }
    if (numericChoice === 2) {
      return 'satisfied';
    }
    if (numericChoice === 3) {
      return 'dissatisfied';
    }

    const normalized = this.normalizePendingReplyText(messageText);
    if (normalized === 'otimo' || normalized === 'otima') {
      return 'very_satisfied';
    }
    if (normalized === 'bom' || normalized === 'boa') {
      return 'satisfied';
    }
    if (normalized === 'ruim') {
      return 'dissatisfied';
    }

    return null;
  }

  private parseSolutionApprovalTextReply(messageText: string | null): SolutionButtonAction | null {
    const numericChoice = parseMenuDigitChoice(messageText, 2);
    if (numericChoice === 1) {
      return 'approve';
    }
    if (numericChoice === 2) {
      return 'reopen';
    }

    const normalized = this.normalizePendingReplyText(messageText);
    if (normalized === 'aprovar' || normalized === 'aprovado' || normalized === 'aprovada') {
      return 'approve';
    }
    if (normalized === 'reabrir' || normalized === 'reabrir chamado') {
      return 'reopen';
    }

    return null;
  }

  private normalizePendingReplyText(messageText: string | null): string {
    return (messageText ?? '')
      .trim()
      .toLocaleLowerCase('pt-BR')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ');
  }

  private async sendInvalidPendingReplyMessage(input: {
    toMeta: string;
    conversation: Conversation;
    inboundMessage: ParsedMetaInboundMessage;
    ticketId: number;
    correlationId: string;
    kind: 'csat' | 'solution';
  }): Promise<void> {
    const body = input.kind === 'csat'
      ? 'Não entendi sua avaliação. Responda 1 para Ótimo, 2 para Bom ou 3 para Ruim.'
      : 'Não entendi sua resposta. Responda 1 para Aprovar ou 2 para Reabrir.';

    await this.metaClient.sendTextMessage({
      to: input.toMeta,
      body,
    });
    await this.conversationRepository.touch(input.conversation.id, new Date());
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: input.conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
    logger.info(
      {
        ticket_id: input.ticketId,
        conversation_id: input.conversation.id,
        correlation_id: input.correlationId,
        pending_reply_kind: input.kind,
      },
      '[integration-service][solution][PENDING_REPLY_INVALID]',
    );
    this.recordAudit({
      correlationId: input.correlationId,
      ticketId: input.ticketId,
      conversationId: input.conversation.id,
      messageId: input.inboundMessage.messageId,
      direction: 'inbound',
      eventType: input.kind === 'csat' ? 'CSAT_RESPONSE_INVALID' : 'SOLUTION_RESPONSE_INVALID',
      status: 'ignored',
      severity: 'warning',
      source: 'InboundWebhookService',
      payload: { reason: 'invalid_pending_reply' },
    });
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

    if (
      input.action.action === 'reopen'
      && input.action.csatRating === null
      && input.action.reopenReason === null
    ) {
      await this.keyLock.withLock(`solution_action:${input.action.ticketId}`, async () => {
        const ticket = await this.glpiClient.getTicket(input.action.ticketId);
        if (ticket.status !== GLPI_STATUS_SOLVED) {
          await this.sendExpiredSolutionActionMessage(input.toMeta, input.action);
          logger.info(
            {
              ticket_id: input.action.ticketId,
              conversation_id: conversation.id,
              ticket_status: ticket.status,
              action: input.action.action,
            },
            '[integration-service][solution][REOPEN_REASON_ACTION_EXPIRED]',
          );
          return;
        }

        await this.sendConfiguredReopenReasonPrompt(input.toMeta, input.action, input.correlationId);
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
          payload: { action: 'solution_reopen_reason_prompt' },
        });
      });

      await this.messageRepository.updateState({
        messageId: input.inboundMessage.messageId,
        conversationId: conversation.id,
        processingStatus: 'processed',
        glpiSyncStatus: 'synced',
      });
      return;
    }

    const actionKey = input.action.csatRating
      ? `solution:${input.action.action}:${input.action.ticketId}:${conversation.id}:csat:${input.action.csatRating}`
      : input.action.reopenReason
      ? `solution:${input.action.action}:${input.action.ticketId}:${conversation.id}:${input.action.reopenReason}`
      : `solution:${input.action.action}:${input.action.ticketId}:${conversation.id}`;
    const csatRating = input.action.csatRating;
    const baseAuditAction = input.action.action === 'approve' ? 'solution_approve' : 'solution_reopen';
    const successAuditPayload =
      csatRating === null
        ? input.action.reopenReason
          ? { action: baseAuditAction, reopen_reason: input.action.reopenReason }
          : { action: baseAuditAction }
        : input.action.action === 'approve'
          ? csatRating === 'dissatisfied'
            ? { action: baseAuditAction, csat_rating: csatRating, supervisor_review_required: true }
            : { action: baseAuditAction, csat_rating: csatRating }
          : { action: baseAuditAction, csat_rating: csatRating, supervisor_review_required: true };

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
        csatRating,
        supervisorReviewRequired: csatRating === 'dissatisfied',
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
        const hasNewCycleAfterReopen =
          input.action.action === 'approve'
          && csatRating === null
          && await this.solutionActionRepository?.hasSuccessfulReopenAfter(
            input.action.ticketId,
            conversation.id,
            successfulAction.createdAt,
          ) === true;
        if (hasNewCycleAfterReopen) {
          logger.info(
            {
              ticket_id: input.action.ticketId,
              conversation_id: conversation.id,
              previous_action_id: successfulAction.id,
              action_id: reserved.action.id,
            },
            '[integration-service][solution][NEW_CYCLE_AFTER_REOPEN]',
          );
        } else {
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
      }

      const expectedTicketStatus = csatRating !== null
        ? [GLPI_STATUS_SOLVED, GLPI_STATUS_CLOSED]
        : [GLPI_STATUS_SOLVED];
      if (typeof ticket.status !== 'number' || !expectedTicketStatus.includes(ticket.status)) {
        await this.solutionActionRepository?.markIgnored(
          reserved.action.id,
          'GLPI_TICKET_STATUS_INVALID',
          `Ticket status ${ticket.status ?? 'unknown'} is not valid for this action.`,
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
          const auditContent = await this.buildSolutionActionFollowUpContent(
            input.contact,
            conversation.id,
            'approve',
            csatRating,
          );
          if (ticket.status === GLPI_STATUS_CLOSED && csatRating !== null) {
            solutionStage = 'glpi_followup_create';
            await this.glpiClient.addFollowUp({ ticketId: input.action.ticketId, content: auditContent });
          } else {
            await this.glpiClient.approveTicketSolution(input.action.ticketId, auditContent);
          }
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
            payload: successAuditPayload,
          });
          logger.info(
            {
              ticket_id: input.action.ticketId,
              conversation_id: conversation.id,
              action_id: reserved.action.id,
            },
            '[integration-service][solution][APPROVED]',
          );
          if (csatRating === null) {
            await this.sendConfiguredCsatPrompt(input.toMeta, input.action, input.correlationId);
          } else {
            await this.sendCsatThankYouClosure({
              toMeta: input.toMeta,
              conversation,
              ticketId: input.action.ticketId,
              correlationId: input.correlationId,
              messageId: input.inboundMessage.messageId,
            });
          }
        } else {
          solutionStage = 'glpi_solution_reopen';
          logger.info(
            {
              ticket_id: input.action.ticketId,
              conversation_id: conversation.id,
              reopen_reason: input.action.reopenReason,
            },
            '[integration-service][solution][SOLUTION_REOPEN_REASON_SELECTED]',
          );
          const auditContent = await this.buildSolutionActionFollowUpContent(
            input.contact,
            conversation.id,
            'reopen',
            csatRating,
            input.action.reopenReason,
          );
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
            payload: successAuditPayload,
          });
          await this.sendSolutionActionConfirmation(input.toMeta, input.action);
          logger.info(
            {
              ticket_id: input.action.ticketId,
              conversation_id: conversation.id,
              action_id: reserved.action.id,
              reopen_reason: input.action.reopenReason,
            },
            '[integration-service][solution][TICKET_REOPENED_WITH_REASON]',
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
          payload:
            csatRating === null
              ? input.action.reopenReason
                ? { action: baseAuditAction, reopen_reason: input.action.reopenReason, error_code: errorCode }
                : { action: baseAuditAction, error_code: errorCode }
              : csatRating === 'dissatisfied'
                ? { action: baseAuditAction, csat_rating: csatRating, supervisor_review_required: true, error_code: errorCode }
                : { action: baseAuditAction, csat_rating: csatRating, error_code: errorCode },
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

  private async buildSolutionActionFollowUpContent(
    contact: Contact,
    conversationId: string,
    action: SolutionButtonAction,
    csatRating: CsatRating | null = null,
    reopenReason: ReopenReasonKey | null = null,
  ): Promise<string> {
    const reopenReasonLabel = reopenReason ? await this.reopenReasonLabel(reopenReason) : null;
    let actionText = 'Cliente solicitou reabertura via WhatsApp.';
    if (csatRating === 'dissatisfied') {
      actionText = 'Cliente indicou insatisfação na pesquisa via WhatsApp. O chamado deve seguir em atendimento e revisão.';
    } else if (action === 'approve') {
      actionText = 'Cliente aprovou a solução via WhatsApp.';
    } else if (reopenReasonLabel) {
      actionText = `Cliente solicitou reabertura via WhatsApp. Motivo: ${reopenReasonLabel}.`;
    }

    const lines = [
      actionText,
      '',
      `Telefone: ${contact.phoneE164}`,
      `Conversation ID: ${conversationId}`,
      `Ação: ${action}`,
    ];

    if (csatRating !== null) {
      lines.push(`CSAT: ${csatRating}`);
      lines.push(`Revisão de supervisor: ${csatRating === 'dissatisfied' ? 'sim' : 'não'}`);
    }
    if (reopenReasonLabel) {
      lines.push(`Motivo da reabertura: ${reopenReasonLabel}`);
    }

    lines.push('Origem: WhatsApp');

    return lines.join('\n');
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
      const eventKey = action.csatRating === 'dissatisfied'
        ? 'solution_reopen_message'
        : 'solution_reopened_confirmation';
      const message = await this.messageConfigurationService?.getMessage(eventKey);
      const configuredText = selectSolutionMessageText(message)
        .replace(/\{\{ticket_id\}\}/g, String(action.ticketId))
        .replace(/\{ticket_id\}/g, String(action.ticketId))
        .replace(/#\{ticket_id\}/g, `#${action.ticketId}`)
        .trim();
      await this.metaClient.sendTextMessage({
        to: toMeta,
        body: configuredText !== ''
          ? configuredText
          : action.csatRating === 'dissatisfied'
          ? `Registramos sua avaliação e o chamado #${action.ticketId} seguirá em atendimento para revisão.`
          : `Seu chamado #${action.ticketId} foi reaberto com sucesso.`,
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

  private async sendConfiguredReopenReasonPrompt(
    toMeta: string,
    action: ParsedSolutionButtonAction,
    correlationId: string,
  ): Promise<void> {
    try {
      const plan = await this.messageConfigurationService?.resolveSendPlan('reopen_reason_prompt', {
        windowOpen: true,
        allowTemplateSend: true,
      });
      if (plan && !plan.shouldSend) {
        logger.warn(
          {
            ticket_id: action.ticketId,
            conversation_id: action.conversationId,
            correlation_id: correlationId,
            event_key: 'reopen_reason_prompt',
            reason: plan.reason,
          },
          '[integration-service][solution][REOPEN_REASON_NOT_SENT_BY_RULE]',
        );
        return;
      }

      const buttons = await this.buildReopenReasonButtons(action);
      const sendReplyButtons = (this.metaClient as unknown as {
        sendReplyButtons?: (
          to: string,
          bodyText: string,
          buttons: Array<{ id: string; title: string }>,
        ) => Promise<unknown>;
      }).sendReplyButtons;
      const sendListMessage = (this.metaClient as unknown as {
        sendListMessage?: (
          to: string,
          bodyText: string,
          options: Array<{ id: string; title: string; description?: string }>,
          buttonText?: string,
          sectionTitle?: string,
        ) => Promise<unknown>;
      }).sendListMessage;
      const body = plan?.text.trim() || 'Qual o motivo da reabertura?';

      try {
        if (buttons.length <= 3 && typeof sendReplyButtons === 'function') {
          await sendReplyButtons.call(
            this.metaClient,
            toMeta,
            buildInteractiveButtonBodyWithNumericHint(body, buttons),
            buttons.map((button) => ({ ...button, title: truncateButtonTitle(button.title) })),
          );
        } else if (typeof sendListMessage === 'function') {
          await sendListMessage.call(
            this.metaClient,
            toMeta,
            buildInteractiveButtonBodyWithNumericHint(body, buttons),
            buttons.map((button) => ({
              id: button.id,
              title: truncateListTitle(button.title),
            })),
            'Motivos',
            'Reabertura',
          );
        } else {
          throw new Error('META_INTERACTIVE_LIST_UNAVAILABLE');
        }
      } catch (interactiveError: unknown) {
        logger.warn(
          {
            ticket_id: action.ticketId,
            conversation_id: action.conversationId,
            correlation_id: correlationId,
            event_key: 'reopen_reason_prompt',
            error_message: interactiveError instanceof Error ? interactiveError.message : String(interactiveError),
          },
          '[integration-service][solution][REOPEN_REASON_INTERACTIVE_FALLBACK_TEXT]',
        );
        await this.metaClient.sendTextMessage({
          to: toMeta,
          body: buildTextOptionsFallback(body, buttons),
        });
      }

      logger.info(
        {
          ticket_id: action.ticketId,
          conversation_id: action.conversationId,
          correlation_id: correlationId,
          event_key: 'reopen_reason_prompt',
        },
        '[integration-service][solution][SOLUTION_REOPEN_REASON_PROMPT_SENT]',
      );
    } catch (error: unknown) {
      logger.error(
        {
          ticket_id: action.ticketId,
          conversation_id: action.conversationId,
          correlation_id: correlationId,
          event_key: 'reopen_reason_prompt',
          error_code: 'REOPEN_REASON_PROMPT_SEND_FAILED',
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][solution][REOPEN_REASON_PROMPT_ERROR]',
      );
    }
  }

  private async buildReopenReasonButtons(
    action: ParsedSolutionButtonAction,
  ): Promise<Array<{ id: string; title: string }>> {
    const buttons: Array<{ id: string; title: string }> = [];
    for (const option of REOPEN_REASON_OPTIONS) {
      const message = await this.messageConfigurationService?.getMessage(option.eventKey);
      const title = selectSolutionMessageText(message).trim() || option.fallback;
      buttons.push({
        id: `solution_reopen_reason:${option.key}:${action.ticketId}:${action.conversationId}`,
        title,
      });
    }

    return buttons;
  }

  private async reopenReasonLabel(reason: ReopenReasonKey): Promise<string> {
    const option = REOPEN_REASON_OPTIONS.find((item) => item.key === reason);
    if (!option) {
      return reason;
    }

    const message = await this.messageConfigurationService?.getMessage(option.eventKey);
    return selectSolutionMessageText(message).trim() || option.fallback;
  }

  private async sendConfiguredCsatPrompt(
    toMeta: string,
    action: ParsedSolutionButtonAction,
    correlationId: string,
  ): Promise<void> {
    const defaultButtons = [
      { id: `solution_csat:very_satisfied:${action.ticketId}:${action.conversationId}`, title: 'Ótimo' },
      { id: `solution_csat:satisfied:${action.ticketId}:${action.conversationId}`, title: 'Bom' },
      { id: `solution_csat:dissatisfied:${action.ticketId}:${action.conversationId}`, title: 'Ruim' },
    ];

    try {
      const plan = await this.messageConfigurationService?.resolveSendPlan('csat_prompt', {
        windowOpen: true,
        allowTemplateSend: true,
      });
      if (plan && !plan.shouldSend) {
        logger.warn(
          {
            ticket_id: action.ticketId,
            conversation_id: action.conversationId,
            correlation_id: correlationId,
            event_key: 'csat_prompt',
            reason: plan.reason,
          },
          '[integration-service][solution][CSAT_NOT_SENT_BY_RULE]',
        );
        return;
      }

      const configuredTitles = (plan?.buttons ?? [])
        .map((button) => button.title.trim())
        .filter((title) => title !== '')
        .slice(0, 3);
      const buttons = defaultButtons.map((button, index) => ({
        ...button,
        title: configuredTitles[index] ?? button.title,
      }));
      await this.metaClient.sendReplyButtons(
        toMeta,
        buildInteractiveButtonBodyWithNumericHint(
          plan?.text.trim() || 'Como você avalia este atendimento?',
          buttons,
        ),
        buttons,
      );
      logger.info(
        {
          ticket_id: action.ticketId,
          conversation_id: action.conversationId,
          correlation_id: correlationId,
          event_key: 'csat_prompt',
        },
        '[integration-service][solution][CSAT_PROMPT_SENT]',
      );
    } catch (error: unknown) {
      logger.error(
        {
          ticket_id: action.ticketId,
          conversation_id: action.conversationId,
          correlation_id: correlationId,
          event_key: 'csat_prompt',
          error_code: 'CSAT_PROMPT_SEND_FAILED',
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][solution][CSAT_PROMPT_ERROR]',
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

  /**
   * Called when AI classification auto-applies a category (high confidence)
   * or when the user confirms the category (pressed 1).
   * Converts the candidate category into the same downstream flow as a manual menu pick.
   * PHASE: integaglpi_ai_category_classification_001
   */
  private async handleCategoryAutoApplied(input: {
    option: import('../../repositories/contracts/RoutingRepository.js').ActiveRoutingOption;
    conversation: { id: string; glpiEntityId?: number | null; profileCollectionState?: unknown };
    toMeta: string;
    inboundMessage: { messageId: string; messageText?: string | null; messageType?: string };
    contact: { phoneE164: string; id: string; name: string | null };
    correlationId: string;
    entityId: number;
    routingOptions: import('../../repositories/contracts/RoutingRepository.js').ActiveRoutingOption[];
    menuHeading: string;
    menuBody: string;
  }): Promise<void> {
    const { option, conversation, toMeta, inboundMessage, contact, correlationId, entityId, routingOptions, menuHeading, menuBody } = input;

    // Validate: category must belong to a valid option from this entity.
    if (!option.glpiItilCategoryId || option.glpiItilCategoryId <= 0) {
      logger.warn(
        { conversation_id: conversation.id, option_key: option.optionKey },
        '[integration-service][routing][AI_CATEGORY_INVALID_FALLBACK_TO_MENU]',
      );
      await this.sendRoutingMenu({ toMeta, routingOptions, menuHeading, menuBody, context: 'ai_invalid_category', conversationId: conversation.id });
      await this.messageRepository.updateState({ messageId: inboundMessage.messageId, conversationId: conversation.id, processingStatus: 'processed', glpiSyncStatus: 'synced' });
      return;
    }

    // Confirm to user.
    const confirmText = `✓ Categoria aplicada: *${option.label}*. Aguarde, vou registrar seu chamado.`;
    await this.metaClient.sendTextMessage({ to: toMeta, body: confirmText });

    logger.info(
      {
        conversation_id: conversation.id,
        category_id: option.glpiItilCategoryId,
        category_name: option.label,
        entity_id: entityId,
        ai_cloud: false,
      },
      '[integration-service][routing][AI_CATEGORY_APPLIED]',
    );

    // Persist the category in profileCollectionState so ticket creation picks it up.
    const existingState = (conversation.profileCollectionState ?? {}) as Record<string, unknown>;
    await this.conversationRepository.updateProfileCollectionState(conversation.id, {
      ...existingState,
      glpi_itil_category_id: option.glpiItilCategoryId,
    });

    await this.messageRepository.updateState({
      messageId: inboundMessage.messageId,
      conversationId: conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  }

  private async sendRoutingMenu(input: RoutingMenuSendInput): Promise<void> {
    const textBody = input.prefixText
      ? `${input.prefixText.trim()}\n\n${input.menuBody}`
      : input.menuBody;

    const interactiveBody = input.prefixText
      ? `${input.prefixText.trim()}\n\n${input.menuBody}`
      : input.menuBody;

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
          input.routingOptions.map((option, index) => ({
            id: option.optionKey,
            title: truncateButtonTitle(formatMenuOptionLabel(option.label, index)),
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
        this.recordRoutingMenuAudit(input, 'interactive');
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
    this.recordRoutingMenuAudit(input, 'text');
  }

  private recordRoutingMenuAudit(input: RoutingMenuSendInput, deliveryMode: 'interactive' | 'text'): void {
    this.recordAudit({
      correlationId: input.correlationId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      direction: 'outbound',
      eventType: 'ROUTING_MENU_SENT',
      status: 'success',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        context: input.context,
        options_count: input.routingOptions.length,
        delivery_mode: deliveryMode,
        option_keys: input.routingOptions.map((option) => option.optionKey),
      },
    });
  }

  private isAllowedPreTicketTextInput(inboundMessage: ParsedMetaInboundMessage): boolean {
    if (inboundMessage.messageType === 'text') {
      return typeof inboundMessage.messageText === 'string' && inboundMessage.messageText.trim() !== '';
    }

    if (inboundMessage.messageType === 'interactive') {
      return typeof inboundMessage.messageText === 'string' && inboundMessage.messageText.trim() !== '';
    }

    return false;
  }

  private shouldRejectPreTicketInput(inboundMessage: ParsedMetaInboundMessage): boolean {
    return this.isBlockedPreTicketInputType(inboundMessage.messageType)
      || !this.isAllowedPreTicketTextInput(inboundMessage);
  }

  private isBlockedPreTicketInputType(messageType: string): boolean {
    return PRETICKET_BLOCKED_INPUT_TYPES.has(messageType.trim().toLowerCase());
  }

  private appendPreTicketCancelHint(body: string, state?: ContactProfileCollectionState | null): string {
    const normalized = body.trim();
    if (!this.shouldAppendPreTicketCancelHint(state)) {
      return normalized;
    }

    if (normalized.toLowerCase().includes('digite cancelar')) {
      return normalized;
    }

    return `${normalized}\n\n${PRETICKET_CANCEL_HINT}`;
  }

  private shouldAppendPreTicketCancelHint(state?: ContactProfileCollectionState | null): boolean {
    if (state?.step !== 'awaiting_company' && state?.step !== 'asking_company') {
      return false;
    }

    return !state.company_name_raw
      && !state.requester_name
      && !state.email_address
      && !state.last_equipment_tag
      && state.equipment_tag_unknown !== true
      && !state.reason;
  }

  private resolvePreTicketInvalidInputFallback(
    profileStep: string | null,
    blockedMedia: boolean,
  ): string {
    if (profileStep === 'awaiting_problem_summary' || profileStep === 'asking_reason') {
      return PRETICKET_INVALID_REASON_INPUT_TEXT;
    }

    if (blockedMedia) {
      return PRETICKET_INVALID_INPUT_TEXT;
    }

    return PRETICKET_INVALID_INPUT_TEXT;
  }

  private isPreTicketCancelText(text: string | null): boolean {
    const normalized = (text ?? '').trim().toLowerCase();
    return PRETICKET_CANCEL_WORDS.has(normalized);
  }

  private async tryCancelPreTicketFromInbound(input: {
    contact: Contact;
    conversation: Conversation;
    inboundMessage: ParsedMetaInboundMessage;
    toMeta: string;
    correlationId: string;
    state: Record<string, unknown> | null;
  }): Promise<boolean> {
    if (!this.isPreTicketCancelText(input.inboundMessage.messageText)) {
      return false;
    }

    const closeState = {
      ...(input.state ?? {}),
      close_reason: 'preticket_user_cancelled',
      preticket_cancelled_at: new Date().toISOString(),
    };
    await this.conversationRepository.updateProfileCollectionState(input.conversation.id, closeState);
    await this.conversationRepository.updateStatus(input.conversation.id, 'cancelled');
    await this.sendConfiguredPreTicketMessage({
      toMeta: input.toMeta,
      eventKey: PRETICKET_USER_CANCELLED_EVENT_KEY,
      fallbackText: PRETICKET_USER_CANCELLED_TEXT,
      correlationId: input.correlationId,
      conversationId: input.conversation.id,
      messageId: input.inboundMessage.messageId,
      phoneE164: input.contact.phoneE164,
      allowCancelHint: this.shouldAppendPreTicketCancelHint(
        input.state as ContactProfileCollectionState | null,
      ),
    });
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: input.conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
    logger.info(
      {
        conversation_id: input.conversation.id,
        message_type: input.inboundMessage.messageType,
        event_type: 'PRETICKET_CANCELLED_BY_USER',
        status: 'success',
      },
      '[integration-service][preticket][CANCELLED_BY_USER]',
    );
    this.recordAudit({
      correlationId: input.correlationId,
      conversationId: input.conversation.id,
      messageId: input.inboundMessage.messageId,
      direction: 'inbound',
      eventType: 'PRETICKET_CANCELLED_BY_USER',
      status: 'success',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        close_reason: 'preticket_user_cancelled',
        glpi_ticket_created: false,
        csat_suppressed: true,
      },
    });

    return true;
  }

  private async tryCancelOpenTicketFromInbound(input: {
    contact: Contact;
    conversation: Conversation;
    ticketId: number;
    inboundMessage: ParsedMetaInboundMessage;
    correlationId: string;
  }): Promise<boolean> {
    if (!this.isPreTicketCancelText(input.inboundMessage.messageText)) {
      return false;
    }

    const content = OPEN_TICKET_USER_CANCELLED_CONTENT;

    await this.glpiClient.updateTicketStatus(input.ticketId, GLPI_STATUS_CLOSED, {
      content,
      _accepted: 1,
    });
    await this.conversationRepository.updateStatus(input.conversation.id, 'closed');
    await this.conversationRepository.touch(input.conversation.id, new Date());
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: input.conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });

    logger.info(
      {
        conversation_id: input.conversation.id,
        ticket_id: input.ticketId,
        event_type: 'OPEN_TICKET_CANCELLED_BY_USER',
        status: 'success',
      },
      '[integration-service][inbound][OPEN_TICKET_CANCELLED_BY_USER]',
    );
    this.recordAudit({
      correlationId: input.correlationId,
      ticketId: input.ticketId,
      conversationId: input.conversation.id,
      messageId: input.inboundMessage.messageId,
      direction: 'inbound',
      eventType: 'OPEN_TICKET_CANCELLED_BY_USER',
      status: 'success',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        close_reason: 'customer_requested_cancel_via_whatsapp',
        glpi_ticket_closed: true,
        csat_suppressed: true,
      },
    });

    return true;
  }

  private async handleInvalidPreTicketInput(input: {
    contact: Contact;
    conversation: Conversation;
    inboundMessage: ParsedMetaInboundMessage;
    toMeta: string;
    correlationId: string;
    state: Record<string, unknown> | null;
  }): Promise<void> {
    const profileStep = typeof input.state?.step === 'string' ? input.state.step : null;
    const blockedMedia = this.isBlockedPreTicketInputType(input.inboundMessage.messageType);
    await this.sendConfiguredPreTicketMessage({
      toMeta: input.toMeta,
      eventKey: PRETICKET_INVALID_INPUT_EVENT_KEY,
      fallbackText: this.resolvePreTicketInvalidInputFallback(profileStep, blockedMedia),
      correlationId: input.correlationId,
      conversationId: input.conversation.id,
      messageId: input.inboundMessage.messageId,
      phoneE164: input.contact.phoneE164,
      allowCancelHint: this.shouldAppendPreTicketCancelHint(
        input.state as ContactProfileCollectionState | null,
      ),
    });
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: input.conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
    logger.info(
      {
        conversation_id: input.conversation.id,
        phone_masked: this.maskPhoneE164(input.contact.phoneE164),
        message_type: input.inboundMessage.messageType,
        profile_step: profileStep,
        event_type: blockedMedia ? 'PRETICKET_MEDIA_INPUT_BLOCKED' : 'PRETICKET_INVALID_INPUT_BLOCKED',
        status: 'ignored',
      },
      '[integration-service][preticket][INVALID_INPUT_BLOCKED]',
    );
    this.recordAudit({
      correlationId: input.correlationId,
      conversationId: input.conversation.id,
      messageId: input.inboundMessage.messageId,
      direction: 'inbound',
      eventType: blockedMedia ? 'PRETICKET_MEDIA_INPUT_BLOCKED' : 'INVALID_MIME_INPUT_REJECTED_AT_PRETICKET',
      status: 'ignored',
      severity: 'warning',
      source: 'InboundWebhookService',
      payload: {
        message_type: input.inboundMessage.messageType,
        phone_masked: this.maskPhoneE164(input.contact.phoneE164),
        profile_step: profileStep,
        blocked_before_download: true,
        state_preserved: true,
        glpi_ticket_created: false,
      },
    });
  }

  private async sendConfiguredPreTicketMessage(input: {
    toMeta: string;
    eventKey: string;
    fallbackText: string;
    correlationId: string;
    conversationId: string;
    messageId: string;
    phoneE164: string;
    allowCancelHint: boolean;
  }): Promise<boolean> {
    const plan = this.messageConfigurationService
      ? await this.messageConfigurationService.resolveSendPlan(input.eventKey, {
        windowOpen: true,
        allowTemplateSend: true,
      })
      : this.buildFallbackPreTicketSendPlan(input.eventKey, input.fallbackText);

    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: input.conversationId,
      phoneE164: input.phoneE164,
      eventKey: input.eventKey,
      status: 'planned',
      reason: plan.reason,
    });

    if (!plan.shouldSend) {
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversationId,
        phoneE164: input.phoneE164,
        eventKey: input.eventKey,
        status: 'not_sent_by_rule',
        reason: plan.reason ?? 'not_sent_by_rule',
      });
      this.recordAudit({
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        direction: 'outbound',
        eventType: 'PRETICKET_MESSAGE_SKIPPED',
        status: 'ignored',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: {
          event_key: input.eventKey,
          reason: plan.reason ?? 'not_sent_by_rule',
        },
      });
      return false;
    }

    try {
      if (plan.sendType === 'template') {
        const sendTemplateMessage = (this.metaClient as unknown as {
          sendTemplateMessage?: (payload: {
            to: string;
            templateName: string;
            language: string;
            parameters?: string[];
          }) => Promise<unknown>;
        }).sendTemplateMessage;
        if (!plan.templateName || typeof sendTemplateMessage !== 'function') {
          throw new Error('PRETICKET_TEMPLATE_UNAVAILABLE');
        }
        await sendTemplateMessage.call(this.metaClient, {
          to: input.toMeta,
          templateName: plan.templateName,
          language: plan.language,
          parameters: [],
        });
      } else {
        await this.metaClient.sendTextMessage({
          to: input.toMeta,
          body: this.normalizePreTicketCancelHint(plan.text || input.fallbackText, input.allowCancelHint),
        });
      }
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversationId,
        phoneE164: input.phoneE164,
        eventKey: input.eventKey,
        status: 'sent',
      });
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversationId,
        phoneE164: input.phoneE164,
        eventKey: input.eventKey,
        status: 'failed',
        errorCode: 'PRETICKET_MESSAGE_SEND_FAILED',
        errorMessageSanitized: message.slice(0, 500),
      });
      this.recordAudit({
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        direction: 'outbound',
        eventType: 'PRETICKET_MESSAGE_FAILED',
        status: 'failed',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: {
          event_key: input.eventKey,
          error_message: message.slice(0, 500),
        },
      });
      return false;
    }
  }

  private buildFallbackPreTicketSendPlan(eventKey: string, fallbackText: string): MessageSendPlan {
    return {
      eventKey,
      sendType: 'text',
      text: fallbackText,
      active: true,
      shouldSend: true,
      reason: null,
      templateName: null,
      language: 'pt_BR',
      buttons: [],
      listOptions: [],
    };
  }

  private normalizePreTicketCancelHint(body: string, allowHint: boolean): string {
    const normalized = body.trim();
    if (allowHint) {
      if (normalized.toLowerCase().includes('digite cancelar')) {
        return normalized;
      }

      return `${normalized}\n\n${PRETICKET_CANCEL_HINT}`;
    }

    return normalized
      .replace(/\s*Se quiser encerrar este atendimento, digite cancelar a qualquer momento\.?/giu, '')
      .replace(/\s*Se quiser encerrar, digite cancelar\.?/giu, '')
      .trim();
  }

  private maskPhoneE164(phoneE164: string): string {
    const digits = phoneE164.replace(/\D/g, '');
    if (digits.length < 8) {
      return '******';
    }

    return `${digits.slice(0, 2)}******${digits.slice(-4)}`;
  }

  private async sendCsatThankYouClosure(input: {
    toMeta: string;
    conversation: Conversation;
    ticketId: number;
    correlationId: string;
    messageId: string;
  }): Promise<void> {
    // The CSAT button is an inbound customer interaction; the thank-you reply
    // is inside the service window even when the stored closed conversation
    // activity is older than 24h.
    const windowOpen = true;
    const plan = this.messageConfigurationService
      ? await this.messageConfigurationService.resolveSendPlan(CSAT_THANK_YOU_CLOSURE_EVENT_KEY, {
        windowOpen,
        allowTemplateSend: true,
      })
      : {
        eventKey: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
        sendType: 'text' as const,
        text: CSAT_THANK_YOU_CLOSURE_TEXT,
        active: true,
        shouldSend: true,
        reason: null,
        templateName: null,
        language: 'pt_BR',
        buttons: [],
        listOptions: [],
      };

    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: input.conversation.id,
      phoneE164: input.conversation.phoneE164,
      eventKey: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
      status: 'planned',
      reason: plan.reason,
    });

    if (!plan.shouldSend) {
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversation.id,
        phoneE164: input.conversation.phoneE164,
        eventKey: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
        status: 'not_sent_by_rule',
        reason: plan.reason ?? 'not_sent_by_rule',
      });
      this.recordAudit({
        correlationId: input.correlationId,
        ticketId: input.ticketId,
        conversationId: input.conversation.id,
        messageId: input.messageId,
        direction: 'outbound',
        eventType: 'CSAT_THANK_YOU_CLOSURE_SKIPPED',
        status: 'ignored',
        severity: 'info',
        source: 'InboundWebhookService',
        payload: {
          event_key: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
          reason: plan.reason ?? 'not_sent_by_rule',
          window_open: windowOpen,
        },
      });
      logger.info(
        {
          ticket_id: input.ticketId,
          conversation_id: input.conversation.id,
          correlation_id: input.correlationId,
          event_key: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
          reason: plan.reason,
        },
        '[integration-service][solution][CSAT_THANK_YOU_CLOSURE_SKIPPED]',
      );
      return;
    }

    try {
      if (plan.sendType === 'template') {
        const sendTemplateMessage = (this.metaClient as unknown as {
          sendTemplateMessage?: (payload: {
            to: string;
            templateName: string;
            language: string;
            parameters?: string[];
          }) => Promise<unknown>;
        }).sendTemplateMessage;
        if (!plan.templateName || typeof sendTemplateMessage !== 'function') {
          throw new Error('CSAT_THANK_YOU_TEMPLATE_UNAVAILABLE');
        }
        await sendTemplateMessage.call(this.metaClient, {
          to: input.toMeta,
          templateName: plan.templateName,
          language: plan.language,
          parameters: [],
        });
      } else {
        await this.metaClient.sendTextMessage({
          to: input.toMeta,
          body: plan.text.trim() || CSAT_THANK_YOU_CLOSURE_TEXT,
        });
      }

      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversation.id,
        phoneE164: input.conversation.phoneE164,
        eventKey: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
        status: 'sent',
      });
      this.recordAudit({
        correlationId: input.correlationId,
        ticketId: input.ticketId,
        conversationId: input.conversation.id,
        messageId: input.messageId,
        direction: 'outbound',
        eventType: 'CSAT_THANK_YOU_CLOSURE_SENT',
        status: 'success',
        severity: 'info',
        source: 'InboundWebhookService',
        payload: {
          event_key: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
          window_open: windowOpen,
        },
      });
      logger.info(
        {
          ticket_id: input.ticketId,
          conversation_id: input.conversation.id,
          correlation_id: input.correlationId,
          event_key: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
        },
        '[integration-service][solution][CSAT_THANK_YOU_CLOSURE_SENT]',
      );
    } catch (error: unknown) {
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversation.id,
        phoneE164: input.conversation.phoneE164,
        eventKey: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
        status: 'failed',
        errorMessageSanitized: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
      this.recordAudit({
        correlationId: input.correlationId,
        ticketId: input.ticketId,
        conversationId: input.conversation.id,
        messageId: input.messageId,
        direction: 'outbound',
        eventType: 'CSAT_THANK_YOU_CLOSURE_FAILED',
        status: 'failed',
        severity: 'warning',
        source: 'InboundWebhookService',
        errorMessage: error instanceof Error ? error.message : String(error),
        payload: {
          event_key: CSAT_THANK_YOU_CLOSURE_EVENT_KEY,
        },
      });
      logger.warn(
        {
          ticket_id: input.ticketId,
          conversation_id: input.conversation.id,
          correlation_id: input.correlationId,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][solution][CSAT_THANK_YOU_CLOSURE_FAILED]',
      );
    }
  }

  private nowProvider(): Date {
    return new Date();
  }

  private async sendContactProfilePrompt(input: {
    toMeta: string;
    body: string;
    state?: ContactProfileCollectionState | null;
    conversationId?: string | null;
  }): Promise<void> {
    const bodyWithHint = this.appendPreTicketCancelHint(input.body, input.state);
    const sendReplyButtons = (this.metaClient as unknown as {
      sendReplyButtons?: (
        to: string,
        bodyText: string,
        buttons: Array<{ id: string; title: string }>,
      ) => Promise<unknown>;
    }).sendReplyButtons;

    if (input.state?.step === 'confirming_existing_profile' && typeof sendReplyButtons === 'function') {
      try {
        await sendReplyButtons.call(this.metaClient, input.toMeta, bodyWithHint, [
          { id: 'profile_confirm_yes', title: '1 - Sim' },
          { id: 'profile_confirm_no', title: '2 - Nao' },
        ]);
        logger.info(
          { conversation_id: input.conversationId ?? null },
          '[integration-service][contact_profile][PROFILE_CONFIRMATION_BUTTONS_SENT]',
        );
        return;
      } catch (error: unknown) {
        logger.warn(
          {
            conversation_id: input.conversationId ?? null,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][contact_profile][PROFILE_CONFIRMATION_BUTTONS_FALLBACK_TEXT]',
        );
      }
    }

    if (
      (input.state?.step === 'awaiting_equipment_tag' || input.state?.step === 'asking_tag')
      && typeof sendReplyButtons === 'function'
    ) {
      try {
        await sendReplyButtons.call(this.metaClient, input.toMeta, bodyWithHint, [
          { id: 'TAG_UNKNOWN', title: '1 - Não sei' },
        ]);
        logger.info(
          { conversation_id: input.conversationId ?? null },
          '[integration-service][contact_profile][TAG_UNKNOWN_BUTTON_SENT]',
        );
        return;
      } catch (error: unknown) {
        logger.warn(
          {
            conversation_id: input.conversationId ?? null,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][contact_profile][TAG_UNKNOWN_BUTTON_FALLBACK_TEXT]',
        );
      }
    }

    await this.metaClient.sendTextMessage({ to: input.toMeta, body: bodyWithHint });
  }

  private async advanceCompletedProfileConversation(input: CompletedProfileTransitionInput): Promise<void> {
    const profile = this.contactProfileService
      ? await this.contactProfileService.findProfile(input.contact.phoneE164)
      : null;
    const resolvedEntity = await this.resolveEntityFromEquipmentTagOrMemory({
      phoneE164: input.contact.phoneE164,
      contactId: input.contact.id,
      profile,
      conversationId: input.conversation.id,
    });
    if (!resolvedEntity) {
      await this.deferTicketCreationForEntitySelection({
        contact: input.contact,
        inboundMessage: input.inboundMessage,
        toMeta: input.toMeta,
        conversationId: input.conversation.id,
        queueId: input.conversation.queueId,
        message: ENTITY_SELECTION_PENDING_MESSAGE,
      });
      logger.info(
        { conversation_id: input.conversation.id },
        '[integration-service][contact_profile][COMPLETE_PROFILE_ENTITY_PENDING]',
      );
      return;
    }

    const assignment = input.conversation.queueId
      ? await this.routingRepository.findAssignmentByQueueId(input.conversation.queueId)
      : null;
    const entityMode = this.contactEntityResolutionService
      ? await this.contactEntityResolutionService.getMode()
      : 'defer_until_known';
    const state = input.conversation.profileCollectionState ?? {};
    const queueLabel = typeof state.queue_label === 'string' && state.queue_label.trim() !== ''
      ? state.queue_label.trim()
      : assignment?.queueId
        ? `Fila ${assignment.queueId}`
        : null;
    const ticketPayload = await this.buildProfileAwareTicketPayload({
      basePayload: this.buildNewTicketPayload(input.contact, input.inboundMessage),
      contact: input.contact,
      conversationId: input.conversation.id,
      queueLabel,
      profile,
      entityMode,
    });
    const requesterUserId = await this.resolveRequesterUserId(
      input.contact.phoneE164,
      profile,
      resolvedEntity.glpiEntityId,
      input.conversation.id,
    );
    const nativeItilCategoryId = this.resolveTicketCategoryId(
      typeof state.glpi_itil_category_id === 'number' ? state.glpi_itil_category_id : null,
    );
    const nativeFormId = this.resolveTicketFormId(
      typeof state.glpi_form_id === 'number' ? state.glpi_form_id : null,
      nativeItilCategoryId,
    );
    const ticketId = await this.createTicketWithNativeCategoryFallback(
      {
        title: ticketPayload.title,
        content: ticketPayload.content,
        requesterPhone: input.contact.phoneE164,
        requesterName: input.contact.name,
        entitiesId: resolvedEntity.glpiEntityId,
        assignedUserId: assignment?.glpiUserId ?? null,
        assignedGroupId: assignment?.glpiGroupId ?? null,
        requesterUserId,
        itilcategoriesId: nativeItilCategoryId,
        glpiFormId: nativeFormId,
      },
      { timeoutMs: ROUTING_GLPI_CREATE_TIMEOUT_MS },
      { conversationId: input.conversation.id, stage: 'complete_profile_transition' },
    );
    this.logTicketCreatedWithFallback(input.contact, input.inboundMessage.messageId, ticketId);
    // PHASE: integaglpi_asset_context_summary_001 — fire-and-forget, nunca bloqueia.
    if (nativeItilCategoryId === null) {
      this.recordManualCategoryPending({
        conversationId: input.conversation.id,
        messageId: input.inboundMessage.messageId,
        ticketId,
        entityId: resolvedEntity.glpiEntityId,
        stage: 'complete_profile_transition',
      });
    }
    this.triggerAssetContextSummary(ticketId, resolvedEntity.glpiEntityId, profile, input.conversation.id);

    const linked = await this.conversationRepository.linkGlpiTicket(
      input.conversation.id,
      ticketId,
      input.conversation.queueId,
      resolvedEntity.glpiEntityId,
      resolvedEntity.glpiEntityName,
    );
    if (linked) {
      await this.metaClient.sendTextMessage({
        to: input.toMeta,
        body: await this.buildTicketCreatedConfirmation(null, ticketId),
      });
    }
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: input.conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: linked ? 'synced' : 'error',
    });
    logger.info(
      {
        conversation_id: input.conversation.id,
        glpi_ticket_id: ticketId,
        glpi_entity_id: resolvedEntity.glpiEntityId,
        linked,
      },
      '[integration-service][contact_profile][COMPLETE_PROFILE_TICKET_CREATED_FROM_MEMORY]',
    );
  }

  private async handleCategoryDisabledProblemDescription(input: CompletedProfileTransitionInput & {
    routingOptions: ActiveRoutingOption[];
    menuHeading: string;
    menuBody: string;
  }): Promise<void> {
    const descriptionText = input.inboundMessage.messageText?.trim() ?? '';
    if (!descriptionText) {
      await this.metaClient.sendTextMessage({
        to: input.toMeta,
        body: 'Qual o motivo do seu contato? Resuma em até 200 caracteres.',
      });
      await this.messageRepository.updateState({
        messageId: input.inboundMessage.messageId,
        conversationId: input.conversation.id,
        processingStatus: 'processed',
        glpiSyncStatus: 'synced',
      });
      return;
    }

    const existingState = input.conversation.profileCollectionState ?? {};
    await this.conversationRepository.updateProfileCollectionState(input.conversation.id, {
      ...existingState,
      step: 'complete',
      reason: descriptionText,
      last_problem_summary: descriptionText,
      category_classification_enabled: false,
    });

    if (this.contactProfileService) {
      const profile = await this.contactProfileService.findProfile(input.contact.phoneE164);
      if (profile) {
        await this.contactProfileService.saveProfileData(
          input.contact.phoneE164,
          {
            ...profile,
            last_problem_summary: descriptionText,
            profile_status: 'complete',
            last_confirmed_at: new Date().toISOString(),
            last_conversation_id: input.conversation.id,
          },
          input.conversation.id,
        );
        this.recordAudit({
          eventType: 'CATEGORY_CLASSIFICATION_DISABLED_PROBLEM_SUMMARY_ACCEPTED',
          conversationId: input.conversation.id,
          status: 'success',
          severity: 'info',
          source: 'InboundWebhookService',
          payload: {
            ai_category_classification_enabled: false,
            description_hash: descriptionText.slice(0, 60).replace(/./g, '#'),
          },
        });
        await this.advanceCompletedProfileConversation({
          contact: input.contact,
          inboundMessage: input.inboundMessage,
          toMeta: input.toMeta,
          conversation: {
            ...input.conversation,
            profileCollectionState: {
              ...existingState,
              step: 'complete',
              reason: descriptionText,
              last_problem_summary: descriptionText,
              category_classification_enabled: false,
            },
          },
        });
        return;
      }
    }

    await this.conversationRepository.updateStatus(input.conversation.id, 'awaiting_queue_selection');
    await this.sendRoutingMenu({
      toMeta: input.toMeta,
      routingOptions: input.routingOptions,
      menuHeading: input.menuHeading,
      menuBody: input.menuBody,
      context: 'category_classification_disabled',
      conversationId: input.conversation.id,
      prefixText: 'Resumo recebido. Escolha a fila de atendimento:',
    });
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: input.conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });
  }

  private async acknowledgeExistingEntitySelectionWait(input: ExistingEntitySelectionWaitInput): Promise<void> {
    const options = await this.resolveEntitySelectionOptions(input.conversation);
    const rawChoice = input.inboundMessage.messageText?.trim() ?? '';
    const selectedIndex = parseMenuDigitChoice(rawChoice, options.length);

    if (!selectedIndex || options.length === 0) {
      await this.sendEntitySelectionMenu({
        toMeta: input.toMeta,
        conversation: input.conversation,
        options,
        reason: selectedIndex ? 'no_entity_options' : 'invalid_entity_selection',
      });
      await this.messageRepository.updateState({
        messageId: input.inboundMessage.messageId,
        conversationId: input.conversation.id,
        processingStatus: 'processed',
        glpiSyncStatus: 'synced',
      });
      return;
    }

    const selectedEntity = options[selectedIndex - 1]!;
    const profile = this.contactProfileService
      ? await this.contactProfileService.findProfile(input.contact.phoneE164)
      : null;
    const assignment = input.conversation.queueId
      ? await this.routingRepository.findAssignmentByQueueId(input.conversation.queueId)
      : null;
    const entityMode = this.contactEntityResolutionService
      ? await this.contactEntityResolutionService.getMode()
      : 'defer_until_known';
    const queueLabel = assignment?.queueId ? `Fila ${assignment.queueId}` : null;
    const ticketPayload = await this.buildProfileAwareTicketPayload({
      basePayload: await this.buildEntitySelectionTicketBasePayload(input.contact, input.conversation),
      contact: input.contact,
      conversationId: input.conversation.id,
      queueLabel,
      profile,
      entityMode,
    });
    const requesterUserId = await this.resolveRequesterUserId(
      input.contact.phoneE164,
      profile,
      selectedEntity.id,
      input.conversation.id,
    );
    const ticketId = await this.createTicketWithNativeCategoryFallback(
      {
        title: ticketPayload.title,
        content: ticketPayload.content,
        requesterPhone: input.contact.phoneE164,
        requesterName: input.contact.name,
        entitiesId: selectedEntity.id,
        assignedUserId: assignment?.glpiUserId ?? null,
        assignedGroupId: assignment?.glpiGroupId ?? null,
        requesterUserId,
        itilcategoriesId: null,
        glpiFormId: null,
      },
      { timeoutMs: ROUTING_GLPI_CREATE_TIMEOUT_MS },
      { conversationId: input.conversation.id, stage: 'whatsapp_entity_selection' },
    );
    this.logTicketCreatedWithFallback(input.contact, input.inboundMessage.messageId, ticketId);
    this.recordManualCategoryPending({
      correlationId: input.correlationId,
      conversationId: input.conversation.id,
      messageId: input.inboundMessage.messageId,
      ticketId,
      entityId: selectedEntity.id,
      stage: 'whatsapp_entity_selection',
    });
    this.triggerAssetContextSummary(ticketId, selectedEntity.id, profile, input.conversation.id);

    const linked = await this.conversationRepository.linkGlpiTicket(
      input.conversation.id,
      ticketId,
      input.conversation.queueId,
      selectedEntity.id,
      selectedEntity.completename || selectedEntity.name,
    );

    if (this.contactEntityMemoryRepository) {
      try {
        await this.contactEntityMemoryRepository.rememberEntityForPhone({
          phoneE164: input.contact.phoneE164,
          contactId: input.contact.id,
          glpiEntityId: selectedEntity.id,
          glpiEntityName: selectedEntity.completename || selectedEntity.name,
          sourceTicketId: ticketId,
          sourceConversationId: input.conversation.id,
          source: 'whatsapp_entity_selection',
        });
      } catch (error: unknown) {
        logger.warn(
          {
            conversation_id: input.conversation.id,
            glpi_entity_id: selectedEntity.id,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][entity][WHATSAPP_ENTITY_MEMORY_SAVE_FAILED]',
        );
      }
    }

    if (linked) {
      await this.metaClient.sendTextMessage({
        to: input.toMeta,
        body: await this.buildTicketCreatedConfirmation(null, ticketId),
      });
    }
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId: input.conversation.id,
      processingStatus: 'processed',
      glpiSyncStatus: linked ? 'synced' : 'error',
    });
    logger.info(
      {
        conversation_id: input.conversation.id,
        glpi_ticket_id: ticketId,
        glpi_entity_id: selectedEntity.id,
        linked,
      },
      '[integration-service][entity][WHATSAPP_ENTITY_SELECTION_TICKET_CREATED]',
    );
  }

  private async buildEntitySelectionTicketBasePayload(
    contact: Contact,
    conversation: Conversation,
  ): Promise<{ title: string; content: string }> {
    const profile = this.contactProfileService
      ? await this.contactProfileService.findProfile(contact.phoneE164)
      : null;
    const summary = typeof profile?.last_problem_summary === 'string'
      ? profile.last_problem_summary.trim()
      : '';
    const messages = summary === ''
      ? await this.messageRepository.findByConversationId(conversation.id, 20).catch(() => [])
      : [];
    const latestText = messages
      .map((message) => typeof message.messageText === 'string' ? message.messageText.trim() : '')
      .reverse()
      .find((text) => text !== '' && parseMenuDigitChoice(text, 99) === null) ?? '';
    const problem = summary || latestText || 'Solicitação recebida via WhatsApp; entidade selecionada pelo cliente.';
    const titleProblem = problem.length > 70 ? `${problem.slice(0, 67)}...` : problem;

    return {
      title: `[WA] ${titleProblem}`,
      content: [
        'Solicitação recebida via WhatsApp.',
        '',
        `Resumo informado: ${problem}`,
        '',
        'Categoria: pendente de classificação manual pelo técnico.',
      ].join('\n'),
    };
  }

  private async resolveEntitySelectionOptions(conversation: Conversation): Promise<GlpiEntityOption[]> {
    const state = conversation.profileCollectionState ?? {};
    const stored = Array.isArray(state.entity_selection_options) ? state.entity_selection_options : [];
    const parsed = stored
      .map((entry): GlpiEntityOption | null => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const row = entry as Record<string, unknown>;
        const id = typeof row.id === 'number' && Number.isInteger(row.id) && row.id > 0 ? row.id : null;
        if (id === null) {
          return null;
        }
        const name = typeof row.name === 'string' && row.name.trim() !== '' ? row.name.trim() : `Entidade ${id}`;
        const completename = typeof row.completename === 'string' && row.completename.trim() !== ''
          ? row.completename.trim()
          : name;
        return { id, name, completename };
      })
      .filter((entry): entry is GlpiEntityOption => entry !== null);
    if (parsed.length > 0) {
      return parsed.slice(0, 9);
    }

    const fetchEntities = (this.glpiClient as unknown as {
      fetchEntities?: (limit?: number) => Promise<GlpiEntityOption[]>;
    }).fetchEntities;
    return typeof fetchEntities === 'function'
      ? fetchEntities.call(this.glpiClient, 9).catch(() => [])
      : [];
  }

  private async sendEntitySelectionMenu(input: {
    toMeta: string;
    conversation: Conversation;
    options?: GlpiEntityOption[];
    reason: string;
  }): Promise<void> {
    const options = (input.options ?? await this.resolveEntitySelectionOptions(input.conversation)).slice(0, 9);
    if (options.length === 0) {
      await this.metaClient.sendTextMessage({ to: input.toMeta, body: ENTITY_SELECTION_PENDING_MESSAGE });
      this.recordAudit({
        conversationId: input.conversation.id,
        direction: 'outbound',
        eventType: 'ENTITY_SELECTION_MENU_UNAVAILABLE',
        status: 'pending',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: { reason: input.reason },
      });
      return;
    }

    const state = input.conversation.profileCollectionState ?? {};
    await this.conversationRepository.updateProfileCollectionState(input.conversation.id, {
      ...state,
      entity_selection_options: options.map((option) => ({
        id: option.id,
        name: option.name,
        completename: option.completename,
      })),
    });
    const body = [
      'Para abrir o chamado, selecione a entidade:',
      ...options.map((option, index) => `${index + 1} - ${option.completename || option.name}`),
      '',
      'Responda apenas com o número da entidade.',
    ].join('\n');
    await this.metaClient.sendTextMessage({ to: input.toMeta, body });
    this.recordAudit({
      conversationId: input.conversation.id,
      direction: 'outbound',
      eventType: 'ENTITY_SELECTION_MENU_SENT',
      status: 'success',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        reason: input.reason,
        options_count: options.length,
      },
    });
  }

  private recordManualCategoryPending(input: {
    correlationId?: string | null;
    conversationId: string;
    messageId?: string | null;
    ticketId: number;
    entityId: number;
    stage: string;
  }): void {
    this.recordAudit({
      correlationId: input.correlationId ?? undefined,
      ticketId: input.ticketId,
      conversationId: input.conversationId,
      messageId: input.messageId ?? undefined,
      direction: 'inbound',
      eventType: 'CATEGORY_PENDING_MANUAL_TECHNICIAN',
      status: 'pending',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        stage: input.stage,
        glpi_entity_id: input.entityId,
        itilcategories_id: null,
        ai_category_enabled: false,
      },
    });
  }

  private async findRememberedEntity(phoneE164: string): Promise<ContactEntityMemory | null> {
    const rememberedEntity = this.contactEntityMemoryRepository
      ? await this.contactEntityMemoryRepository.findActiveByPhone(phoneE164)
      : null;

    if (!rememberedEntity || !Number.isInteger(rememberedEntity.glpiEntityId) || rememberedEntity.glpiEntityId <= 0) {
      return null;
    }

    return rememberedEntity;
  }

  private async resolveEntityFromEquipmentTagOrMemory(input: {
    phoneE164: string;
    contactId: string | null;
    profile: ContactProfileData | null;
    conversationId: string | null;
  }): Promise<ContactEntityMemory | null> {
    const rememberedEntity = await this.findRememberedEntity(input.phoneE164);
    const equipmentTag = this.extractProfileEquipmentTag(input.profile);

    if (equipmentTag === null) {
      return rememberedEntity;
    }

    let assets: Awaited<ReturnType<GlpiClient['findComputersByOtherserial']>>;
    try {
      assets = await this.glpiClient.findComputersByOtherserial(equipmentTag, 10);
    } catch (error: unknown) {
      logger.warn(
        {
          conversation_id: input.conversationId,
          equipment_tag: equipmentTag,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][entity][ASSET_TAG_LOOKUP_FAILED_USING_MEMORY]',
      );
      this.recordAudit({
        conversationId: input.conversationId ?? undefined,
        direction: 'inbound',
        eventType: 'CONTACT_ENTITY_ASSET_TAG_LOOKUP_FAILED',
        status: 'failed',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: {
          equipment_tag: equipmentTag,
          fallback: rememberedEntity ? 'contact_memory' : 'manual_entity_selection',
        },
      });
      return rememberedEntity;
    }

    if (assets.length === 0) {
      const logmeinEntity = await this.resolveEntityFromLogmeinCache({
        phoneE164: input.phoneE164,
        contactId: input.contactId,
        conversationId: input.conversationId,
        equipmentTag,
        previousEntity: rememberedEntity,
      });
      return logmeinEntity ?? rememberedEntity;
    }

    if (assets.length > 1) {
      logger.warn(
        {
          conversation_id: input.conversationId,
          equipment_tag: equipmentTag,
          asset_matches: assets.length,
        },
        '[integration-service][entity][ASSET_TAG_DUPLICATE_ENTITY_SELECTION_REQUIRED]',
      );
      this.recordAudit({
        conversationId: input.conversationId ?? undefined,
        direction: 'inbound',
        eventType: 'CONTACT_ENTITY_ASSET_TAG_DUPLICATE',
        status: 'pending',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: {
          equipment_tag: equipmentTag,
          asset_matches: assets.length,
          action: 'manual_entity_selection',
        },
      });
      return null;
    }

    const asset = assets[0];
    if (asset.entitiesId === null || asset.entitiesId <= 0) {
      logger.warn(
        {
          conversation_id: input.conversationId,
          equipment_tag: equipmentTag,
          asset_id: asset.id,
        },
        '[integration-service][entity][ASSET_TAG_WITHOUT_ENTITY_USING_MEMORY]',
      );
      const logmeinEntity = await this.resolveEntityFromLogmeinCache({
        phoneE164: input.phoneE164,
        contactId: input.contactId,
        conversationId: input.conversationId,
        equipmentTag,
        previousEntity: rememberedEntity,
      });
      return logmeinEntity ?? rememberedEntity;
    }

    const resolved = await this.rememberAssetEntityMatch({
      phoneE164: input.phoneE164,
      contactId: input.contactId,
      conversationId: input.conversationId,
      equipmentTag,
      assetId: asset.id,
      entityId: asset.entitiesId,
      previousEntity: rememberedEntity,
    });

    return resolved;
  }

  private extractProfileEquipmentTag(profile: ContactProfileData | null): string | null {
    if (!profile || profile.equipment_tag_unknown === true) {
      return null;
    }

    const tag = typeof profile.last_equipment_tag === 'string' ? profile.last_equipment_tag.trim() : '';
    return tag === '' ? null : tag;
  }

  private async rememberAssetEntityMatch(input: {
    phoneE164: string;
    contactId: string | null;
    conversationId: string | null;
    equipmentTag: string;
    assetId: number;
    entityId: number;
    previousEntity: ContactEntityMemory | null;
  }): Promise<ContactEntityMemory> {
    const entityName = input.previousEntity?.glpiEntityId === input.entityId
      ? input.previousEntity.glpiEntityName
      : null;

    let remembered: ContactEntityMemory | null = null;
    if (this.contactEntityMemoryRepository) {
      try {
        remembered = await this.contactEntityMemoryRepository.rememberEntityForPhone({
          phoneE164: input.phoneE164,
          contactId: input.contactId,
          glpiEntityId: input.entityId,
          glpiEntityName: entityName,
          sourceConversationId: input.conversationId,
          source: 'asset_tag_match',
        });
      } catch (error: unknown) {
        logger.warn(
          {
            conversation_id: input.conversationId,
            equipment_tag: input.equipmentTag,
            asset_id: input.assetId,
            glpi_entity_id: input.entityId,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][entity][ASSET_TAG_MEMORY_SAVE_FAILED]',
        );
      }
    }

    if (
      input.previousEntity
      && input.previousEntity.glpiEntityId !== input.entityId
    ) {
      this.recordAudit({
        conversationId: input.conversationId ?? undefined,
        direction: 'inbound',
        eventType: 'CONTACT_ENTITY_MEMORY_CONFLICT',
        status: 'success',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: {
          conflict_source: 'asset_tag_match',
          equipment_tag: input.equipmentTag,
          previous_glpi_entity_id: input.previousEntity.glpiEntityId,
          resolved_glpi_entity_id: input.entityId,
          action: 'asset_tag_entity_preferred',
        },
      });
    }

    this.recordAudit({
      conversationId: input.conversationId ?? undefined,
      direction: 'inbound',
      eventType: 'CONTACT_ENTITY_RESOLVED_FROM_ASSET_TAG',
      status: 'success',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        equipment_tag: input.equipmentTag,
        asset_id: input.assetId,
        glpi_entity_id: input.entityId,
        previous_glpi_entity_id: input.previousEntity?.glpiEntityId ?? null,
        source: 'asset_tag_match',
      },
    });

    if (remembered) {
      return remembered;
    }

    const now = new Date();
    return {
      id: `asset:${input.assetId}:${input.entityId}`,
      phoneE164: input.phoneE164,
      contactId: input.contactId,
      glpiEntityId: input.entityId,
      glpiEntityName: entityName,
      sourceTicketId: null,
      sourceConversationId: input.conversationId,
      source: 'asset_tag_match',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async resolveEntityFromLogmeinCache(input: {
    phoneE164: string;
    contactId: string | null;
    conversationId: string | null;
    equipmentTag: string;
    previousEntity: ContactEntityMemory | null;
  }): Promise<ContactEntityMemory | null> {
    if (!this.logmeinReadonlyRepository?.findHostByEquipmentTag) {
      return null;
    }

    let host: Awaited<ReturnType<NonNullable<LogmeinReadonlyCacheRepository['findHostByEquipmentTag']>>>;
    try {
      host = await this.logmeinReadonlyRepository.findHostByEquipmentTag(input.equipmentTag);
    } catch (error: unknown) {
      logger.warn(
        {
          conversation_id: input.conversationId,
          equipment_tag: input.equipmentTag,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][entity][LOGMEIN_TAG_LOOKUP_FAILED_USING_MEMORY]',
      );
      return null;
    }

    const entityId = host?.glpiEntityCandidateId ?? null;
    if (!Number.isInteger(entityId) || entityId === null || entityId <= 0) {
      return null;
    }

    const entityName = input.previousEntity?.glpiEntityId === entityId
      ? input.previousEntity.glpiEntityName
      : (host?.groupName.trim() !== '' ? host?.groupName.trim() ?? null : null);

    let remembered: ContactEntityMemory | null = null;
    if (this.contactEntityMemoryRepository) {
      try {
        remembered = await this.contactEntityMemoryRepository.rememberEntityForPhone({
          phoneE164: input.phoneE164,
          contactId: input.contactId,
          glpiEntityId: entityId,
          glpiEntityName: entityName,
          sourceConversationId: input.conversationId,
          source: 'logmein_asset_cache',
        });
      } catch (error: unknown) {
        logger.warn(
          {
            conversation_id: input.conversationId,
            equipment_tag: input.equipmentTag,
            glpi_entity_id: entityId,
            error_message: error instanceof Error ? error.message : String(error),
          },
          '[integration-service][entity][LOGMEIN_TAG_MEMORY_SAVE_FAILED]',
        );
      }
    }

    if (
      input.previousEntity
      && input.previousEntity.glpiEntityId !== entityId
    ) {
      this.recordAudit({
        conversationId: input.conversationId ?? undefined,
        direction: 'inbound',
        eventType: 'CONTACT_ENTITY_MEMORY_CONFLICT',
        status: 'success',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: {
          conflict_source: 'logmein_asset_cache',
          equipment_tag: input.equipmentTag,
          previous_glpi_entity_id: input.previousEntity.glpiEntityId,
          resolved_glpi_entity_id: entityId,
          action: 'asset_tag_entity_preferred',
        },
      });
    }

    this.recordAudit({
      conversationId: input.conversationId ?? undefined,
      direction: 'inbound',
      eventType: 'CONTACT_ENTITY_RESOLVED_FROM_LOGMEIN_TAG',
      status: 'success',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        equipment_tag: input.equipmentTag,
        glpi_entity_id: entityId,
        source: 'logmein_asset_cache',
      },
    });

    if (remembered) {
      return remembered;
    }

    const now = new Date();
    return {
      id: `logmein:${input.equipmentTag}:${entityId}`,
      phoneE164: input.phoneE164,
      contactId: input.contactId,
      glpiEntityId: entityId,
      glpiEntityName: entityName,
      sourceTicketId: null,
      sourceConversationId: input.conversationId,
      source: 'logmein_asset_cache',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  private resolveTicketCategoryId(candidate: number | null | undefined): number | null {
    if (!env.AI_CATEGORY_CLASSIFICATION_ENABLED) {
      return null;
    }
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0 ? candidate : null;
  }

  private resolveTicketFormId(candidate: number | null | undefined, categoryId: number | null): number | null {
    if (categoryId === null) {
      return null;
    }
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0 ? candidate : null;
  }

  private async createTicketWithNativeCategoryFallback(
    input: CreateGlpiTicketInput,
    options: { timeoutMs?: number },
    context: { conversationId: string | null; stage: string },
  ): Promise<number> {
    try {
      return await this.glpiClient.createTicket(input, options);
    } catch (error: unknown) {
      if (!this.shouldRetryWithoutNativeCategory(input, error)) {
        throw error;
      }

      logger.warn(
        {
          conversation_id: context.conversationId,
          stage: context.stage,
          glpi_entity_id: input.entitiesId,
          itilcategories_id: input.itilcategoriesId ?? null,
          glpi_form_id: input.glpiFormId ?? null,
          error_message: error instanceof Error ? error.message : String(error),
        },
        '[integration-service][routing][GLPI_CATEGORY_REJECTED_RETRY_WITHOUT_CATEGORY]',
      );
      this.recordAudit({
        conversationId: context.conversationId ?? undefined,
        direction: 'inbound',
        eventType: 'GLPI_NATIVE_CATEGORY_RETRY_WITHOUT_CATEGORY',
        status: 'pending',
        severity: 'warning',
        source: 'InboundWebhookService',
        payload: {
          stage: context.stage,
          glpi_entity_id: input.entitiesId,
          itilcategories_id: input.itilcategoriesId ?? null,
          glpi_form_id: input.glpiFormId ?? null,
        },
      });

      return this.glpiClient.createTicket(
        {
          ...input,
          itilcategoriesId: null,
        },
        options,
      );
    }
  }

  private shouldRetryWithoutNativeCategory(input: CreateGlpiTicketInput, error: unknown): boolean {
    if (input.itilcategoriesId === null || input.itilcategoriesId === undefined || input.itilcategoriesId <= 0) {
      return false;
    }

    const err = error as { message?: unknown; responseBody?: unknown; statusCode?: unknown };
    const serialized = [
      typeof err.message === 'string' ? err.message : '',
      typeof err.statusCode === 'number' ? String(err.statusCode) : '',
      this.safeStringifyForDecision(err.responseBody),
    ].join(' ').toLowerCase();

    return /itilcategor|categoria|category|entit|entity|invalid|inval|not found|não encontrado|nao encontrado/.test(serialized);
  }

  private safeStringifyForDecision(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  private async deferTicketCreationForEntitySelection(input: EntitySelectionDeferralInput): Promise<string> {
    let conversationId = input.conversationId?.trim() ?? '';
    let conversation: Conversation | null = null;

    if (conversationId === '') {
      conversation = await this.conversationRepository.create({
        phoneE164: input.contact.phoneE164,
        contactId: input.contact.id,
        glpiTicketId: null,
        status: 'awaiting_entity_selection',
        lastMessageAt: new Date(),
      });
      conversationId = conversation.id;
    } else {
      conversation = await this.conversationRepository.findById(conversationId);
    }

    await this.conversationRepository.updateQueueAndStatus(
      conversationId,
      input.queueId ?? null,
      'awaiting_entity_selection',
    );
    await this.conversationRepository.touch(conversationId, new Date());
    await this.sendEntitySelectionMenu({
      toMeta: input.toMeta,
      conversation: {
        ...(conversation ?? {
          id: conversationId,
          phoneE164: input.contact.phoneE164,
          contactId: input.contact.id,
          glpiTicketId: null,
          status: 'awaiting_entity_selection',
          queueId: input.queueId ?? null,
          lastMessageAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          glpiEntityId: null,
          glpiEntityName: null,
          profileCollectionState: null,
        }),
        queueId: input.queueId ?? null,
        status: 'awaiting_entity_selection',
      },
      reason: input.message === ENTITY_SELECTION_PENDING_MESSAGE ? 'entity_selection_required' : 'entity_selection_reprompt',
    });
    logger.info(
      {
        conversation_id: conversationId,
        phone_e164: input.contact.phoneE164,
        reason: 'entity_selection_required',
      },
      '[integration-service][entity][TICKET_CREATION_DEFERRED_ENTITY_PENDING]',
    );
    this.recordAudit({
      conversationId,
      messageId: input.inboundMessage.messageId,
      direction: 'inbound',
      eventType: 'TICKET_CREATION_DEFERRED_ENTITY_PENDING',
      status: 'pending',
      severity: 'info',
      source: 'InboundWebhookService',
      payload: {
        reason: 'entity_selection_required',
        queue_id: input.queueId ?? null,
      },
    });
    await this.messageRepository.updateState({
      messageId: input.inboundMessage.messageId,
      conversationId,
      processingStatus: 'processed',
      glpiSyncStatus: 'synced',
    });

    return conversationId;
  }

  private async sendOutsideBusinessHoursMessage(input: {
    eventKey: string;
    toMeta: string;
    contactPhone: string;
    conversationId: string | null;
    correlationId: string;
  }): Promise<void> {
    const eventKey = input.eventKey || 'outside_business_hours_message';
    const plan = this.messageConfigurationService
      ? await this.messageConfigurationService.resolveSendPlan(eventKey, { windowOpen: true })
      : {
          shouldSend: true,
          text: await this.settingsService.getMessage('after_hours_message'),
          sendType: 'text',
          reason: null,
        };

    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: input.conversationId,
      phoneE164: input.contactPhone,
      eventKey,
      status: 'planned',
      reason: plan.reason,
    });

    if (!plan.shouldSend) {
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversationId,
        phoneE164: input.contactPhone,
        eventKey,
        status: 'not_sent_by_rule',
        reason: plan.reason ?? 'not_sent_by_rule',
      });
      return;
    }

    try {
      const metaResponse = await this.metaClient.sendTextMessage({ to: input.toMeta, body: plan.text });
      const metaMessageId = extractMetaMessageId(metaResponse) ?? `outside-hours.${input.correlationId}`;
      await this.messageRepository.insertOutbound({
        messageId: metaMessageId,
        conversationId: input.conversationId,
        senderPhone: 'whatsapp:auto',
        recipientPhone: input.contactPhone,
        messageType: 'text',
        messageText: plan.text,
        rawPayload: {
          automation_event_key: eventKey,
          send_type: plan.sendType,
          response: metaResponse,
        },
        processingStatus: 'sent',
        glpiSyncStatus: 'synced',
        idempotencyKey: `automation:${eventKey}:${input.conversationId ?? input.contactPhone}:${input.correlationId}`,
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversationId,
        phoneE164: input.contactPhone,
        eventKey,
        status: 'sent',
        messageId: metaMessageId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: input.conversationId,
        phoneE164: input.contactPhone,
        eventKey,
        status: 'failed',
        errorCode: 'OUTSIDE_BUSINESS_HOURS_SEND_FAILED',
        errorMessageSanitized: message.slice(0, 500),
      });
      logger.warn(
        {
          conversation_id: input.conversationId,
          phone_masked: maskSensitiveId(input.contactPhone),
          event_key: eventKey,
          error_message: message.slice(0, 500),
        },
        '[business_hours][OUTSIDE_HOURS_MESSAGE_FAILED]',
      );
    }
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
    selectedOption: ActiveRoutingOption | null,
    ticketId: number,
  ): Promise<string> {
    const optionTemplate = selectedOption?.confirmationMessage?.trim();
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

function selectSolutionMessageText(message: Awaited<ReturnType<MessageConfigurationService['getMessage']>> | undefined): string {
  if (!message) {
    return '';
  }

  const custom = message.customText?.trim() ?? '';
  if (custom !== '') {
    return custom;
  }

  const fallback = message.fallbackText?.trim() ?? '';
  if (message.defaultText.trim() === '' && fallback !== '') {
    return fallback;
  }

  return message.defaultText;
}

function truncateButtonTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 20) {
    return normalized;
  }

  return normalized.slice(0, 19).trimEnd() + '…';
}

function truncateListTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 24) {
    return normalized;
  }

  return normalized.slice(0, 23).trimEnd() + '…';
}

function buildTextOptionsFallback(body: string, buttons: Array<{ id: string; title: string }>): string {
  return [
    body,
    '',
    ...buttons.map((button, index) => formatMenuOptionLabel(button.title, index)),
    '',
    'Responda tocando na opção correspondente quando ela aparecer novamente ou digitando o número.',
  ].join('\n');
}

function buildInteractiveButtonBodyWithNumericHint(body: string, buttons: Array<{ id: string; title: string }>): string {
  const trimmedBody = body.trim();
  if (/(digit(e|ando)|n[uú]mero|op[cç][aã]o\s*\d|\d+\s*-\s*)/iu.test(trimmedBody)) {
    return trimmedBody;
  }

  const optionHint = buttons
    .map((button, index) => formatMenuOptionLabel(button.title, index))
    .join(', ');
  return `${trimmedBody}\n\nVocê também pode responder digitando o número: ${optionHint}.`;
}

function normalizeMetaDeliveryStatus(status: string): 'sent' | 'delivered' | 'read' | 'failed' | null {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'sent' || normalized === 'delivered' || normalized === 'read' || normalized === 'failed') {
    return normalized;
  }

  return null;
}

function sanitizeMetaStatusErrorCode(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const sanitized = value.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 64);
  return sanitized === '' ? null : sanitized;
}

function sanitizeMetaStatusErrorMessage(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const sanitized = value
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/\S+/gi, '[URL_REMOVIDA]')
    .replace(/[A-Za-z0-9+/=]{80,}/g, '[DADO_REMOVIDO]')
    .replace(/\b\d{9,}\b/g, '[NUMERO_REMOVIDO]')
    .trim()
    .slice(0, 240);

  return sanitized === '' ? null : sanitized;
}

function extractMetaMessageId(body: unknown): string | null {
  if (body && typeof body === 'object' && 'messages' in body) {
    const messages = (body as { messages?: Array<{ id?: string }> }).messages;
    const id = messages?.[0]?.id;
    if (typeof id === 'string' && id.trim() !== '') {
      return id.trim();
    }
  }

  return null;
}

function maskSensitiveId(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 4) {
    return '****';
  }

  return `${'*'.repeat(Math.min(12, normalized.length - 4))}${normalized.slice(-4)}`;
}
