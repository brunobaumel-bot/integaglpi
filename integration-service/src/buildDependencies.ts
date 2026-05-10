import { ContactCacheRepository } from './cache/ContactCacheRepository.js';
import { RedisKeyLock } from './cache/RedisKeyLock.js';
import { MetaClient } from './adapters/meta/MetaClient.js';
import { env } from './config/env.js';
import { GlpiClient } from './adapters/glpi/GlpiClient.js';
import { ContactResolutionService } from './domain/services/ContactResolutionService.js';
import { InboundWebhookService } from './domain/services/InboundWebhookService.js';
import { MediaProcessingService } from './domain/services/MediaProcessingService.js';
import { OutboundMessageService } from './domain/services/OutboundMessageService.js';
import { AuditService } from './domain/services/AuditService.js';
import { OperationalIntegrityAuditService } from './domain/services/OperationalIntegrityAuditService.js';
import { ScheduleService } from './domain/services/ScheduleService.js';
import { SettingsService } from './domain/services/SettingsService.js';
import { postgresPool } from './infra/db/postgres.js';
import { ResilientHttpClient } from './infra/http/ResilientHttpClient.js';
import { PostgresContactRepository } from './repositories/postgres/PostgresContactRepository.js';
import { PostgresConversationRepository } from './repositories/postgres/PostgresConversationRepository.js';
import { PostgresMessageRepository } from './repositories/postgres/PostgresMessageRepository.js';
import { PostgresWebhookEventRepository } from './repositories/postgres/PostgresWebhookEventRepository.js';
import { PostgresRoutingRepository } from './repositories/postgres/PostgresRoutingRepository.js';
import { PostgresSettingsRepository } from './repositories/postgres/PostgresSettingsRepository.js';
import { PostgresSolutionActionRepository } from './repositories/postgres/PostgresSolutionActionRepository.js';
import { PostgresAuditEventRepository } from './repositories/postgres/PostgresAuditEventRepository.js';

export function buildDependencies() {
  const httpClient = new ResilientHttpClient();
  const glpiClient = new GlpiClient(env.GLPI_API_BASE_URL, httpClient);
  const metaClient = new MetaClient(httpClient);
  const contactCacheRepository = new ContactCacheRepository();
  const keyLock = new RedisKeyLock();
  const contactRepository = new PostgresContactRepository(postgresPool);
  const conversationRepository = new PostgresConversationRepository(postgresPool);
  const messageRepository = new PostgresMessageRepository(postgresPool);
  const webhookEventRepository = new PostgresWebhookEventRepository(postgresPool);
  const routingRepository = new PostgresRoutingRepository(postgresPool);
  const settingsRepository = new PostgresSettingsRepository(postgresPool);
  const solutionActionRepository = new PostgresSolutionActionRepository(postgresPool);
  const auditEventRepository = new PostgresAuditEventRepository(postgresPool);
  const auditService = new AuditService(auditEventRepository);
  const operationalIntegrityAuditService = new OperationalIntegrityAuditService(postgresPool, auditService);
  const settingsService = new SettingsService(settingsRepository);
  const scheduleService = new ScheduleService(settingsRepository);
  const contactResolutionService = new ContactResolutionService(
    contactCacheRepository,
    contactRepository,
    glpiClient,
  );
  const mediaProcessingService = new MediaProcessingService(
    metaClient,
    glpiClient,
    env.META_MEDIA_MAX_BYTES,
  );
  const inboundWebhookService = new InboundWebhookService(
    webhookEventRepository,
    messageRepository,
    conversationRepository,
    contactResolutionService,
    glpiClient,
    keyLock,
    routingRepository,
    settingsService,
    scheduleService,
    metaClient,
    mediaProcessingService,
    solutionActionRepository,
    auditService,
  );
  const outboundMessageService = new OutboundMessageService(
    conversationRepository,
    messageRepository,
    metaClient,
    env.OUTBOUND_SEND_MODE,
    env.META_PHONE_NUMBER_ID,
    auditService,
  );

  return {
    inboundWebhookService,
    outboundMessageService,
    operationalIntegrityAuditService,
    integrationServiceApiKey: env.INTEGRATION_SERVICE_API_KEY,
    metaClient,
    metaAppSecret: env.META_APP_SECRET,
    metaVerifyToken: env.META_VERIFY_TOKEN,
  };
}
