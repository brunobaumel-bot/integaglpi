import type { GlpiClient } from '../../adapters/glpi/GlpiClient.js';
import { logger } from '../../infra/logger/logger.js';
import type { AuditStatus } from '../../repositories/contracts/AuditEventRepository.js';
import type { InactivityTrackingRecord, InactivityTrackingRepository } from '../../repositories/contracts/InactivityTrackingRepository.js';
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

export interface InactivityDecision {
  action: InactivityDecisionAction;
  reason: string;
  reminderNumber?: 1 | 2 | 3;
}

const REMINDER_TEXTS: Record<1 | 2 | 3, string> = {
  1: 'Olá! Estamos aguardando seu retorno para continuar o atendimento. Podemos ajudar em algo mais?',
  2: 'Ainda estamos por aqui. Para seguirmos com o chamado, responda esta mensagem quando puder.',
  3: 'Como ainda não tivemos retorno, este atendimento poderá ser encerrado automaticamente se não houver resposta.',
};

const AUTOCLOSE_TEXT =
  'Como não tivemos retorno, estamos encerrando este atendimento por falta de resposta. Se precisar, basta nos chamar novamente.';
const AUTOCLOSE_WARNING_TEXT = 'Este atendimento poderá ser encerrado automaticamente se não houver resposta.';
const AUTOCLOSE_REASON = 'Encerrado por falta de retorno do usuário';
const SOLVED_STATUS = 5;

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

export function parseReminderMinutes(value: string): [number, number, number] {
  const parsed = value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((part) => Number.isInteger(part) && part > 0);

  if (parsed.length !== 3 || !(parsed[0] < parsed[1] && parsed[1] < parsed[2])) {
    return [3, 5, 10];
  }

  return [parsed[0], parsed[1], parsed[2]];
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
    private readonly outboundMessageService: Pick<OutboundMessageService, 'send'>,
    private readonly glpiClient: Pick<GlpiClient, 'getTicketStatus' | 'solveTicketByInactivity'>,
    private readonly auditService: AuditService | null,
    private readonly config: InactivityConfig,
    private readonly nowProvider: () => Date = () => new Date(),
    private readonly messageConfigurationService: MessageConfigurationService | null = null,
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
    if (!this.config.enabled) {
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
        await this.processCandidate(candidate);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processCandidate(candidate: InactivityTrackingRecord): Promise<void> {
    const refreshed = await this.repository.findByConversationId(candidate.conversationId);
    if (!refreshed) {
      return;
    }

    const now = this.nowProvider();
    const decision = decideInactivityAction(refreshed, this.config, now);
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
      await this.handleAutoclose(refreshed);
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

    const ticketStatus = await this.glpiClient.getTicketStatus(record.ticketId);
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
      await this.repository.markFailed(record.conversationId, sendPlan.reason ?? 'not_sent_by_rule');
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
      this.recordAudit(record, `INACTIVITY_REMINDER_${reminderNumber}_NOT_SENT_BY_RULE`, 'ignored', correlationId, {
        reason: sendPlan.reason ?? 'not_sent_by_rule',
        idempotency_key: idempotencyKey,
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
  }

  private async handleAutoclose(record: InactivityTrackingRecord): Promise<void> {
    if (!record.ticketId) {
      return;
    }

    const correlationId = createCorrelationId();
    const refreshed = await this.repository.findByConversationId(record.conversationId);
    if (!refreshed || hasClientResponseAfterOutbound(refreshed) || hasManualHold(refreshed, this.nowProvider())) {
      await this.handleSkip(record, refreshed && hasClientResponseAfterOutbound(refreshed) ? 'client_responded' : 'manual_hold');
      return;
    }

    const ticketStatus = await this.glpiClient.getTicketStatus(record.ticketId);
    if (ticketStatus === 'closed') {
      await this.handleSkip(record, 'ticket_closed_or_solved');
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
      await this.sendAutocloseConfiguredMessage(
        record,
        'inactivity_autoclose_warning',
        AUTOCLOSE_WARNING_TEXT,
        `inactivity:autoclose_warning:${record.conversationId}:${record.ticketId}`,
        correlationId,
        windowOpen,
      );
      await this.sendAutocloseConfiguredMessage(
        record,
        'inactivity_autoclose_message',
        AUTOCLOSE_TEXT,
        `inactivity:autoclose_notice:${record.conversationId}:${record.ticketId}`,
        correlationId,
        windowOpen,
      );

      await this.glpiClient.solveTicketByInactivity(record.ticketId, `${AUTOCLOSE_REASON}\n\n${AUTOCLOSE_TEXT}`);
      await this.repository.markAutocloseCompleted(record.conversationId, this.nowProvider());
      await this.recordDiagnostic(record, 'sent', {
        eventKey: 'inactivity_autoclose_message',
        reason: 'autoclose_done',
      });
      this.recordAudit(record, 'INACTIVITY_AUTOCLOSE_DONE', 'success', correlationId, {
        reason: 'no_client_response',
        glpi_status: SOLVED_STATUS,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.markFailed(record.conversationId, message);
      await this.recordDiagnostic(record, 'failed', {
        eventKey: 'inactivity_autoclose_message',
        reason: 'autoclose_failed',
        metaErrorMessageSanitized: message.slice(0, 500),
      });
      this.recordAudit(record, 'INACTIVITY_AUTOCLOSE_FAILED', 'failed', correlationId, {
        error_message: message.slice(0, 500),
      });
    }
  }

  private async handleSkip(record: InactivityTrackingRecord, reason: string): Promise<void> {
    const status = reason === 'client_responded'
      ? 'skipped_by_response'
      : reason === 'manual_hold'
        ? 'skipped_by_hold'
        : reason === 'feature_flag_disabled'
          ? 'skipped_by_feature_flag'
          : 'skipped_by_closed_ticket';
    await this.repository.markSkipped(record.conversationId, status, reason);
    await this.recordDiagnostic(record, 'skipped', { reason });
    this.recordAudit(record, 'INACTIVITY_SKIPPED', 'ignored', createCorrelationId(), { reason });
  }

  private async sendAutocloseConfiguredMessage(
    record: InactivityTrackingRecord,
    eventKey: 'inactivity_autoclose_warning' | 'inactivity_autoclose_message',
    fallbackText: string,
    idempotencyKey: string,
    correlationId: string,
    windowOpen: boolean,
  ): Promise<void> {
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
      return;
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
      return;
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
