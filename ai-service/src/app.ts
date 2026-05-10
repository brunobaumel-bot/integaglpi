import express from 'express';
import { pinoHttp } from 'pino-http';

import { createAiController } from './controllers/AiController.js';
import { healthController } from './controllers/healthController.js';
import { logger } from './infra/logger.js';
import { createAiAnalysisService } from './services/createAiAnalysisService.js';

export function createApp() {
  const app = express();
  const aiController = createAiController(createAiAnalysisService());

  app.use(express.json());
  app.use(pinoHttp({ logger }));

  app.get('/health', healthController);
  app.post('/analyze', aiController.analyzeMessage);
  app.post('/analyze/message', aiController.analyzeMessage);

  return app;
}
