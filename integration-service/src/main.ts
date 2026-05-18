import { createServer } from 'node:http';

import { createApp } from './app.js';
import { buildDependencies } from './buildDependencies.js';
import { env } from './config/env.js';
import { ensureRedisConnection } from './cache/redisClient.js';
import { checkDatabaseConnection, ensureDatabaseSchema } from './infra/db/postgres.js';
import { logger } from './infra/logger/logger.js';

async function bootstrap(): Promise<void> {
  await ensureRedisConnection();
  await checkDatabaseConnection();
  // Run before opening the HTTP port so the service never accepts webhooks without its own tables and indexes.
  await ensureDatabaseSchema();

  const dependencies = buildDependencies();
  dependencies.inactivityAutomationService.start();
  const app = createApp(dependencies);
  const server = createServer(app);

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'Integration service started.');
  });
}

bootstrap().catch((error: unknown) => {
  logger.error({ error }, 'Failed to bootstrap integration service.');
  process.exit(1);
});
