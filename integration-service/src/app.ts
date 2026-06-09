import express from 'express';
import { pinoHttp } from 'pino-http';

import type { InboundWebhookService } from './domain/services/InboundWebhookService.js';
import type { OutboundMessageService } from './domain/services/OutboundMessageService.js';
import type { EntitySelectionService } from './domain/services/EntitySelectionService.js';
import type { ConversationSoftCloseService } from './domain/services/ConversationSoftCloseService.js';
import type { AuditService } from './domain/services/AuditService.js';
import type { AiSupervisorService } from './domain/services/AiSupervisorService.js';
import type { CopilotDraftService } from './domain/services/CopilotDraftService.js';
import type { AiPilotService } from './domain/services/AiPilotService.js';
import type { AiOperationsService } from './domain/services/AiOperationsService.js';
import type { ContactAgendaImportService } from './domain/services/ContactAgendaImportService.js';
import type { ManualTicketWhatsappLinkService } from './domain/services/ManualTicketWhatsappLinkService.js';
import type { LogmeinReadonlyContextService } from './domain/services/LogmeinReadonlyContextService.js';
import type { GlpiClient } from './adapters/glpi/GlpiClient.js';
import type { QualityDashboardService } from './services/QualityDashboardService.js';
import type { ObservabilityService } from './services/ObservabilityService.js';
import { createOpsDiagnosticsController, healthController } from './controllers/healthController.js';
import { createAiQualityAnalysisController } from './controllers/createAiQualityAnalysisController.js';
import { createAiQualityFeedbackController } from './controllers/createAiQualityFeedbackController.js';
import { createCopilotDraftController } from './controllers/createCopilotDraftController.js';
import { createAiPilotStatusController, createAiPilotSyntheticTestController } from './controllers/createAiPilotController.js';
import {
  createHistoricalMiningExecuteController,
  createHistoricalMiningPreviewController,
  createKbCandidateGenerateController,
} from './controllers/createAiOperationsController.js';
import { createQualityDashboardController } from './controllers/createQualityDashboardController.js';
import { createObservabilityController } from './controllers/createObservabilityController.js';
import { createGlpiOutboundMessageController } from './controllers/createGlpiOutboundMessageController.js';
import { createGlpiTicketSolvedNotificationController } from './controllers/createGlpiTicketSolvedNotificationController.js';
import {
  createContactAgendaImportConfirmController,
  createContactAgendaImportPreviewController,
  createContactAgendaImportRollbackController,
  createContactAgendaImportStatusController,
} from './controllers/createContactAgendaImportController.js';
import {
  createManualTicketWhatsappResolveController,
  createManualTicketWhatsappStartTemplateController,
} from './controllers/createManualTicketWhatsappController.js';
import { createLogmeinHealthController, createLogmeinReadonlySyncController } from './controllers/createLogmeinReadonlyController.js';
import {
  createAiMetricsController,
  createCoachingChecklistController,
  createCoachingSuggestKbController,
  createExternalResearchDynamicController,
  createExternalResearchPreviewController,
  createSmartHelpController,
  createTechnicalSummaryController,
} from './controllers/ai.controller.js';
import { createKbRagController } from './controllers/kb.rag.controller.js';
import type { KbRagCopilotService } from './domain/services/KbRagCopilotService.js';
import { createCentralHubController } from './controllers/createCentralHubController.js';
import type { CentralHubAggregatorService } from './domain/services/CentralHubAggregatorService.js';
import {
  createLogmeinOperationsDashboardController,
  createLogmeinAlarmHistoryController,
  createLogmeinRuleTestController,
  createLogmeinLowDiskDryRunController,
  createLogmeinCoverageController,
} from './controllers/logmein.controller.js';
import type { LogmeinOperationsDashboardService } from './domain/services/LogmeinOperationsDashboardService.js';
import type { PostgresLogmeinAlarmRepository } from './repositories/postgres/PostgresLogmeinAlarmRepository.js';
import type { LogmeinRuleTestService } from './domain/services/LogmeinRuleTestService.js';
import type { LogmeinLowDiskCheckService } from './domain/services/LogmeinLowDiskCheckService.js';
import type { LogmeinCoverageReportService } from './domain/services/LogmeinCoverageReportService.js';
import type { LogmeinAlarmCorrelationService } from './domain/services/LogmeinAlarmCorrelationService.js';
import {
  createAutomationAdvisoryController,
  createAutomationMatrixController,
} from './controllers/automation.controller.js';
import type { ControlledAutomationService } from './domain/services/ControlledAutomationService.js';
import {
  createReconciliationMatchingReportController,
  createReconciliationCoverageGapsController,
  createReconciliationPreviewController,
} from './controllers/reconciliation.controller.js';
import type { LogmeinAssetMatchingService } from './domain/services/LogmeinAssetMatchingService.js';
import type { SmartHelpService } from './domain/services/SmartHelpService.js';
import type { ExternalResearchService } from './domain/services/ExternalResearchService.js';
import type { CoachingService } from './domain/services/CoachingService.js';
import type { FeedbackService } from './domain/services/FeedbackService.js';
import type { CloudAuditRepository } from './repositories/postgres/PostgresCloudAuditRepository.js';
import {
  createLogmeinReconciliationQueueController,
  createLogmeinReconciliationResolveController,
  createLogmeinReconciliationSyncController,
} from './controllers/createLogmeinReconciliationController.js';
import {
  createConversationEntityController,
  createConversationEntityStatusController,
} from './controllers/createConversationEntityController.js';
import { createConversationSoftCloseController } from './controllers/createConversationSoftCloseController.js';
import { createMetaWebhookGetController } from './controllers/createMetaWebhookGetController.js';
import { createMetaWebhookPostController } from './controllers/createMetaWebhookPostController.js';
import { logger } from './infra/logger/logger.js';
import { createInternalBearerMiddleware } from './middleware/createInternalBearerMiddleware.js';
import { createMetaWebhookSignatureMiddleware } from './middleware/createMetaWebhookSignatureMiddleware.js';
import { postgresPool } from './infra/db/postgres.js';

const OUTBOUND_MEDIA_JSON_LIMIT = '30mb';
const CONTACT_AGENDA_IMPORT_JSON_LIMIT = '5mb';
const AI_OPERATIONS_JSON_LIMIT = '6mb';

export interface AppDependencies {
  inboundWebhookService: InboundWebhookService;
  metaAppSecret: string;
  metaVerifyToken: string;
  outboundMessageService: OutboundMessageService;
  entitySelectionService?: EntitySelectionService;
  conversationSoftCloseService?: ConversationSoftCloseService;
  integrationServiceApiKey: string;
  glpiClient?: GlpiClient;
  auditService?: AuditService;
  aiSupervisorService?: AiSupervisorService;
  copilotDraftService?: CopilotDraftService;
  aiPilotService?: AiPilotService;
  aiOperationsService?: AiOperationsService;
  qualityDashboardService?: QualityDashboardService;
  observabilityService?: ObservabilityService;
  contactAgendaImportService?: ContactAgendaImportService;
  manualTicketWhatsappLinkService?: ManualTicketWhatsappLinkService;
  logmeinReadonlyContextService?: LogmeinReadonlyContextService;
  logmeinReconciliationService?: import('./domain/services/LogmeinReconciliationService.js').LogmeinReconciliationService;
  smartHelpService?: SmartHelpService;
  technicalSummarizer?: import('./controllers/ai.controller.js').TechnicalSummarizerPort;
  externalResearchService?: ExternalResearchService;
  coachingService?: CoachingService;
  feedbackService?: FeedbackService;
  cloudAuditRepository?: CloudAuditRepository;
  kbRagCopilotService?: KbRagCopilotService;
  centralHubAggregatorService?: CentralHubAggregatorService;
  // F2B LogMeIn Operations endpoints
  logmeinOperationsDashboardService?: LogmeinOperationsDashboardService;
  logmeinAlarmRepository?: PostgresLogmeinAlarmRepository;
  logmeinRuleTestService?: LogmeinRuleTestService;
  logmeinLowDiskCheckService?: LogmeinLowDiskCheckService;
  logmeinCoverageReportService?: LogmeinCoverageReportService;
  // F4 Alarm Correlation
  logmeinAlarmCorrelationService?: LogmeinAlarmCorrelationService;
  // F5 Controlled Automation
  controlledAutomationService?: ControlledAutomationService;
  // F6 Inventory Reconciliation
  logmeinAssetMatchingService?: LogmeinAssetMatchingService;
  logmeinReadonlyRepository?: import('./repositories/postgres/PostgresLogmeinReadonlyRepository.js').PostgresLogmeinReadonlyRepository;
}

function createJsonParser(options: { limit?: string } = {}) {
  return express.json({
    ...options,
    verify: (req, _res, buf) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  });
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  const defaultJsonParser = createJsonParser();

  app.use((req, res, next) => {
    if (
      req.method === 'POST'
      && (
        req.path === '/internal/glpi/messages/outbound'
        || req.path.startsWith('/internal/glpi/manual-ticket-whatsapp')
        || req.path.startsWith('/internal/glpi/contact-agenda/import')
        || req.path === '/internal/glpi/logmein/sync'
        || req.path === '/internal/glpi/logmein/health'
        || req.path === '/internal/glpi/logmein/reconciliation/sync'
        || req.path.startsWith('/internal/glpi/logmein/reconciliation/queue')
      )
    ) {
      next();
      return;
    }

    defaultJsonParser(req, res, next);
  });
  app.use(pinoHttp({ logger }));

  app.get('/health', healthController);
  app.get('/webhook/meta', createMetaWebhookGetController(dependencies.metaVerifyToken));
  app.post(
    '/webhook/meta',
    createMetaWebhookSignatureMiddleware(dependencies.metaAppSecret),
    createMetaWebhookPostController(dependencies.inboundWebhookService, dependencies.auditService),
  );
  app.post(
    '/webhooks/meta',
    createMetaWebhookSignatureMiddleware(dependencies.metaAppSecret),
    createMetaWebhookPostController(dependencies.inboundWebhookService, dependencies.auditService),
  );
  if (dependencies.entitySelectionService) {
    app.post(
      '/internal/glpi/conversations/:conversation_id/entity',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createConversationEntityController(dependencies.entitySelectionService),
    );
    app.get(
      '/internal/glpi/conversations/:conversation_id/entity',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createConversationEntityStatusController(dependencies.entitySelectionService),
    );
  }
  if (dependencies.conversationSoftCloseService) {
    app.post(
      '/internal/glpi/conversations/:conversation_id/soft-close',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createConversationSoftCloseController(dependencies.conversationSoftCloseService),
    );
  }
  app.get(
    '/internal/glpi/diagnostics',
    createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
    createOpsDiagnosticsController(postgresPool, dependencies.glpiClient),
  );
  if (dependencies.qualityDashboardService) {
    app.get(
      '/internal/glpi/quality-dashboard',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createQualityDashboardController(dependencies.qualityDashboardService),
    );
  }
  if (dependencies.observabilityService) {
    app.get(
      '/internal/glpi/observability',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createObservabilityController(dependencies.observabilityService),
    );
  }
  if (dependencies.contactAgendaImportService) {
    const internalAuth = createInternalBearerMiddleware(dependencies.integrationServiceApiKey);
    app.post(
      '/internal/glpi/contact-agenda/import/preview',
      internalAuth,
      createJsonParser({ limit: CONTACT_AGENDA_IMPORT_JSON_LIMIT }),
      createContactAgendaImportPreviewController(dependencies.contactAgendaImportService),
    );
    app.post(
      '/internal/glpi/contact-agenda/import/:batch_id/confirm',
      internalAuth,
      createJsonParser({ limit: CONTACT_AGENDA_IMPORT_JSON_LIMIT }),
      createContactAgendaImportConfirmController(dependencies.contactAgendaImportService),
    );
    app.get(
      '/internal/glpi/contact-agenda/import/:batch_id',
      internalAuth,
      createContactAgendaImportStatusController(dependencies.contactAgendaImportService),
    );
    app.post(
      '/internal/glpi/contact-agenda/import/:batch_id/rollback',
      internalAuth,
      createJsonParser({ limit: CONTACT_AGENDA_IMPORT_JSON_LIMIT }),
      createContactAgendaImportRollbackController(dependencies.contactAgendaImportService),
    );
  }
  if (dependencies.manualTicketWhatsappLinkService) {
    const internalAuth = createInternalBearerMiddleware(dependencies.integrationServiceApiKey);
    app.post(
      '/internal/glpi/manual-ticket-whatsapp/:ticket_id/resolve',
      internalAuth,
      createJsonParser(),
      createManualTicketWhatsappResolveController(dependencies.manualTicketWhatsappLinkService),
    );
    app.post(
      '/internal/glpi/manual-ticket-whatsapp/:ticket_id/start-template',
      internalAuth,
      createJsonParser(),
      createManualTicketWhatsappStartTemplateController(dependencies.manualTicketWhatsappLinkService),
    );
  }
  if (dependencies.logmeinReadonlyContextService) {
    app.post(
      '/internal/glpi/logmein/sync',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createJsonParser(),
      createLogmeinReadonlySyncController(dependencies.logmeinReadonlyContextService),
    );
    // Health summary endpoint — GET, no body needed.
    app.get(
      '/internal/glpi/logmein/health',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createLogmeinHealthController(dependencies.logmeinReadonlyContextService),
    );
  }
  if (dependencies.logmeinReconciliationService) {
    const internalAuth = createInternalBearerMiddleware(dependencies.integrationServiceApiKey);
    const jsonParser = createJsonParser();
    // POST-only report allowlist: active fetch from LogMeIn reports API.
    app.post(
      '/internal/glpi/logmein/reconciliation/sync',
      internalAuth,
      jsonParser,
      createLogmeinReconciliationSyncController(dependencies.logmeinReconciliationService),
    );
    // Queue management (read + resolve).
    app.get(
      '/internal/glpi/logmein/reconciliation/queue',
      internalAuth,
      createLogmeinReconciliationQueueController(dependencies.logmeinReconciliationService),
    );
    app.post(
      '/internal/glpi/logmein/reconciliation/queue/:id/resolve',
      internalAuth,
      jsonParser,
      createLogmeinReconciliationResolveController(dependencies.logmeinReconciliationService),
    );
  }

  // ── AI/KB ecosystem endpoints (bearer-gated; RBAC + CSRF enforced by the PHP plugin) ──
  {
    const aiAuth = createInternalBearerMiddleware(dependencies.integrationServiceApiKey);
    if (dependencies.smartHelpService) {
      app.post(
        '/internal/glpi/ai/smart-help',
        aiAuth,
        createJsonParser(),
        createSmartHelpController(dependencies.smartHelpService),
      );
    }
    if (dependencies.technicalSummarizer) {
      // LOCAL-AI technical summary — invoked only on the manual "Ajuda Inteligente"
      // click (PHP gates on ai_summary=1). Bearer-gated; local provider only.
      app.post(
        '/internal/glpi/ai/technical-summary',
        aiAuth,
        createJsonParser(),
        createTechnicalSummaryController(dependencies.technicalSummarizer),
      );
    }
    if (dependencies.externalResearchService) {
      app.post(
        '/internal/glpi/ai/external-research/dynamic',
        aiAuth,
        createJsonParser(),
        createExternalResearchDynamicController(dependencies.externalResearchService),
      );
      // Step 1 of the two-step cloud flow: sanitized preview (no cloud call).
      app.post(
        '/internal/glpi/ai/external-research/preview',
        aiAuth,
        createJsonParser(),
        createExternalResearchPreviewController(dependencies.externalResearchService),
      );
    }
    if (dependencies.coachingService) {
      app.get(
        '/internal/glpi/ai/coaching/checklist',
        aiAuth,
        createCoachingChecklistController(dependencies.coachingService),
      );
      app.post(
        '/internal/glpi/ai/coaching/suggest-kb',
        aiAuth,
        createJsonParser(),
        createCoachingSuggestKbController(dependencies.coachingService),
      );
    }
    if (dependencies.feedbackService && dependencies.cloudAuditRepository) {
      app.get(
        '/internal/glpi/ai/metrics/effectiveness',
        aiAuth,
        createAiMetricsController(dependencies.feedbackService, dependencies.cloudAuditRepository),
      );
    }
    // KB RAG Copilot — local-first, technician-only, no cloud, no auto-send
    if (dependencies.kbRagCopilotService) {
      app.post(
        '/internal/glpi/ai/kb-rag',
        aiAuth,
        createJsonParser(),
        createKbRagController(dependencies.kbRagCopilotService),
      );
    }
    // F3 — Central Hub Operacional (read-only aggregator, CENTRAL_HUB_ENABLED=false default)
    if (dependencies.centralHubAggregatorService) {
      app.get(
        '/internal/glpi/central-hub',
        aiAuth,
        createCentralHubController(dependencies.centralHubAggregatorService),
      );
    }
    // F2B — LogMeIn Operations read-only endpoints
    if (
      dependencies.logmeinOperationsDashboardService
      && dependencies.logmeinReadonlyContextService
    ) {
      app.get(
        '/internal/glpi/logmein/operations/dashboard',
        aiAuth,
        createLogmeinOperationsDashboardController({
          dashboardService: dependencies.logmeinOperationsDashboardService,
          contextService: dependencies.logmeinReadonlyContextService,
        }),
      );
    }
    if (dependencies.logmeinAlarmRepository) {
      app.get(
        '/internal/glpi/logmein/operations/alarm-history',
        aiAuth,
        createLogmeinAlarmHistoryController(dependencies.logmeinAlarmRepository),
      );
    }
    if (dependencies.logmeinRuleTestService) {
      app.post(
        '/internal/glpi/logmein/operations/test-rule',
        aiAuth,
        createJsonParser(),
        createLogmeinRuleTestController(dependencies.logmeinRuleTestService),
      );
    }
    if (dependencies.logmeinLowDiskCheckService) {
      app.post(
        '/internal/glpi/logmein/operations/low-disk/dry-run',
        aiAuth,
        createJsonParser(),
        createLogmeinLowDiskDryRunController(dependencies.logmeinLowDiskCheckService),
      );
    }
    if (dependencies.logmeinCoverageReportService) {
      app.get(
        '/internal/glpi/logmein/operations/coverage',
        aiAuth,
        createLogmeinCoverageController(dependencies.logmeinCoverageReportService),
      );
    }
    // F4 — Alarm Correlation (ALARM_CORRELATION_ENABLED=false default)
    if (dependencies.logmeinAlarmCorrelationService) {
      const correlationService = dependencies.logmeinAlarmCorrelationService;
      app.get(
        '/internal/glpi/logmein/operations/correlation',
        aiAuth,
        async (req, res): Promise<void> => {
          try {
            const q = req.query as Record<string, unknown>;
            const windowMinutes = Math.max(1, Math.min(Number(q['window_minutes']) || 60, 10_080));
            const limit = Math.max(1, Math.min(Number(q['limit']) || 20, 100));
            const report = await correlationService.buildReport(windowMinutes, limit);
            res.status(200).json({ ok: true, report });
          } catch (err) {
            res.status(500).json({
              ok: false,
              status: 'correlation_error',
              message: 'Correlação de alarmes indisponível.',
            });
          }
        },
      );
    }
    // F5 — Controlled Automation advisory (CONTROLLED_AUTOMATION_ENABLED=false default)
    if (dependencies.controlledAutomationService && dependencies.auditService) {
      const jsonParser = createJsonParser();
      app.post(
        '/internal/glpi/automation/advisory',
        aiAuth,
        jsonParser,
        createAutomationAdvisoryController(
          dependencies.controlledAutomationService,
          dependencies.auditService,
        ),
      );
      app.get(
        '/internal/glpi/automation/matrix',
        aiAuth,
        createAutomationMatrixController(dependencies.controlledAutomationService),
      );
    }
    // F6 — Inventory Reconciliation (INVENTORY_RECONCILIATION_ENABLED=false default)
    if (dependencies.logmeinAssetMatchingService && dependencies.logmeinReadonlyRepository) {
      const reconciliationDeps = {
        matchingService: dependencies.logmeinAssetMatchingService,
        readonlyRepository: dependencies.logmeinReadonlyRepository,
      };
      app.get(
        '/internal/glpi/logmein/operations/inventory/matching-report',
        aiAuth,
        createReconciliationMatchingReportController(reconciliationDeps),
      );
      app.get(
        '/internal/glpi/logmein/operations/inventory/coverage-gaps',
        aiAuth,
        createReconciliationCoverageGapsController(reconciliationDeps),
      );
      app.post(
        '/internal/glpi/logmein/operations/inventory/preview',
        aiAuth,
        createJsonParser(),
        createReconciliationPreviewController(reconciliationDeps),
      );
    }
    if (dependencies.feedbackService) {
      const feedbackService = dependencies.feedbackService;
      app.post(
        '/internal/glpi/ai/kb-feedback',
        aiAuth,
        createJsonParser(),
        async (req, res): Promise<void> => {
          try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const result = await feedbackService.recordFeedback({
              kbCandidateId: body.kb_candidate_id !== undefined ? Number(body.kb_candidate_id) : null,
              glpiKnowbaseitemId: body.glpi_knowbaseitem_id !== undefined ? Number(body.glpi_knowbaseitem_id) : null,
              glpiTicketId: body.ticket_id !== undefined ? Number(body.ticket_id) : null,
              technicianId: body.technician_id !== undefined ? Number(body.technician_id) : null,
              helpful: body.helpful === true || body.helpful === 'true',
              feedbackText: typeof body.feedback_text === 'string' ? body.feedback_text : null,
            });
            const code = result.ok ? 200 : result.status === 'invalid_target' ? 400 : 500;
            res.status(code).json(result);
          } catch (error: unknown) {
            logger.error(
              { error_message: error instanceof Error ? error.message : String(error) },
              '[ai][kb-feedback]',
            );
            res.status(500).json({ ok: false, status: 'failed', message: 'Feedback indisponível.' });
          }
        },
      );
    }
  }

  app.post(
    '/internal/glpi/messages/outbound',
    createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
    createJsonParser({ limit: OUTBOUND_MEDIA_JSON_LIMIT }),
    createGlpiOutboundMessageController(dependencies.outboundMessageService),
  );
  app.post(
    '/internal/glpi/notifications/ticket-solved',
    createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
    createGlpiTicketSolvedNotificationController(dependencies.outboundMessageService),
  );
  if (dependencies.aiSupervisorService) {
    app.post(
      '/internal/glpi/ai-quality/analyze',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createAiQualityAnalysisController(dependencies.aiSupervisorService),
    );
    app.post(
      '/internal/glpi/ai-quality/feedback',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createAiQualityFeedbackController(dependencies.aiSupervisorService),
    );
  }
  if (dependencies.copilotDraftService) {
    app.post(
      '/internal/glpi/copilot/draft',
      createInternalBearerMiddleware(dependencies.integrationServiceApiKey),
      createCopilotDraftController(dependencies.copilotDraftService),
    );
  }
  if (dependencies.aiPilotService) {
    const internalAuth = createInternalBearerMiddleware(dependencies.integrationServiceApiKey);
    app.get(
      '/internal/glpi/ai-pilot/status',
      internalAuth,
      createAiPilotStatusController(dependencies.aiPilotService),
    );
    app.post(
      '/internal/glpi/ai-pilot/test',
      internalAuth,
      createAiPilotSyntheticTestController(dependencies.aiPilotService),
    );
  }
  if (dependencies.aiOperationsService) {
    const internalAuth = createInternalBearerMiddleware(dependencies.integrationServiceApiKey);
    app.post(
      '/internal/glpi/historical-mining/preview',
      internalAuth,
      createJsonParser({ limit: AI_OPERATIONS_JSON_LIMIT }),
      createHistoricalMiningPreviewController(dependencies.aiOperationsService),
    );
    app.post(
      '/internal/glpi/historical-mining/execute',
      internalAuth,
      createJsonParser({ limit: AI_OPERATIONS_JSON_LIMIT }),
      createHistoricalMiningExecuteController(dependencies.aiOperationsService),
    );
    app.post(
      '/internal/glpi/kb-candidates/generate',
      internalAuth,
      createJsonParser(),
      createKbCandidateGenerateController(dependencies.aiOperationsService),
    );
  }

  return app;
}
