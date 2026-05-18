import express from 'express';
import { pinoHttp } from 'pino-http';

import type { InboundWebhookService } from './domain/services/InboundWebhookService.js';
import type { OutboundMessageService } from './domain/services/OutboundMessageService.js';
import type { EntitySelectionService } from './domain/services/EntitySelectionService.js';
import type { AuditService } from './domain/services/AuditService.js';
import type { AiSupervisorService } from './domain/services/AiSupervisorService.js';
import type { GlpiClient } from './adapters/glpi/GlpiClient.js';
import type { QualityDashboardService } from './services/QualityDashboardService.js';
import { createOpsDiagnosticsController, healthController } from './controllers/healthController.js';
import { createAiQualityAnalysisController } from './controllers/createAiQualityAnalysisController.js';
import { createAiQualityFeedbackController } from './controllers/createAiQualityFeedbackController.js';
import { createQualityDashboardController } from './controllers/createQualityDashboardController.js';
import { createGlpiOutboundMessageController } from './controllers/createGlpiOutboundMessageController.js';
import { createGlpiTicketSolvedNotificationController } from './controllers/createGlpiTicketSolvedNotificationController.js';
import {
  createConversationEntityController,
  createConversationEntityStatusController,
} from './controllers/createConversationEntityController.js';
import { createMetaWebhookGetController } from './controllers/createMetaWebhookGetController.js';
import { createMetaWebhookPostController } from './controllers/createMetaWebhookPostController.js';
import { logger } from './infra/logger/logger.js';
import { createInternalBearerMiddleware } from './middleware/createInternalBearerMiddleware.js';
import { createMetaWebhookSignatureMiddleware } from './middleware/createMetaWebhookSignatureMiddleware.js';
import { postgresPool } from './infra/db/postgres.js';

const OUTBOUND_MEDIA_JSON_LIMIT = '30mb';

export interface AppDependencies {
  inboundWebhookService: InboundWebhookService;
  metaAppSecret: string;
  metaVerifyToken: string;
  outboundMessageService: OutboundMessageService;
  entitySelectionService?: EntitySelectionService;
  integrationServiceApiKey: string;
  glpiClient?: GlpiClient;
  auditService?: AuditService;
  aiSupervisorService?: AiSupervisorService;
  qualityDashboardService?: QualityDashboardService;
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
    if (req.method === 'POST' && req.path === '/internal/glpi/messages/outbound') {
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

  return app;
}
