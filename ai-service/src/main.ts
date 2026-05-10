import { createServer } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { isMockModeEnabled } from './services/createAiAnalysisService.js';

// Fase 2 PoC: sem OpenAI/Ollama — mock determinístico (ver MockAiAnalysisService).
if (isMockModeEnabled()) {
  logger.info(
    { aiEnabled: env.AI_ENABLED, aiProvider: env.AI_PROVIDER },
    '[PoC Mode] Ignorando provider de IA e retornando resposta mock',
  );
}

const app = createApp();

try {
  createServer(app).listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'AI service started.');
  });
} catch (error: unknown) {
  logger.error({ error }, 'Failed to bootstrap AI service.');
  process.exit(1);
}
