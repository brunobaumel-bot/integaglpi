import { createHash, randomUUID } from 'node:crypto';

import type { KeyLock } from '../contracts/KeyLock.js';
import type { SqlExecutor } from '../../infra/db/postgres.js';
import type { AuditService } from './AuditService.js';
import type { AiSupervisorService } from './AiSupervisorService.js';
import type { RiskScoringService } from './RiskScoringService.js';

export const AI_ONLINE_ALERT_TYPES = [
  'long_waiting_client',
  'high_risk_reopen',
  'possible_frustration',
  'supervisor_requested',
  'long_inactivity_risk',
  'queue_accumulation',
  'no_responsible_technician',
] as const;

type AlertType = typeof AI_ONLINE_ALERT_TYPES[number];
type AlertSeverity = 'low' | 'medium' | 'high';

export interface AiOnlineSupervisorAlertConfig {
  clientWaitHours: number;
  criticalWaitHours: number;
  windowCloseHours: number;
  queueAccumulationLimit: number;
  maxConversationsPerRun: number;
  maxExecutionTimeSeconds: number;
  maxAlertsPerConversation: number;
  maxAlertsPerQueue: number;
  cooldownMinutes: number;
  maxAlertsGlobalPerHour: number;
  maxRecentMessages: number;
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

interface ConversationCandidate {
  conversationId: string;
  glpiTicketId: number | null;
  status: string | null;
  queueId: number | null;
  entityId: number | null;
  technicianId: number | null;
  lastMessageAt: Date | null;
  lastMessageDirection: string | null;
  lastMessageText: string;
  updatedAt: Date | null;
  inactivityStatus: string | null;
  inactivitySkipReason: string | null;
  stalledMinutes: number;
  messageCount: number;
}

interface AlertDraft {
  alertType: AlertType;
  severity: AlertSeverity;
  confidenceScore: number;
  evidenceSummarySanitized: string;
  recommendedHumanAction: string;
  sourceSignals: Record<string, unknown>;
  requiresAi: boolean;
}

export interface AiOnlineSupervisorAlertRunResult {
  processed: number;
  created: number;
  suppressed: number;
  errors: number;
}

const DEFAULT_CONFIG: AiOnlineSupervisorAlertConfig = {
  clientWaitHours: 4,
  criticalWaitHours: 2,
  windowCloseHours: 1,
  queueAccumulationLimit: 10,
  maxConversationsPerRun: 50,
  maxExecutionTimeSeconds: 120,
  maxAlertsPerConversation: 3,
  maxAlertsPerQueue: 20,
  cooldownMinutes: 45,
  maxAlertsGlobalPerHour: 50,
  maxRecentMessages: 6,
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sanitizeText(value: string, max = 700): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?\d[\d .()-]{7,}\d)\b/g, '[telefone]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
    .replace(/\b(password|senha|token|bearer|api[_-]?key|app[_-]?secret)\s*[:=]\s*[^,\s]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function hoursLabel(minutes: number): string {
  if (minutes < 60) {
    return `${Math.max(0, Math.round(minutes))}min`;
  }
  return `${Math.round(minutes / 60)}h`;
}

function containsSupervisorRequest(text: string): boolean {
  return /\b(supervisor|gerente|respons[aá]vel|coordena[cç][aã]o|diretoria)\b/i.test(text);
}

function containsFrustrationSignal(text: string): boolean {
  return /\b(absurdo|insatisfeito|insatisfeita|reclama[cç][aã]o|demora|sem retorno|cancelar|frustrad[oa]|irritad[oa]|n[aã]o gostei|p[eé]ssim[oa]|vou reclamar|procon)\b/i.test(text);
}

export class AiOnlineSupervisorAlertService {
  private readonly config: AiOnlineSupervisorAlertConfig;

  public constructor(
    private readonly executor: SqlExecutor,
    private readonly redis: RedisLike,
    private readonly lock: KeyLock,
    private readonly riskScoringService: RiskScoringService,
    private readonly aiSupervisorService?: AiSupervisorService,
    private readonly auditService?: AuditService,
    config: Partial<AiOnlineSupervisorAlertConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public async runOnce(now = new Date()): Promise<AiOnlineSupervisorAlertRunResult> {
    const started = Date.now();
    const result: AiOnlineSupervisorAlertRunResult = { processed: 0, created: 0, suppressed: 0, errors: 0 };
    const queuePressure = await this.loadQueuePressure();
    const conversations = await this.loadEligibleConversations();

    for (const conversation of conversations) {
      if ((Date.now() - started) / 1000 >= this.config.maxExecutionTimeSeconds) {
        await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'ignored', conversation, {
          reason: 'max_execution_time_reached',
        });
        break;
      }

      try {
        await this.lock.withLock(`ai_online_alert:${conversation.conversationId}`, async () => {
          const evaluation = await this.evaluateConversation(conversation, queuePressure, now);
          result.processed += 1;
          for (const draft of evaluation) {
            const created = await this.persistOrSuppress(conversation, draft, now);
            if (created) {
              result.created += 1;
            } else {
              result.suppressed += 1;
            }
          }
        });
      } catch (error: unknown) {
        result.errors += 1;
        await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'failed', conversation, {
          reason: 'worker_error',
          error_type: this.safeErrorType(error),
        });
      }
    }

    return result;
  }

  private async loadEligibleConversations(): Promise<ConversationCandidate[]> {
    const query = await this.executor.query<{
      conversation_id: string;
      glpi_ticket_id: string | number | null;
      status: string | null;
      queue_id: string | number | null;
      entity_id: string | number | null;
      technician_id: string | number | null;
      last_message_at: Date | null;
      last_message_direction: string | null;
      last_message_text: string | null;
      updated_at: Date | null;
      inactivity_status: string | null;
      inactivity_skip_reason: string | null;
      stalled_minutes: string | number | null;
      message_count: string | number | null;
    }>(
      `
        SELECT
          c.id AS conversation_id,
          c.glpi_ticket_id,
          c.status,
          COALESCE(rt.queue_id, c.queue_id) AS queue_id,
          c.glpi_entity_id AS entity_id,
          rt.assigned_user_id AS technician_id,
          COALESCE(lm.created_at, c.last_message_at) AS last_message_at,
          lm.direction AS last_message_direction,
          lm.message_text AS last_message_text,
          c.updated_at,
          it.status AS inactivity_status,
          it.skip_reason AS inactivity_skip_reason,
          EXTRACT(EPOCH FROM (NOW() - COALESCE(lm.created_at, c.last_message_at, c.updated_at, c.created_at))) / 60 AS stalled_minutes,
          COALESCE(mc.message_count, 0) AS message_count
        FROM public.glpi_plugin_integaglpi_conversations c
        LEFT JOIN public.glpi_plugin_integaglpi_conversation_runtime rt
          ON rt.conversation_id = c.id
        LEFT JOIN public.glpi_plugin_integaglpi_inactivity_tracking it
          ON it.conversation_id = c.id
        LEFT JOIN LATERAL (
          SELECT direction, message_text, created_at
          FROM public.glpi_plugin_integaglpi_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
        ) lm ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS message_count
          FROM public.glpi_plugin_integaglpi_messages m
          WHERE m.conversation_id = c.id
        ) mc ON TRUE
        WHERE c.status NOT IN ('closed', 'cancelled')
        ORDER BY
          CASE
            WHEN COALESCE(lm.created_at, c.last_message_at, c.updated_at, c.created_at) >= NOW() - INTERVAL '2 hours' THEN 0
            ELSE 1
          END ASC,
          COALESCE(lm.created_at, c.last_message_at, c.updated_at, c.created_at) DESC NULLS LAST
        LIMIT $1
      `,
      [this.config.maxConversationsPerRun],
    );

    return query.rows.map((row) => ({
      conversationId: row.conversation_id,
      glpiTicketId: row.glpi_ticket_id === null ? null : Number(row.glpi_ticket_id),
      status: row.status,
      queueId: row.queue_id === null ? null : Number(row.queue_id),
      entityId: row.entity_id === null ? null : Number(row.entity_id),
      technicianId: row.technician_id === null ? null : Number(row.technician_id),
      lastMessageAt: row.last_message_at,
      lastMessageDirection: row.last_message_direction,
      lastMessageText: sanitizeText(row.last_message_text ?? '', 500),
      updatedAt: row.updated_at,
      inactivityStatus: row.inactivity_status,
      inactivitySkipReason: sanitizeText(row.inactivity_skip_reason ?? '', 180),
      stalledMinutes: Number(row.stalled_minutes ?? 0),
      messageCount: Number(row.message_count ?? 0),
    }));
  }

  private async loadQueuePressure(): Promise<Map<number, number>> {
    const result = await this.executor.query<{ queue_id: string | number | null; open_unassigned: string | number }>(
      `
        SELECT COALESCE(rt.queue_id, c.queue_id) AS queue_id, COUNT(*)::int AS open_unassigned
        FROM public.glpi_plugin_integaglpi_conversations c
        LEFT JOIN public.glpi_plugin_integaglpi_conversation_runtime rt
          ON rt.conversation_id = c.id
        WHERE c.status NOT IN ('closed', 'cancelled')
          AND rt.assigned_user_id IS NULL
        GROUP BY COALESCE(rt.queue_id, c.queue_id)
      `,
    );

    const pressure = new Map<number, number>();
    for (const row of result.rows) {
      const queueId = row.queue_id === null ? 0 : Number(row.queue_id);
      pressure.set(queueId, Number(row.open_unassigned));
    }
    return pressure;
  }

  private async evaluateConversation(
    conversation: ConversationCandidate,
    queuePressure: Map<number, number>,
    now: Date,
  ): Promise<AlertDraft[]> {
    const drafts = this.buildDeterministicDrafts(conversation, queuePressure);
    const riskDraft = this.buildRiskDraft(conversation);
    if (riskDraft !== null) {
      drafts.push(riskDraft);
    }

    const aiCandidates = drafts.filter((draft) => draft.requiresAi);
    if (aiCandidates.length > 0 && this.aiSupervisorService?.isEnabled() && (conversation.glpiTicketId ?? 0) > 0) {
      const aiDraft = await this.buildAiDraft(conversation, now);
      if (aiDraft !== null) {
        drafts.push(aiDraft);
      }
    }

    return this.uniqueDrafts(drafts).slice(0, this.config.maxAlertsPerConversation);
  }

  private buildDeterministicDrafts(
    conversation: ConversationCandidate,
    queuePressure: Map<number, number>,
  ): AlertDraft[] {
    const drafts: AlertDraft[] = [];
    const stalled = conversation.stalledMinutes;
    const latestText = conversation.lastMessageText;

    if (conversation.lastMessageDirection === 'inbound' && stalled >= this.config.clientWaitHours * 60) {
      drafts.push(this.makeDraft(
        'long_waiting_client',
        stalled >= this.config.clientWaitHours * 120 ? 'high' : 'medium',
        80,
        `Possível ponto de atenção: cliente aguarda retorno há ${hoursLabel(stalled)}.`,
        'Sugestão para revisão humana: verificar contexto e orientar próximo passo com clareza.',
        { stalled_minutes: Math.round(stalled), last_direction: 'inbound' },
        false,
      ));
    }

    if ((conversation.technicianId ?? 0) <= 0 && stalled >= 30) {
      drafts.push(this.makeDraft(
        'no_responsible_technician',
        stalled >= this.config.criticalWaitHours * 60 ? 'high' : 'medium',
        78,
        `Conversa pode precisar de acompanhamento: sem técnico responsável há ${hoursLabel(stalled)}.`,
        'Sugestão para revisão humana: validar fila e definir responsável quando aplicável.',
        { stalled_minutes: Math.round(stalled), assigned_user_id: null },
        false,
      ));
    }

    const queueCount = queuePressure.get(conversation.queueId ?? 0) ?? 0;
    if (queueCount >= this.config.queueAccumulationLimit && (conversation.technicianId ?? 0) <= 0) {
      drafts.push(this.makeDraft(
        'queue_accumulation',
        queueCount >= this.config.queueAccumulationLimit * 2 ? 'high' : 'medium',
        72,
        `Oportunidade de melhoria operacional: fila com ${queueCount} conversas abertas sem responsável.`,
        'Sugestão para revisão humana: avaliar distribuição da fila sem comparação individual.',
        { queue_open_unassigned: queueCount, queue_id: conversation.queueId },
        false,
      ));
    }

    const inactivity = String(conversation.inactivityStatus ?? '').toLowerCase();
    if (inactivity.includes('risk') || inactivity.includes('reminder') || inactivity.includes('autoclose')) {
      drafts.push(this.makeDraft(
        'long_inactivity_risk',
        inactivity.includes('autoclose') ? 'high' : 'medium',
        76,
        'Conversa pode precisar de acompanhamento por sinal de inatividade/SLA.',
        'Sugestão para revisão humana: confirmar se há próxima ação clara antes de encerrar qualquer ciclo.',
        { inactivity_status: inactivity, inactivity_skip_reason: conversation.inactivitySkipReason },
        false,
      ));
    }

    if (containsSupervisorRequest(latestText)) {
      drafts.push(this.makeDraft(
        'supervisor_requested',
        'high',
        82,
        'Cliente aparenta solicitar acompanhamento de responsável ou supervisão.',
        'Sugestão para revisão humana: supervisor pode revisar a conversa e orientar a continuidade.',
        { semantic_signal: 'supervisor_request' },
        true,
      ));
    }

    if (containsFrustrationSignal(latestText)) {
      drafts.push(this.makeDraft(
        'possible_frustration',
        'medium',
        68,
        'Conversa pode conter sinal de frustração e merece revisão humana.',
        'Sugestão para revisão humana: avaliar tom, contexto e próximos passos antes de orientar resposta.',
        { semantic_signal: 'possible_frustration' },
        true,
      ));
    }

    return drafts;
  }

  private buildRiskDraft(conversation: ConversationCandidate): AlertDraft | null {
    const risk = this.riskScoringService.score({
      conversationId: conversation.conversationId,
      glpiTicketId: conversation.glpiTicketId,
      slaInactivity: {
        inactivityStatus: conversation.inactivityStatus,
        minutesWithoutTechnicianResponse: conversation.lastMessageDirection === 'inbound'
          ? Math.round(conversation.stalledMinutes)
          : null,
      },
      messageMetadata: {
        messageCount: conversation.messageCount,
        lastActivityAgeMinutes: Math.round(conversation.stalledMinutes),
      },
    });

    if (risk.reopenRisk !== 'high' && risk.riskScore < 70) {
      return null;
    }

    return this.makeDraft(
      'high_risk_reopen',
      'high',
      Math.max(70, risk.confidenceScore),
      'Possível ponto de atenção: sinais estruturados indicam risco elevado de reabertura ou retrabalho.',
      'Sugestão para revisão humana: validar se a solução, próximos passos e critérios de encerramento estão claros.',
      {
        risk_score: risk.riskScore,
        reopen_risk: risk.reopenRisk,
        reasons: risk.reasons.slice(0, 3).map((reason) => sanitizeText(reason, 180)),
      },
      true,
    );
  }

  private async buildAiDraft(conversation: ConversationCandidate, now: Date): Promise<AlertDraft | null> {
    if (!this.aiSupervisorService || !this.aiSupervisorService.isEnabled() || (conversation.glpiTicketId ?? 0) <= 0) {
      return null;
    }

    try {
      const analysis = await this.aiSupervisorService.requestAnalysis({
        conversationId: conversation.conversationId,
        glpiTicketId: conversation.glpiTicketId ?? 0,
        createdBy: null,
      });
      if (analysis.status !== 'completed' || analysis.resultJson === null) {
        await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'ignored', conversation, {
          reason: analysis.status === 'failed' ? 'provider_unavailable' : 'low_confidence',
          analysis_status: analysis.status,
        });
        return null;
      }

      const result = analysis.resultJson;
      const riskLevel = String(result.risk_level ?? result.riskLevel ?? '').toLowerCase();
      const sentiment = String(result.sentiment ?? '').toLowerCase();
      const satisfactionRisk = String(result.client_satisfaction_risk ?? result.clientSatisfactionRisk ?? '').toLowerCase();
      const confidence = clamp(Number(result.confidence_score ?? result.confidenceScore ?? 0));
      if (confidence < 55 || (riskLevel !== 'high' && sentiment !== 'frustrated' && satisfactionRisk !== 'high')) {
        await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'ignored', conversation, {
          reason: 'low_confidence',
          confidence_score: confidence,
        });
        return null;
      }

      await this.audit('AI_ONLINE_ALERT_ENRICHED', 'success', conversation, {
        ai_analysis_id: analysis.id,
        provider: analysis.provider,
        model_hash: hash(analysis.model).slice(0, 16),
        confidence_score: confidence,
      });

      return this.makeDraft(
        sentiment === 'frustrated' ? 'possible_frustration' : 'high_risk_reopen',
        riskLevel === 'high' || satisfactionRisk === 'high' ? 'high' : 'medium',
        confidence,
        sanitizeText(String(result.summary ?? 'Análise supervisória indica possível ponto de atenção.'), 500),
        sanitizeText(String(result.suggested_next_action ?? result.suggestedNextAction ?? 'Sugestão para revisão humana: verificar contexto e orientar próximo passo.'), 500),
        {
          ai_analysis_id: analysis.id,
          provider: analysis.provider,
          model_hash: hash(analysis.model).slice(0, 16),
          generated_at: now.toISOString(),
        },
        false,
      );
    } catch (error: unknown) {
      await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'failed', conversation, {
        reason: this.mapAiError(error),
      });
      return null;
    }
  }

  private makeDraft(
    alertType: AlertType,
    severity: AlertSeverity,
    confidenceScore: number,
    evidenceSummary: string,
    recommendedHumanAction: string,
    sourceSignals: Record<string, unknown>,
    requiresAi: boolean,
  ): AlertDraft {
    return {
      alertType,
      severity,
      confidenceScore: clamp(confidenceScore),
      evidenceSummarySanitized: sanitizeText(evidenceSummary, 700),
      recommendedHumanAction: sanitizeText(recommendedHumanAction, 500),
      sourceSignals,
      requiresAi,
    };
  }

  private uniqueDrafts(drafts: AlertDraft[]): AlertDraft[] {
    const severityRank: Record<AlertSeverity, number> = { low: 1, medium: 2, high: 3 };
    const byType = new Map<AlertType, AlertDraft>();
    for (const draft of drafts) {
      const current = byType.get(draft.alertType);
      if (current === undefined
        || severityRank[draft.severity] > severityRank[current.severity]
        || (severityRank[draft.severity] === severityRank[current.severity]
          && draft.confidenceScore > current.confidenceScore)) {
        byType.set(draft.alertType, draft);
      }
    }

    return [...byType.values()];
  }

  private async persistOrSuppress(conversation: ConversationCandidate, draft: AlertDraft, now: Date): Promise<boolean> {
    if (await this.hasCooldown(conversation, draft.alertType)) {
      await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'ignored', conversation, {
        alert_type: draft.alertType,
        reason: 'cooldown',
      });
      return false;
    }

    if (await this.activeConversationAlertCount(conversation.conversationId) >= this.config.maxAlertsPerConversation) {
      await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'ignored', conversation, {
        alert_type: draft.alertType,
        reason: 'max_alerts_per_conversation',
      });
      await this.setCooldown(conversation, draft.alertType);
      return false;
    }

    if (!await this.consumeRateLimit(conversation)) {
      await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'ignored', conversation, {
        alert_type: draft.alertType,
        reason: 'rate_limit',
      });
      await this.setCooldown(conversation, draft.alertType);
      return false;
    }

    const alertId = this.alertId(conversation, draft, now);
    const insert = await this.executor.query<{ alert_id: string }>(
      `
        INSERT INTO public.glpi_plugin_integaglpi_ai_online_alerts (
          alert_id,
          conversation_id,
          glpi_ticket_id,
          queue_id,
          technician_id,
          entity_id,
          alert_type,
          severity,
          confidence_score,
          evidence_summary_sanitized,
          recommended_human_action,
          source_signals_json,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'open', NOW(), NOW())
        ON CONFLICT (alert_id) DO NOTHING
        RETURNING alert_id
      `,
      [
        alertId,
        conversation.conversationId,
        conversation.glpiTicketId,
        conversation.queueId,
        conversation.technicianId,
        conversation.entityId,
        draft.alertType,
        draft.severity,
        draft.confidenceScore,
        draft.evidenceSummarySanitized,
        draft.recommendedHumanAction,
        JSON.stringify(this.sanitizedSignals(draft.sourceSignals)),
      ],
    );

    await this.setCooldown(conversation, draft.alertType);
    if (!insert.rowCount) {
      await this.audit('AI_ONLINE_ALERT_SUPPRESSED', 'ignored', conversation, {
        alert_type: draft.alertType,
        reason: 'duplicate_alert_id',
      });
      return false;
    }

    await this.audit('AI_ONLINE_ALERT_CREATED', 'success', conversation, {
      alert_id: alertId,
      alert_type: draft.alertType,
      severity: draft.severity,
      confidence_score: draft.confidenceScore,
      payload_hash: hash(draft.sourceSignals),
    });
    return true;
  }

  private async activeConversationAlertCount(conversationId: string): Promise<number> {
    const result = await this.executor.query<{ count: string | number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.glpi_plugin_integaglpi_ai_online_alerts
        WHERE conversation_id = $1
          AND status = 'open'
          AND (dismissed_until IS NULL OR dismissed_until <= NOW())
      `,
      [conversationId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private async hasCooldown(conversation: ConversationCandidate, alertType: AlertType): Promise<boolean> {
    return await this.redis.get(this.cooldownKey(conversation, alertType)) !== null;
  }

  private async setCooldown(conversation: ConversationCandidate, alertType: AlertType): Promise<void> {
    await this.redis.set(this.cooldownKey(conversation, alertType), '1', 'EX', this.config.cooldownMinutes * 60);
  }

  private async consumeRateLimit(conversation: ConversationCandidate): Promise<boolean> {
    const global = await this.incrementWindow(`ai_online_alert:rate:global:${this.hourKey()}`, 3600);
    if (global > this.config.maxAlertsGlobalPerHour) {
      return false;
    }

    const queueKey = conversation.queueId ?? 0;
    const queue = await this.incrementWindow(`ai_online_alert:rate:queue:${queueKey}:${this.hourKey()}`, 3600);
    return queue <= this.config.maxAlertsPerQueue;
  }

  private async incrementWindow(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return count;
  }

  private alertId(conversation: ConversationCandidate, draft: AlertDraft, now: Date): string {
    const bucketMs = this.config.cooldownMinutes * 60_000;
    const bucket = Math.floor(now.getTime() / bucketMs);
    return hash(`ai_online:${conversation.conversationId}:${draft.alertType}:${bucket}`).slice(0, 32);
  }

  private cooldownKey(conversation: ConversationCandidate, alertType: AlertType): string {
    return `ai_online_alert:cooldown:${conversation.conversationId}:${alertType}`;
  }

  private hourKey(): string {
    return new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '');
  }

  private sanitizedSignals(signals: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(signals).map(([key, value]) => [
      key,
      typeof value === 'string' ? sanitizeText(value, 220) : value,
    ]));
  }

  private mapAiError(error: unknown): string {
    const message = this.safeErrorType(error);
    if (message.includes('TIMEOUT')) {
      return 'timeout';
    }
    if (message.includes('INVALID') || message.includes('JSON')) {
      return 'invalid_response';
    }
    return 'provider_unavailable';
  }

  private safeErrorType(error: unknown): string {
    return sanitizeText(error instanceof Error ? error.message : String(error), 120).replace(/[^A-Za-z0-9_.:-]+/g, '_');
  }

  private async audit(
    eventType: string,
    status: 'success' | 'failed' | 'ignored',
    conversation: ConversationCandidate,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService?.recordAuditEventSafe({
      eventType,
      status,
      severity: status === 'failed' ? 'error' : (eventType.includes('SUPPRESSED') ? 'warning' : 'info'),
      source: 'AiOnlineSupervisorAlertService',
      ticketId: conversation.glpiTicketId,
      conversationId: conversation.conversationId,
      payload: {
        conversation_id: conversation.conversationId,
        glpi_ticket_id: conversation.glpiTicketId,
        queue_id: conversation.queueId,
        technician_id: conversation.technicianId,
        ...this.sanitizedSignals(payload),
      },
      errorMessage: status === 'failed' ? String(payload.reason ?? 'ai_online_alert_error') : null,
    });
  }
}

export function createDefaultAiOnlineSupervisorAlertConfig(): AiOnlineSupervisorAlertConfig {
  return { ...DEFAULT_CONFIG };
}
