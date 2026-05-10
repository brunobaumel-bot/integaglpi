import express from 'express';
import { pinoHttp } from 'pino-http';

import type { InboundWebhookService } from './domain/services/InboundWebhookService.js';
import type { OutboundMessageService } from './domain/services/OutboundMessageService.js';
import type { AuditService } from './domain/services/AuditService.js';
import { healthController } from './controllers/healthController.js';
import { createGlpiOutboundMessageController } from './controllers/createGlpiOutboundMessageController.js';
import { createGlpiTicketSolvedNotificationController } from './controllers/createGlpiTicketSolvedNotificationController.js';
import { createMetaWebhookGetController } from './controllers/createMetaWebhookGetController.js';
import { createMetaWebhookPostController } from './controllers/createMetaWebhookPostController.js';
import { logger } from './infra/logger/logger.js';
import { createInternalApiKeyMiddleware } from './middleware/createInternalApiKeyMiddleware.js';
import { createMetaWebhookSignatureMiddleware } from './middleware/createMetaWebhookSignatureMiddleware.js';

export interface AppDependencies {
  inboundWebhookService: InboundWebhookService;
  metaAppSecret: string;
  metaVerifyToken: string;
  outboundMessageService: OutboundMessageService;
  integrationServiceApiKey: string;
  auditService?: AuditService;
}

export function createApp(dependencies: AppDependencies) {
  const app = express();

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
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
  app.post(
    '/internal/glpi/messages/outbound',
    createInternalApiKeyMiddleware(dependencies.integrationServiceApiKey),
    createGlpiOutboundMessageController(dependencies.outboundMessageService),
  );
  app.post(
    '/internal/glpi/notifications/ticket-solved',
    createInternalApiKeyMiddleware(dependencies.integrationServiceApiKey),
    createGlpiTicketSolvedNotificationController(dependencies.outboundMessageService),
  );

  return app;
}
