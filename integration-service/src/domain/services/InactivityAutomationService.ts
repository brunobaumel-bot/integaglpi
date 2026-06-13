import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import { GlpiRequestError } from '../../errors/GlpiRequestError.js';
import { logger } from '../../infra/logger/logger.js';
import type { AuditStatus } from '../../repositories/contracts/AuditEventRepository.js';
import type {
  ProfileCollectionReminderCandidate,
  InactivityTrackingRecord,
  InactivityTrackingRepository,
  PendingCsatTimeoutCandidate,
} from '../../repositories/contracts/InactivityTrackingRepository.js';
import type { OutboundMessageService } from './OutboundMessageService.js';
import type { AuditService } from './AuditService.js';
import type { MessageConfigurationService, MessageSendPlan } from './MessageConfigurationService.js';
import { createCorrelationId } from './correlationId.js';

export type InactivityDecisionAction =
  | 'SEND_REMINDER_1'
  | 'SEND_REMINDER_2'
  | 'SEND_REMINDER_3'
  | 'AUTO_CLOSE'
  | 'SKIP'
  | 'NOOP';

export interface InactivityConfig {
  enabled: boolean;
  reminderMinutes: [number, number, number];
  autocloseMinutes: number;
  jobIntervalSeconds: number;
}

export type InactivityConfigProvider = () => Promise<{
  enabled?: boolean | null;
  reminderMinutes?: [number, number, number] | null;
  autocloseMinutes?: number | null;
}>;

export interface InactivityDecision {
  action: InactivityDecisionAction;
  reason: string;
  reminderNumber?: 1 | 2 | 3;
}

export type InactivitySkipReasonCode =
  | 'active_technical_interaction'
  | 'outside_business_hours'
  | 'window_closed_no_template'
  | 'already_notified'
  | 'not_eligible_status'
  | 'missing_ticket'
  | 'glpi_ticket_pending'
  | 'glpi_permission_denied'
  | 'awaiting_customer'
  | 'recent_inbound'
  | 'recent_outbound'
  | 'locked_or_duplicate_run';

const REMINDER_TEXTS: Record<1 | 2 | 3, string> = {
  1: 'Olá! Estamos aguardando seu retorno para continuar o atendimento. Podemos ajudar em algo mais?',
  2: 'Ainda estamos por aqui. Para seguirmos com o chamado, responda esta mensagem quando puder.',
  3: 'Como ainda não tivemos retorno, este atendimento poderá ser encerrado automaticamente se não houver resposta.',
};

const AUTOCLOSE_TEXT =
  'Como não tivemos retorno, estamos encerrando este atendimento por falta de resposta. Se precisar, basta nos chamar novamente.';
const AUTOCLOSE_WARNING_TEXT = 'Este atendimento poderá ser encerrado automaticamente se não houver resposta.';
const PROFILE_COLLECTION_REMINDER_EVENT_KEY = 'profile_collection_reminder';
const PRETICKET_REMINDER_EVENT_KEY = 'preticket_reminder';
const PRETICKET_REMINDER_2_EVENT_KEY = 'preticket_reminder_2';
const PRETICKET_AUTOCLOSE_EVENT_KEY = 'preticket_autoclose';
const PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY = 'preticket_timeout_ticket_opened';
const PRETICKET_REMINDER_TEXT =
  'Ainda precisamos confirmar algumas informações para continuar seu atendimento. Por favor, responda as perguntas pendentes para seguirmos. Se quiser encerrar, digite cancelar a qualquer momento.';
const PRETICKET_REMINDER_1_MINUTES = 1;
const PRETICKET_REMINDER_2_MINUTES = 3;
const PRETICKET_TICKET_OPEN_MINUTES = 5;
const PRETICKET_REMINDER_1_TEXT =
  'Olá! Para continuarmos seu atendimento, por favor responda às informações solicitadas.';
const PRETICKET_REMINDER_2_TEXT =
  'Ainda estou aguardando seu retorno. Se você não conseguir responder agora, vou abrir o chamado com as informações já recebidas.';
const PRETICKET_TIMEOUT_TICKET_OPENED_TEXT =
  'Como não recebi novas informações, abri o chamado com os dados disponíveis. Nossa equipe dará continuidade ao atendimento.';
const PRETICKET_AUTOCLOSE_TEXT =
  'Como não tivemos retorno, encerramos este pré-atendimento sem abrir chamado. Se precisar, inicie um novo atendimento.';
const PRETICKET_TIMEOUT_REASON = 'preticket_timeout';
export const TECHNICIAN_ACTIVITY_GUARD_MINUTES = 120;
const DEFAULT_REMINDER_MINUTES: [number, number, number] = [15, 20, 25];
const AUTOCLOSE_REASON = 'Encerrado por falta de retorno do usuário';
const CSAT_TIMEOUT_CLOSE_REASON = 'Fechado automaticamente sem avaliação do usuário após 12h sem resposta ao CSAT.';
const CSAT_TIMEOUT_HOURS = 12;
const SOLVED_STATUS = 5;
const CLOSED_STATUS = 6;

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / 60_000);
}

function hasClientResponseAfterOutbound(record: InactivityTrackingRecord): boolean {
  if (!record.lastClientActivityAt || !record.lastOutboundActivityAt) {
    return false;
  }

  return record.lastClientActivityAt.getTime() > record.lastOutboundActivityAt.getTime();
}

function hasManualHold(record: InactivityTrackingRecord, now: Date): boolean {
  if (record.manualHoldUntil && record.manualHoldUntil.getTime() > now.getTime()) {
    return true;
  }

  return Boolean(record.manualHoldReason && !record.manualHoldUntil);
}

type InactivityTicketState = 'open' | 'closed' | 'pending' | 'unknown';

function normalizeTicketState(rawStatus: unknown): InactivityTicketState {
  if (typeof rawStatus === 'number' && Number.isFinite(rawStatus)) {
    if (rawStatus === 4) {
      return 'pending';
    }
    if (rawStatus === 5 || rawStatus === 6) {
      return 'closed';
    }
    if (rawStatus > 0) {
      return 'open';
    }
  }

  const status = String(rawStatus ?? '').trim().toLowerCase();
  if (status === '') {
    return 'unknown';
  }
  if (
    status === '4'
    || status.includes('pending')
    || status.includes('pendente')
    || status.includes('awaiting_customer')
    || status.includes('aguardando_cliente')
    || status.includes('aguardando cliente')
    || status.includes('waiting_customer')
  ) {
    return 'pending';
  }
  if (status === '5' || status === '6' || status.includes('closed') || status.includes('solved') || status.includes('fechado') || status.includes('solucionado')) {
    return 'closed';
  }
  if (status === 'open' || status === '1' || status === '2' || status === '3') {
    return 'open';
  }

  return 'unknown';
}

export function parseReminderMinutes(value: string): [number, number, number] {
  const parsed = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((part) => Number.isInteger(part) && part > 0);

  if (parsed.length !== 3 || !(parsed[0] < parsed[1] && parsed[1] < parsed[2])) {
    return DEFAULT_REMINDER_MINUTES;
  }

  return [parsed[0], parsed[1], parsed[2]];
}

export function normalizeInactivitySkipReason(reason: string | null | undefined): InactivitySkipReasonCode | null {
  switch ((reason ?? '').trim()) {
    case 'technician_activity_recent':
      return 'active_technical_interaction';
    case 'skipped_missing_template_outside_24h':
    case 'outside_24h_template_missing':
      return 'window_closed_no_template';
    case 'previous_run_active':
    case 'profile_collection_reminder_already_marked':
    case 'autoclose_attempt_exists':
    case 'autoclose_already_attempted':
      return 'locked_or_duplicate_run';
    case 'autoclose_already_done':
    case 'previous_failure_requires_manual_review':
      return 'already_notified';
    case 'conversation_not_open':
    case 'ticket_closed_or_solved':
    case 'feature_flag_disabled':
    case 'manual_hold':
    case 'profile_collection_step_not_eligible':
      return 'not_eligible_status';
    case 'glpi_ticket_pending':
      return 'glpi_ticket_pending';
    case 'glpi_permission_denied':
      return 'glpi_permission_denied';
    case 'awaiting_customer':
      return 'awaiting_customer';
    case 'missing_ticket':
      return 'missing_ticket';
    case 'client_responded':
      return 'recent_inbound';
    case 'no_outbound_activity':
    case 'not_due':
      return 'recent_outbound';
    default:
      return reason ? 'not_eligible_status' : null;
  }
}

function classifyAutocloseFailureReason(error: unknown): { reason: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GlpiRequestError && error.statusCode === 403) {
    return { reason: 'glpi_permission_denied', message };
  }

  return { reason: 'autoclose_failed', message };
}

export function decideInactivityAction(
  record: InactivityTrackingRecord,
  config: InactivityConfig,
  now: Date,
): InactivityDecision {
  if (!config.enabled) {
    return { action: 'SKIP', reason: 'feature_flag_disabled' };
  }

  if (record.conversationStatus !== 'open') {
    return { action: 'SKIP', reason: 'conversation_not_open' };
  }

  if (!record.ticketId || record.ticketId <= 0) {
    return { action: 'SKIP', reason: 'missing_ticket' };
  }

  if (!record.lastOutboundActivityAt) {
    return { action: 'NOOP', reason: 'no_outbound_activity' };
  }

  if (hasManualHold(record, now)) {
    return { action: 'SKIP', reason: 'manual_hold' };
  }

  if (hasClientResponseAfterOutbound(record)) {
    return { action: 'SKIP', reason: 'client_responded' };
  }

  if (record.status === 'failed') {
    return { action: 'NOOP', reason: 'previous_failure_requires_manual_review' };
  }

  if (record.autocloseAttemptedAt && !record.autocloseCompletedAt) {
    return { action: 'NOOP', reason: 'autoclose_already_attempted' };
  }

  if (record.autocloseCompletedAt || record.status === 'autoclose_done') {
    return { action: 'NOOP', reason: 'autoclose_already_done' };
  }

  const elapsedMinutes = minutesBetween(record.lastOutboundActivityAt, now);
  const [r1, r2, r3] = config.reminderMinutes;
  if (elapsedMinutes < r1) {
    return { action: 'NOOP', reason: 'technician_activity_recent' };
  }

  if (!record.reminder1SentAt && elapsedMinutes >= r1) {
    return { action: 'SEND_REMINDER_1', reason: 'reminder_1_due', reminderNumber: 1 };
  }

  if (!record.reminder2SentAt && elapsedMinutes >= r2) {
    return { action: 'SEND_REMINDER_2', reason: 'reminder_2_due', reminderNumber: 2 };
  }

  if (!record.reminder3SentAt && elapsedMinutes >= r3) {
    return { action: 'SEND_REMINDER_3', reason: 'reminder_3_due', reminderNumber: 3 };
  }

  if (
    record.reminder1SentAt
    && record.reminder2SentAt
    && record.reminder3SentAt
    && elapsedMinutes >= config.autocloseMinutes
  ) {
    return { action: 'AUTO_CLOSE', reason: 'autoclose_due' };
  }

  return { action: 'NOOP', reason: 'not_due' };
}

export class InactivityAutomationService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  public constructor(
    private readonly repository: InactivityTrackingRepository,
    private readonly outboundMessageService: Pick<OutboundMessageService, 'send' | 'sendProfileCollectionReminder'>,
    private readonly glpiClient: Pick<GlpiClient, 'getTicketStatus' | 'solveTicketByInactivity'> & Partial<Pick<GlpiClient, 'getTicket' | 'createTicket'>>,
    private readonly auditService: AuditService | null,
    private readonly config: InactivityConfig,
    private readonly nowProvider: () => Date = () => new Date(),
    private readonly messageConfigurationService: MessageConfigurationService | null = null,
    private readonly configProvider: InactivityConfigProvider | null = null,
  ) {}

  public start(): void {
    if (!this.config.enabled || this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.jobIntervalSeconds * 1000);
    this.timer.unref?.();
    logger.info(
      {
        interval_seconds: this.config.jobIntervalSeconds,
        reminder_minutes: this.config.reminderMinutes,
        autoclose_minutes: this.config.autocloseMinutes,
      },
      '[integration-service][inactivity][JOB_STARTED]',
    );
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async runOnce(limit = 100): Promise<void> {
    const effectiveConfig = await this.loadEffectiveConfig();
    if (!effectiveConfig.enabled) {
      logger.info({ reason: 'feature_flag_disabled' }, '[integration-service][inactivity][CHECKED]');
      await this.recordDiagnostic(null, 'checked', {
        reason: 'feature_flag_disabled',
        checkedCount: 0,
        eligibleCount: 0,
      });
      return;
    }

    if (this.isRunning) {
      logger.warn({ reason: 'previous_run_active' }, '[integration-service][inactivity][RUN_SKIPPED]');
      await this.recordDiagnostic(null, 'skipped', { reason: 'previous_run_active' });
      return;
    }

    this.isRunning = true;
    try {
      const candidates = await this.repository.findDueCandidates(limit);
      await this.recordDiagnostic(null, 'checked', {
        reason: candidates.length > 0 ? 'candidates_found' : 'no_eligible_candidates',
        checkedCount: candidates.length,
        eligibleCount: 0,
      });
      logger.info(
        {
          checked_count: candidates.length,
          limit,
          reason: candidates.length > 0 ? 'candidates_found' : 'no_eligible_candidates',
        },
        '[integration-service][inactivity][CHECKED]',
      );
      for (const candidate of candidates) {
        await this.processCandidate(candidate, effectiveConfig);
      }
      await this.processProfileCollectionReminderCandidates(limit);
      await this.processCsatTimeoutCandidates(limit);
    } finally {
      this.isRunning = false;
    }
  }

  private async processProfileCollectionReminderCandidates(limit: number): Promise<void> {
    const now = this.nowProvider();
    const reminderCutoff = new Date(now.getTime() - PRETICKET_REMINDER_1_MINUTES * 60_000);
    const autocloseCutoff = new Date(now.getTime() - PRETICKET_TICKET_OPEN_MINUTES * 60_000);
    const candidates = await this.repository.findProfileCollectionReminderCandidates(reminderCutoff, autocloseCutoff, limit);
    await this.recordProfileDiagnostic(null, 'checked', {
      reason: candidates.length > 0 ? 'profile_collection_candidates_found' : 'profile_collection_no_candidates',
      checkedCount: candidates.length,
      eligibleCount: candidates.length,
    });

    for (const candidate of candidates) {
      await this.processProfileCollectionReminderCandidate(candidate);
    }
  }

  private async processProfileCollectionReminderCandidate(
    candidate: ProfileCollectionReminderCandidate,
  ): Promise<void> {
    const step = normalizeProfileCollectionStep(candidate.profileCollectionState, candidate.conversationStatus);
    if (!step || step === 'complete') {
      await this.recordProfileDiagnostic(candidate, 'skipped', { reason: 'profile_collection_step_not_eligible' });
      return;
    }

    const correlationId = createCorrelationId();
    const elapsedMinutes = minutesBetween(candidate.lastMessageAt, this.nowProvider());
    if (elapsedMinutes >= PRETICKET_TICKET_OPEN_MINUTES) {
      await this.openPreTicketByInactivity(candidate, step, correlationId);
      return;
    }

    if (elapsedMinutes >= PRETICKET_REMINDER_2_MINUTES) {
      await this.sendPreTicketReminder(candidate, step, correlationId, {
        eventKey: PRETICKET_REMINDER_2_EVENT_KEY,
        fallbackText: PRETICKET_REMINDER_2_TEXT,
        marker: 'second',
      });
      return;
    }

    await this.sendPreTicketReminder(candidate, step, correlationId, {
      eventKey: PRETICKET_REMINDER_EVENT_KEY,
      fallbackText: PRETICKET_REMINDER_1_TEXT,
      marker: 'first',
    });
  }

  private async sendPreTicketReminder(
    candidate: ProfileCollectionReminderCandidate,
    step: string,
    correlationId: string,
    reminder: { eventKey: string; fallbackText: string; marker: 'first' | 'second' },
  ): Promise<void> {
    const windowOpen = this.nowProvider().getTime() - candidate.lastMessageAt.getTime() < 24 * 60 * 60 * 1000;
    const sendPlan = await this.resolveInactivitySendPlan(
      reminder.eventKey,
      windowOpen,
      reminder.fallbackText,
    );
    await this.recordProfileDiagnostic(candidate, 'eligible', { reason: `${reminder.eventKey}_due` });
    await this.recordProfileDiagnostic(candidate, 'planned', {
      eventKey: reminder.eventKey,
      reason: sendPlan.reason,
    });
    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: candidate.conversationId,
      phoneE164: candidate.phoneE164,
      eventKey: reminder.eventKey,
      status: 'planned',
      reason: sendPlan.reason,
    });

    const reserved = reminder.marker === 'first'
      ? await this.repository.markProfileCollectionReminderSent(candidate.conversationId, step, this.nowProvider())
      : await this.repository.markProfileCollectionSecondReminderSent(candidate.conversationId, step, this.nowProvider());
    if (!reserved) {
      await this.recordProfileDiagnostic(candidate, 'skipped', { reason: `${reminder.eventKey}_already_marked` });
      this.recordProfileAudit(candidate, 'PRETICKET_REMINDER_SKIPPED', 'ignored', correlationId, {
        reason: `${reminder.eventKey}_already_marked`,
        profile_step: step,
      });
      return;
    }

    const idempotencyKey = `${reminder.eventKey}:${candidate.conversationId}:${step}:${candidate.lastMessageAt.toISOString()}`;
    if (!sendPlan.shouldSend) {
      await this.recordProfileDiagnostic(candidate, 'skipped', {
        eventKey: reminder.eventKey,
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: candidate.conversationId,
        phoneE164: candidate.phoneE164,
        eventKey: reminder.eventKey,
        status: 'not_sent_by_rule',
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      this.recordProfileAudit(candidate, 'PRETICKET_REMINDER_SKIPPED', 'ignored', correlationId, {
        reason: sendPlan.reason ?? 'not_sent_by_rule',
        profile_step: step,
        idempotency_key: idempotencyKey,
      });
      return;
    }

    try {
      const result = await this.outboundMessageService.sendProfileCollectionReminder({
        conversationId: candidate.conversationId,
        phoneE164: candidate.phoneE164,
        text: sendPlan.text,
        messageType: sendPlan.sendType === 'internal_only' ? 'text' : sendPlan.sendType,
        templateName: sendPlan.templateName,
        language: sendPlan.language,
        buttons: sendPlan.buttons,
        listOptions: sendPlan.listOptions,
        idempotencyKey,
        eventKey: reminder.eventKey,
        profileStep: step,
      }, { correlationId });
      if (result.body.status !== 'sent') {
        await this.recordProfileDiagnostic(candidate, 'failed', {
          eventKey: reminder.eventKey,
          reason: result.body.error_code,
          metaErrorMessageSanitized: result.body.message.slice(0, 500),
        });
        await this.messageConfigurationService?.recordAutomationEvent({
          conversationId: candidate.conversationId,
          phoneE164: candidate.phoneE164,
          eventKey: reminder.eventKey,
          status: 'failed',
          errorCode: result.body.error_code,
          errorMessageSanitized: result.body.message.slice(0, 500),
        });
        this.recordProfileAudit(candidate, 'PROFILE_COLLECTION_REMINDER_FAILED', 'failed', correlationId, {
          profile_step: step,
          error_code: result.body.error_code,
        });
        return;
      }

      await this.recordProfileDiagnostic(candidate, 'sent', {
        eventKey: reminder.eventKey,
        messageId: result.body.message_id,
        deliveryStatus: 'sent',
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: candidate.conversationId,
        phoneE164: candidate.phoneE164,
        eventKey: reminder.eventKey,
        status: 'sent',
        messageId: result.body.message_id,
      });
      this.recordProfileAudit(candidate, 'PROFILE_COLLECTION_REMINDER_SENT', 'success', correlationId, {
        profile_step: step,
        idempotency_key: idempotencyKey,
        reminder_marker: reminder.marker,
      });
      this.recordProfileAudit(candidate, 'PRETICKET_REMINDER_DISPATCHED', 'success', correlationId, {
        profile_step: step,
        idempotency_key: idempotencyKey,
        reminder_marker: reminder.marker,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordProfileDiagnostic(candidate, 'failed', {
        eventKey: reminder.eventKey,
        reason: 'profile_collection_reminder_failed',
        metaErrorMessageSanitized: message.slice(0, 500),
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: candidate.conversationId,
        phoneE164: candidate.phoneE164,
        eventKey: PRETICKET_REMINDER_EVENT_KEY,
        status: 'failed',
        errorCode: 'PROFILE_COLLECTION_REMINDER_FAILED',
        errorMessageSanitized: message.slice(0, 500),
      });
      this.recordProfileAudit(candidate, 'PROFILE_COLLECTION_REMINDER_FAILED', 'failed', correlationId, {
        profile_step: step,
        error_message: message.slice(0, 500),
      });
    }
  }

  private async openPreTicketByInactivity(
    candidate: ProfileCollectionReminderCandidate,
    step: string,
    correlationId: string,
  ): Promise<void> {
    const reserved = await this.repository.tryReserveProfileCollectionTimeout(
      candidate.conversationId,
      step,
      this.nowProvider(),
    );
    if (!reserved) {
      await this.recordProfileDiagnostic(candidate, 'skipped', { reason: 'preticket_timeout_already_reserved' });
      return;
    }

    if (
      typeof candidate.glpiEntityId !== 'number'
      || !Number.isInteger(candidate.glpiEntityId)
      || candidate.glpiEntityId <= 0
      || typeof this.glpiClient.createTicket !== 'function'
    ) {
      await this.repository.markProfileCollectionAttentionRequired(
        candidate.conversationId,
        'preticket_timeout_missing_entity',
        this.nowProvider(),
      );
      await this.recordProfileDiagnostic(candidate, 'skipped', {
        eventKey: PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY,
        reason: 'preticket_timeout_missing_entity',
      });
      this.recordProfileAudit(candidate, 'PRETICKET_TIMEOUT_ATTENTION_REQUIRED', 'ignored', correlationId, {
        profile_step: step,
        reason: 'preticket_timeout_missing_entity',
      });
      return;
    }

    try {
      const ticketId = await this.glpiClient.createTicket({
        title: buildPreTicketTimeoutTitle(candidate.profileCollectionState),
        content: buildPreTicketTimeoutContent(candidate.profileCollectionState),
        requesterPhone: candidate.phoneE164,
        requesterName: extractProfileString(candidate.profileCollectionState, ['requester_name', 'company_name_raw', 'name']),
        entitiesId: candidate.glpiEntityId,
        assignedUserId: null,
        assignedGroupId: null,
        requesterUserId: null,
        itilcategoriesId: null,
        glpiFormId: null,
      }, { timeoutMs: 30_000 });

      await this.repository.markProfileCollectionTicketOpened(
        candidate.conversationId,
        ticketId,
        this.nowProvider(),
        candidate.glpiEntityId,
        candidate.glpiEntityName,
      );
      await this.recordProfileDiagnostic(candidate, 'sent', {
        eventKey: PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY,
        reason: 'ticket_opened_by_preticket_timeout',
      });
      this.recordProfileAudit(candidate, 'PRETICKET_TIMEOUT_TICKET_OPENED', 'success', correlationId, {
        profile_step: step,
        ticket_id: ticketId,
        glpi_entity_id: candidate.glpiEntityId,
      });
      await this.sendPreTicketTimeoutNotice(candidate, step, correlationId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.markProfileCollectionAttentionRequired(
        candidate.conversationId,
        'preticket_timeout_ticket_create_failed',
        this.nowProvider(),
      );
      await this.recordProfileDiagnostic(candidate, 'failed', {
        eventKey: PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY,
        reason: 'preticket_timeout_ticket_create_failed',
        metaErrorMessageSanitized: message.slice(0, 500),
      });
      this.recordProfileAudit(candidate, 'PRETICKET_TIMEOUT_TICKET_OPEN_FAILED', 'failed', correlationId, {
        profile_step: step,
        error_message: message.slice(0, 500),
      });
    }
  }

  private async sendPreTicketTimeoutNotice(
    candidate: ProfileCollectionReminderCandidate,
    step: string,
    correlationId: string,
  ): Promise<void> {
    const windowOpen = this.nowProvider().getTime() - candidate.lastMessageAt.getTime() < 24 * 60 * 60 * 1000;
    const sendPlan = await this.resolveInactivitySendPlan(
      PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY,
      windowOpen,
      PRETICKET_TIMEOUT_TICKET_OPENED_TEXT,
    );
    if (!sendPlan.shouldSend) {
      await this.recordProfileDiagnostic(candidate, 'skipped', {
        eventKey: PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY,
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      return;
    }

    await this.outboundMessageService.sendProfileCollectionReminder({
      conversationId: candidate.conversationId,
      phoneE164: candidate.phoneE164,
      text: sendPlan.text,
      messageType: sendPlan.sendType === 'internal_only' ? 'text' : sendPlan.sendType,
      templateName: sendPlan.templateName,
      language: sendPlan.language,
      buttons: sendPlan.buttons,
      listOptions: sendPlan.listOptions,
      idempotencyKey: `${PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY}:${candidate.conversationId}:${step}:${candidate.lastMessageAt.toISOString()}`,
      eventKey: PRETICKET_TIMEOUT_TICKET_OPENED_EVENT_KEY,
      profileStep: step,
    }, { correlationId });
  }

  private async cancelPreTicketByInactivity(
    candidate: ProfileCollectionReminderCandidate,
    step: string,
    correlationId: string,
  ): Promise<void> {
    const windowOpen = this.nowProvider().getTime() - candidate.lastMessageAt.getTime() < 24 * 60 * 60 * 1000;
    const sendPlan = await this.resolveInactivitySendPlan(
      PRETICKET_AUTOCLOSE_EVENT_KEY,
      windowOpen,
      PRETICKET_AUTOCLOSE_TEXT,
    );
    await this.recordProfileDiagnostic(candidate, 'eligible', { reason: 'preticket_timeout_due' });
    await this.recordProfileDiagnostic(candidate, 'planned', {
      eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
      reason: sendPlan.reason,
    });
    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: candidate.conversationId,
      phoneE164: candidate.phoneE164,
      eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
      status: 'planned',
      reason: sendPlan.reason,
    });

    if (sendPlan.shouldSend) {
      const idempotencyKey = `preticket_autoclose:${candidate.conversationId}:${step}:${candidate.lastMessageAt.toISOString()}`;
      try {
        const result = await this.outboundMessageService.sendProfileCollectionReminder({
          conversationId: candidate.conversationId,
          phoneE164: candidate.phoneE164,
          text: sendPlan.text,
          messageType: sendPlan.sendType === 'internal_only' ? 'text' : sendPlan.sendType,
          templateName: sendPlan.templateName,
          language: sendPlan.language,
          buttons: sendPlan.buttons,
          listOptions: sendPlan.listOptions,
          idempotencyKey,
          eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
          profileStep: step,
        }, { correlationId });

        if (result.body.status === 'sent') {
          await this.recordProfileDiagnostic(candidate, 'sent', {
            eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
            messageId: result.body.message_id,
            deliveryStatus: 'sent',
          });
          await this.messageConfigurationService?.recordAutomationEvent({
            conversationId: candidate.conversationId,
            phoneE164: candidate.phoneE164,
            eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
            status: 'sent',
            messageId: result.body.message_id,
          });
        } else {
          await this.recordProfileDiagnostic(candidate, 'failed', {
            eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
            reason: result.body.error_code,
            metaErrorMessageSanitized: result.body.message.slice(0, 500),
          });
          this.recordProfileAudit(candidate, 'PRETICKET_AUTOCLOSE_MESSAGE_FAILED', 'failed', correlationId, {
            profile_step: step,
            error_code: result.body.error_code,
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await this.recordProfileDiagnostic(candidate, 'failed', {
          eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
          reason: 'preticket_autoclose_message_failed',
          metaErrorMessageSanitized: message.slice(0, 500),
        });
        this.recordProfileAudit(candidate, 'PRETICKET_AUTOCLOSE_MESSAGE_FAILED', 'failed', correlationId, {
          profile_step: step,
          error_message: message.slice(0, 500),
        });
      }
    } else {
      await this.recordProfileDiagnostic(candidate, 'skipped', {
        eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: candidate.conversationId,
        phoneE164: candidate.phoneE164,
        eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
        status: 'not_sent_by_rule',
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      this.recordProfileAudit(candidate, 'PRETICKET_AUTOCLOSE_MESSAGE_SKIPPED', 'ignored', correlationId, {
        profile_step: step,
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
    }

    const cancelled = await this.repository.cancelProfileCollectionConversation(
      candidate.conversationId,
      step,
      this.nowProvider(),
      PRETICKET_TIMEOUT_REASON,
    );
    if (!cancelled) {
      await this.recordProfileDiagnostic(candidate, 'skipped', { reason: 'preticket_cancel_conflict' });
      this.recordProfileAudit(candidate, 'PRETICKET_REMINDER_SKIPPED', 'ignored', correlationId, {
        profile_step: step,
        reason: 'preticket_cancel_conflict',
      });
      return;
    }

    await this.recordProfileDiagnostic(candidate, 'sent', {
      eventKey: PRETICKET_AUTOCLOSE_EVENT_KEY,
      reason: PRETICKET_TIMEOUT_REASON,
    });
    this.recordProfileAudit(candidate, 'PRETICKET_CLOSED_BY_INACTIVITY', 'success', correlationId, {
      profile_step: step,
      close_reason: PRETICKET_TIMEOUT_REASON,
      csat_suppressed: true,
    });
    this.recordProfileAudit(candidate, 'PRETICKET_TIMEOUT_CANCELLATION', 'success', correlationId, {
      profile_step: step,
      close_reason: PRETICKET_TIMEOUT_REASON,
      csat_suppressed: true,
    });
  }

  private async processCsatTimeoutCandidates(limit: number): Promise<void> {
    const cutoff = new Date(this.nowProvider().getTime() - CSAT_TIMEOUT_HOURS * 60 * 60 * 1000);
    const candidates = await this.repository.findPendingCsatTimeoutCandidates(cutoff, limit);
    for (const candidate of candidates) {
      await this.processCsatTimeoutCandidate(candidate);
    }
  }

  private async processCsatTimeoutCandidate(candidate: PendingCsatTimeoutCandidate): Promise<void> {
    const correlationId = createCorrelationId();
    if (candidate.latestInboundAt && candidate.latestInboundAt.getTime() > candidate.createdAt.getTime()) {
      await this.repository.markCsatTimeoutSkipped(candidate.solutionActionId, 'client_responded_after_csat');
      this.auditService?.recordAuditEventFireAndForget({
        correlationId,
        ticketId: candidate.ticketId,
        conversationId: candidate.conversationId,
        direction: 'system',
        eventType: 'CSAT_TIMEOUT_CLOSE_SKIPPED',
        status: 'ignored',
        severity: 'info',
        source: 'InactivityAutomationService',
        payload: { reason: 'client_responded_after_csat' },
      });
      return;
    }

    const reserved = await this.repository.tryReserveCsatTimeoutClose(candidate.solutionActionId, this.nowProvider());
    if (!reserved) {
      return;
    }

    const ticketStatus = await this.loadTicketState(candidate.ticketId);
    if (ticketStatus === 'open' || ticketStatus === 'pending') {
      await this.glpiClient.solveTicketByInactivity(candidate.ticketId, CSAT_TIMEOUT_CLOSE_REASON);
    }

    await this.repository.markCsatTimeoutClosed(candidate.solutionActionId, this.nowProvider());
    this.auditService?.recordAuditEventFireAndForget({
      correlationId,
      ticketId: candidate.ticketId,
      conversationId: candidate.conversationId,
      direction: 'system',
      eventType: 'CSAT_TIMEOUT_CLOSED_NO_RATING',
      status: 'success',
      severity: 'info',
      source: 'InactivityAutomationService',
      payload: {
        reason: 'sem_avaliacao_do_usuario',
        glpi_status: CLOSED_STATUS,
      },
    });
  }

  private async processCandidate(candidate: InactivityTrackingRecord, config: InactivityConfig): Promise<void> {
    const refreshed = await this.repository.findByConversationId(candidate.conversationId);
    if (!refreshed) {
      return;
    }

    const now = this.nowProvider();
    const decision = decideInactivityAction(refreshed, config, now);
    await this.recordDiagnostic(refreshed, 'checked', { reason: decision.reason });

    if (decision.action === 'NOOP') {
      await this.recordDiagnostic(refreshed, 'skipped', { reason: decision.reason });
      return;
    }

    if (decision.action === 'SKIP') {
      await this.handleSkip(refreshed, decision.reason);
      return;
    }

    await this.recordDiagnostic(refreshed, 'eligible', { reason: decision.reason });

    if (decision.action === 'AUTO_CLOSE') {
      await this.handleAutoclose(refreshed, config);
      return;
    }

    if (decision.reminderNumber) {
      await this.handleReminder(refreshed, decision.reminderNumber);
    }
  }

  private async handleReminder(record: InactivityTrackingRecord, reminderNumber: 1 | 2 | 3): Promise<void> {
    if (!record.ticketId) {
      return;
    }

    const ticketStatus = await this.loadTicketState(record.ticketId);
    if (ticketStatus === 'closed') {
      await this.handleSkip(record, 'ticket_closed_or_solved');
      return;
    }

    const correlationId = createCorrelationId();
    const eventKey = `inactivity_reminder_${reminderNumber}`;
    const windowOpen = record.lastClientActivityAt
      ? this.nowProvider().getTime() - record.lastClientActivityAt.getTime() < 24 * 60 * 60 * 1000
      : false;
    const sendPlan = await this.resolveInactivitySendPlan(
      eventKey,
      windowOpen,
      REMINDER_TEXTS[reminderNumber],
    );
    const idempotencyKey = `inactivity:reminder_${reminderNumber}:${record.conversationId}:${record.ticketId}`;
    await this.recordDiagnostic(record, 'planned', {
      eventKey,
      reason: sendPlan.reason,
    });
    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: record.conversationId,
      phoneE164: record.phoneE164,
      eventKey,
      status: 'planned',
      reason: sendPlan.reason,
    });
    if (!sendPlan.shouldSend) {
      const reason = sendPlan.reason ?? 'not_sent_by_rule';
      await this.repository.markFailed(record.conversationId, reason);
      await this.recordDiagnostic(record, 'skipped', {
        eventKey,
        reason,
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: record.conversationId,
        phoneE164: record.phoneE164,
        eventKey,
        status: 'not_sent_by_rule',
        reason,
      });
      this.recordAudit(record, `INACTIVITY_REMINDER_${reminderNumber}_NOT_SENT_BY_RULE`, 'ignored', correlationId, {
        reason,
        idempotency_key: idempotencyKey,
      });
      this.recordAudit(record, 'INACTIVITY_REMINDER_SKIPPED', 'ignored', correlationId, {
        reason_code: normalizeInactivitySkipReason(reason),
        reason,
        reminder_number: reminderNumber,
      });
      return;
    }

    const result = await this.outboundMessageService.send(
      this.buildOutboundRequest(record, sendPlan, idempotencyKey),
      { correlationId },
    );

    if (result.body.status !== 'sent') {
      await this.repository.markFailed(record.conversationId, result.body.error_code);
      await this.recordDiagnostic(record, 'failed', {
        eventKey,
        reason: result.body.error_code,
        metaErrorCode: result.body.error_code,
        metaErrorMessageSanitized: result.body.message.slice(0, 500),
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: record.conversationId,
        phoneE164: record.phoneE164,
        eventKey,
        status: 'failed',
        errorCode: result.body.error_code,
        errorMessageSanitized: result.body.message.slice(0, 500),
      });
      this.recordAudit(record, `INACTIVITY_REMINDER_${reminderNumber}_FAILED`, 'failed', correlationId, {
        error_code: result.body.error_code,
      });
      return;
    }

    await this.repository.markReminderSent(record.conversationId, reminderNumber, this.nowProvider());
    await this.recordDiagnostic(record, 'sent', {
      eventKey,
      messageId: result.body.message_id,
      deliveryStatus: 'sent',
    });
    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: record.conversationId,
      phoneE164: record.phoneE164,
      eventKey,
      status: 'sent',
      messageId: result.body.message_id,
    });
    this.recordAudit(record, `INACTIVITY_REMINDER_${reminderNumber}_SENT`, 'success', correlationId, {
      reminder_number: reminderNumber,
      idempotency_key: idempotencyKey,
    });
    this.recordAudit(record, 'INACTIVITY_REMINDER_DISPATCHED', 'success', correlationId, {
      reminder_number: reminderNumber,
      idempotency_key: idempotencyKey,
    });
  }

  private async handleAutoclose(record: InactivityTrackingRecord, config: InactivityConfig): Promise<void> {
    if (!record.ticketId) {
      return;
    }

    const correlationId = createCorrelationId();
    const refreshed = await this.repository.findByConversationId(record.conversationId);
    const now = this.nowProvider();
    if (!refreshed || hasClientResponseAfterOutbound(refreshed) || hasManualHold(refreshed, now)) {
      await this.handleSkip(record, refreshed && hasClientResponseAfterOutbound(refreshed) ? 'client_responded' : 'manual_hold');
      return;
    }
    const elapsedMinutes = refreshed.lastOutboundActivityAt
      ? minutesBetween(refreshed.lastOutboundActivityAt, now)
      : Number.POSITIVE_INFINITY;
    if (elapsedMinutes < config.reminderMinutes[0]) {
      await this.recordDiagnostic(refreshed, 'skipped', { reason: 'technician_activity_recent' });
      this.recordAudit(refreshed, 'INACTIVITY_AUTOCLOSE_SKIPPED', 'ignored', correlationId, {
        reason: 'technician_activity_recent',
      });
      return;
    }

    const ticketStatus = await this.loadTicketState(record.ticketId);
    if (ticketStatus === 'closed') {
      await this.handleSkip(record, 'ticket_closed_or_solved');
      return;
    }
    if (ticketStatus === 'pending') {
      await this.handleSkip(record, 'glpi_ticket_pending');
      return;
    }

    const reserved = await this.repository.tryMarkAutocloseAttempted(record.conversationId, this.nowProvider());
    if (!reserved) {
      this.recordAudit(record, 'INACTIVITY_AUTOCLOSE_ALREADY_ATTEMPTED', 'ignored', correlationId, {
        reason: 'autoclose_attempt_exists',
      });
      return;
    }

    try {
      const windowOpen = refreshed.lastClientActivityAt
        ? this.nowProvider().getTime() - refreshed.lastClientActivityAt.getTime() < 24 * 60 * 60 * 1000
        : false;
      await this.glpiClient.solveTicketByInactivity(record.ticketId, `${AUTOCLOSE_REASON}\n\n${AUTOCLOSE_TEXT}`);
      await this.repository.markAutocloseCompleted(record.conversationId, this.nowProvider());

      const warningSent = await this.sendAutocloseConfiguredMessage(
        record,
        'inactivity_autoclose_warning',
        AUTOCLOSE_WARNING_TEXT,
        `inactivity:autoclose_warning:${record.conversationId}:${record.ticketId}`,
        correlationId,
        windowOpen,
      );
      if (!warningSent) {
        this.recordAudit(record, 'SYSTEM_AUTOCLOSE_SKIPPED', 'ignored', correlationId, {
          reason_code: 'window_closed_no_template',
          event_key: 'inactivity_autoclose_warning',
        });
        return;
      }

      const noticeSent = await this.sendAutocloseConfiguredMessage(
        record,
        'inactivity_autoclose_message',
        AUTOCLOSE_TEXT,
        `inactivity:autoclose_notice:${record.conversationId}:${record.ticketId}`,
        correlationId,
        windowOpen,
      );
      if (!noticeSent) {
        this.recordAudit(record, 'SYSTEM_AUTOCLOSE_SKIPPED', 'ignored', correlationId, {
          reason_code: 'window_closed_no_template',
          event_key: 'inactivity_autoclose_message',
        });
        return;
      }

      await this.recordDiagnostic(record, 'sent', {
        eventKey: 'inactivity_autoclose_message',
        reason: 'autoclose_done',
      });
      this.recordAudit(record, 'INACTIVITY_AUTOCLOSE_DONE', 'success', correlationId, {
        reason: 'no_client_response',
        glpi_status: SOLVED_STATUS,
      });
      this.recordAudit(record, 'SYSTEM_AUTOCLOSE_EXECUTED', 'success', correlationId, {
        reason: 'no_client_response',
        glpi_status: SOLVED_STATUS,
      });
    } catch (error: unknown) {
      const failure = classifyAutocloseFailureReason(error);
      await this.repository.markFailed(record.conversationId, failure.reason);
      await this.recordDiagnostic(record, 'failed', {
        eventKey: 'inactivity_autoclose_message',
        reason: failure.reason,
        metaErrorMessageSanitized: failure.message.slice(0, 500),
      });
      this.recordAudit(record, 'INACTIVITY_AUTOCLOSE_FAILED', 'failed', correlationId, {
        reason: failure.reason,
        error_message: failure.message.slice(0, 500),
      });
    }
  }

  private async handleSkip(record: InactivityTrackingRecord, reason: string): Promise<void> {
    const reasonCode = normalizeInactivitySkipReason(reason) ?? 'not_eligible_status';
    const status = reason === 'client_responded'
      ? 'skipped_by_response'
      : reason === 'manual_hold' || reason === 'glpi_ticket_pending' || reason === 'awaiting_customer'
        ? 'skipped_by_hold'
        : reason === 'feature_flag_disabled'
          ? 'skipped_by_feature_flag'
          : 'skipped_by_closed_ticket';
    await this.repository.markSkipped(record.conversationId, status, reasonCode);
    await this.recordDiagnostic(record, 'skipped', { reason });
    this.recordAudit(record, 'INACTIVITY_SKIPPED', 'ignored', createCorrelationId(), { reason });
    this.recordAudit(record, 'INACTIVITY_REMINDER_SKIPPED', 'ignored', createCorrelationId(), {
      reason_code: reasonCode,
      reason,
    });
    this.recordAudit(record, 'SYSTEM_AUTOCLOSE_SKIPPED', 'ignored', createCorrelationId(), {
      reason_code: reasonCode,
      reason,
    });
  }

  private async sendAutocloseConfiguredMessage(
    record: InactivityTrackingRecord,
    eventKey: 'inactivity_autoclose_warning' | 'inactivity_autoclose_message',
    fallbackText: string,
    idempotencyKey: string,
    correlationId: string,
    windowOpen: boolean,
  ): Promise<boolean> {
    const sendPlan = await this.resolveInactivitySendPlan(eventKey, windowOpen, fallbackText);
    await this.recordDiagnostic(record, 'planned', { eventKey, reason: sendPlan.reason });
    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: record.conversationId,
      phoneE164: record.phoneE164,
      eventKey,
      status: 'planned',
      reason: sendPlan.reason,
    });

    if (!sendPlan.shouldSend) {
      await this.recordDiagnostic(record, 'skipped', {
        eventKey,
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: record.conversationId,
        phoneE164: record.phoneE164,
        eventKey,
        status: 'not_sent_by_rule',
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      this.recordAudit(record, 'INACTIVITY_AUTOCLOSE_NOTICE_NOT_SENT_BY_RULE', 'ignored', correlationId, {
        event_key: eventKey,
        reason: sendPlan.reason ?? 'not_sent_by_rule',
      });
      return false;
    }

    const noticeResult = await this.outboundMessageService.send(
      this.buildOutboundRequest(record, sendPlan, idempotencyKey),
      { correlationId },
    );

    if (noticeResult.body.status !== 'sent') {
      await this.recordDiagnostic(record, 'failed', {
        eventKey,
        reason: noticeResult.body.error_code,
        metaErrorCode: noticeResult.body.error_code,
        metaErrorMessageSanitized: noticeResult.body.message.slice(0, 500),
      });
      await this.messageConfigurationService?.recordAutomationEvent({
        conversationId: record.conversationId,
        phoneE164: record.phoneE164,
        eventKey,
        status: 'failed',
        errorCode: noticeResult.body.error_code,
        errorMessageSanitized: noticeResult.body.message.slice(0, 500),
      });
      this.recordAudit(record, 'INACTIVITY_AUTOCLOSE_NOTICE_FAILED', 'failed', correlationId, {
        event_key: eventKey,
        error_code: noticeResult.body.error_code,
      });
      return false;
    }

    await this.recordDiagnostic(record, 'sent', {
      eventKey,
      messageId: noticeResult.body.message_id,
      deliveryStatus: 'sent',
    });
    await this.messageConfigurationService?.recordAutomationEvent({
      conversationId: record.conversationId,
      phoneE164: record.phoneE164,
      eventKey,
      status: 'sent',
      messageId: noticeResult.body.message_id,
    });
    return true;
  }

  private async resolveInactivitySendPlan(
    eventKey: string,
    windowOpen: boolean,
    fallbackText: string,
  ): Promise<MessageSendPlan> {
    if (this.messageConfigurationService) {
      return this.messageConfigurationService.resolveSendPlan(eventKey, {
        windowOpen,
        allowTemplateSend: true,
      });
    }

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

  private async loadEffectiveConfig(): Promise<InactivityConfig> {
    if (!this.configProvider) {
      return this.config;
    }

    try {
      const override = await this.configProvider();
      const reminderMinutes = override.reminderMinutes
        && override.reminderMinutes[0] < override.reminderMinutes[1]
        && override.reminderMinutes[1] < override.reminderMinutes[2]
        ? override.reminderMinutes
        : this.config.reminderMinutes;
      const autocloseMinutes = Number.isInteger(override.autocloseMinutes)
        && Number(override.autocloseMinutes) > reminderMinutes[2]
        ? Number(override.autocloseMinutes)
        : this.config.autocloseMinutes;

      return {
        ...this.config,
        enabled: typeof override.enabled === 'boolean' ? override.enabled : this.config.enabled,
        reminderMinutes,
        autocloseMinutes,
      };
    } catch (error: unknown) {
      logger.error(
        {
          error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
        },
        '[integration-service][inactivity][CONFIG_FALLBACK]',
      );

      return this.config;
    }
  }

  private async loadTicketState(ticketId: number): Promise<InactivityTicketState> {
    if (typeof this.glpiClient.getTicket === 'function') {
      try {
        const ticket = await this.glpiClient.getTicket(ticketId);
        return normalizeTicketState(ticket.status);
      } catch (error: unknown) {
        logger.warn(
          {
            ticket_id: ticketId,
            error: error instanceof Error ? { message: error.message, name: error.name } : String(error),
          },
          '[integration-service][inactivity][TICKET_STATE_READ_FAILED]',
        );
      }
    }

    return normalizeTicketState(await this.glpiClient.getTicketStatus(ticketId));
  }

  private buildOutboundRequest(
    record: InactivityTrackingRecord,
    sendPlan: MessageSendPlan,
    idempotencyKey: string,
  ): Parameters<OutboundMessageService['send']>[0] {
    return {
      ticket_id: record.ticketId ?? 0,
      conversation_id: record.conversationId,
      text: sendPlan.text,
      message_type: sendPlan.sendType === 'internal_only' ? 'text' : sendPlan.sendType,
      glpi_user_id: 0,
      idempotency_key: idempotencyKey,
      ...(sendPlan.templateName ? { template_name: sendPlan.templateName } : {}),
      language: sendPlan.language,
      buttons: sendPlan.buttons,
      list_options: sendPlan.listOptions,
    };
  }

  private async recordDiagnostic(
    record: InactivityTrackingRecord | null,
    status: 'checked' | 'eligible' | 'skipped' | 'planned' | 'sent' | 'failed',
    details: {
      eventKey?: string | null;
      reason?: string | null;
      messageId?: string | null;
      deliveryStatus?: string | null;
      metaErrorCode?: string | null;
      metaErrorMessageSanitized?: string | null;
      checkedCount?: number | null;
      eligibleCount?: number | null;
    } = {},
  ): Promise<void> {
    await this.messageConfigurationService?.recordInactivityJobEvent({
      conversationId: record?.conversationId ?? null,
      ticketId: record?.ticketId ?? null,
      phoneE164: record?.phoneE164 ?? null,
      eventKey: details.eventKey ?? null,
      status,
      reason: details.reason ?? null,
      messageId: details.messageId ?? null,
      deliveryStatus: details.deliveryStatus ?? null,
      metaErrorCode: details.metaErrorCode ?? null,
      metaErrorMessageSanitized: details.metaErrorMessageSanitized ?? null,
      checkedCount: details.checkedCount ?? null,
      eligibleCount: details.eligibleCount ?? null,
      reasonCode: normalizeInactivitySkipReason(details.reason),
      reasonDescription: details.reason ?? null,
    });
  }

  private async recordProfileDiagnostic(
    candidate: ProfileCollectionReminderCandidate | null,
    status: 'checked' | 'eligible' | 'skipped' | 'planned' | 'sent' | 'failed',
    details: {
      eventKey?: string | null;
      reason?: string | null;
      messageId?: string | null;
      deliveryStatus?: string | null;
      metaErrorMessageSanitized?: string | null;
      checkedCount?: number | null;
      eligibleCount?: number | null;
    } = {},
  ): Promise<void> {
    await this.messageConfigurationService?.recordInactivityJobEvent({
      conversationId: candidate?.conversationId ?? null,
      ticketId: null,
      phoneE164: candidate?.phoneE164 ?? null,
      eventKey: details.eventKey ?? PROFILE_COLLECTION_REMINDER_EVENT_KEY,
      status,
      reason: details.reason ?? null,
      messageId: details.messageId ?? null,
      deliveryStatus: details.deliveryStatus ?? null,
      metaErrorCode: null,
      metaErrorMessageSanitized: details.metaErrorMessageSanitized ?? null,
      checkedCount: details.checkedCount ?? null,
      eligibleCount: details.eligibleCount ?? null,
      reasonCode: normalizeInactivitySkipReason(details.reason),
      reasonDescription: details.reason ?? null,
    });
  }

  private recordProfileAudit(
    candidate: ProfileCollectionReminderCandidate,
    eventType: string,
    status: AuditStatus,
    correlationId: string,
    payload: Record<string, unknown>,
  ): void {
    this.auditService?.recordAuditEventFireAndForget({
      correlationId,
      ticketId: null,
      conversationId: candidate.conversationId,
      direction: 'outbound',
      eventType,
      status,
      severity: status === 'failed' ? 'warning' : 'info',
      source: 'InactivityAutomationService',
      payload: {
        ...payload,
        phone_masked: maskPhone(candidate.phoneE164),
      },
    });
  }

  private recordAudit(
    record: InactivityTrackingRecord,
    eventType: string,
    status: AuditStatus,
    correlationId: string,
    payload: Record<string, unknown>,
  ): void {
    this.auditService?.recordAuditEventFireAndForget({
      correlationId,
      ticketId: record.ticketId,
      conversationId: record.conversationId,
      direction: 'outbound',
      eventType,
      status,
      severity: status === 'failed' ? 'warning' : 'info',
      source: 'InactivityAutomationService',
      payload: {
        ...payload,
        phone_masked: record.phoneE164 ? maskPhone(record.phoneE164) : null,
      },
    });
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '****';
  }
  return `${digits.slice(0, 2)}******${digits.slice(-4)}`;
}

function extractProfileString(state: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = state[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim().slice(0, 180);
    }
  }

  return null;
}

function buildPreTicketTimeoutTitle(state: Record<string, unknown>): string {
  const summary = extractProfileString(state, ['last_problem_summary', 'problem_summary', 'reason']);
  const safeSummary = summary && summary.length > 0 ? summary : 'atendimento sem resposta';
  return `[WA][Triagem] ${safeSummary.slice(0, 80)}`;
}

function buildPreTicketTimeoutContent(state: Record<string, unknown>): string {
  const lines = [
    '[Abertura automática por ausência de resposta]',
    'O cliente iniciou o atendimento pelo WhatsApp, mas não respondeu às próximas solicitações no prazo operacional.',
    'Chamado aberto com as informações disponíveis para revisão humana.',
    '',
  ];
  const requester = extractProfileString(state, ['requester_name', 'company_name_raw', 'name']);
  const email = extractProfileString(state, ['email_address']);
  const tag = extractProfileString(state, ['last_equipment_tag', 'equipment_tag']);
  const reason = extractProfileString(state, ['last_problem_summary', 'problem_summary', 'reason']);
  if (requester) lines.push(`Nome informado: ${requester}`);
  if (email) lines.push(`E-mail informado: ${email}`);
  if (tag) lines.push(`Etiqueta/Patrimônio: ${tag}`);
  if (reason) lines.push(`Motivo informado: ${reason}`);
  if (!reason) lines.push('Motivo informado: não informado antes do timeout.');
  lines.push('', 'Observação: informações incompletas por ausência de resposta.');
  return lines.join('\n');
}

function normalizeProfileCollectionStep(state: Record<string, unknown>, conversationStatus?: string | null): string {
  if (conversationStatus === 'awaiting_entity_selection') {
    return 'awaiting_entity_selection';
  }

  const step = state.step;
  return typeof step === 'string' ? step.trim() : '';
}
