import { ContactCacheRepository } from './cache/ContactCacheRepository.js';
import { RedisKeyLock } from './cache/RedisKeyLock.js';
import { MetaClient } from './adapters/meta/MetaClient.js';
import { OllamaClient } from './ai/OllamaClient.js';
import { env } from './config/env.js';
import { GlpiClient } from './adapters/glpi/GlpiClient.js';
import { ContactResolutionService } from './domain/services/ContactResolutionService.js';
import { InboundWebhookService } from './domain/services/InboundWebhookService.js';
import { MediaProcessingService } from './domain/services/MediaProcessingService.js';
import { OutboundMessageService } from './domain/services/OutboundMessageService.js';
import { InactivityAutomationService, parseReminderMinutes } from './domain/services/InactivityAutomationService.js';
import { AuditService } from './domain/services/AuditService.js';
import { OperationalIntegrityAuditService } from './domain/services/OperationalIntegrityAuditService.js';
import { ScheduleService } from './domain/services/ScheduleService.js';
import { SettingsService } from './domain/services/SettingsService.js';
import { MessageConfigurationService } from './domain/services/MessageConfigurationService.js';
import { BusinessHoursService } from './domain/services/BusinessHoursService.js';
import { ContactEntityResolutionService } from './domain/services/ContactEntityResolutionService.js';
import { ContactProfileService } from './domain/services/ContactProfileService.js';
import { CustomerExperienceService } from './domain/services/CustomerExperienceService.js';
import { ContactAgendaImportService } from './domain/services/ContactAgendaImportService.js';
import { ManualTicketWhatsappLinkService } from './domain/services/ManualTicketWhatsappLinkService.js';
import { EntitySelectionService } from './domain/services/EntitySelectionService.js';
import { ConversationSoftCloseService } from './domain/services/ConversationSoftCloseService.js';
import { AiSupervisorService } from './domain/services/AiSupervisorService.js';
import { CopilotDraftService } from './domain/services/CopilotDraftService.js';
import { AiPilotService } from './domain/services/AiPilotService.js';
import { OllamaCopilotProvider } from './copilot/OllamaCopilotProvider.js';
import { AiPilotBudgetGuard } from './aiPilot/budgetGuard.js';
import { AiPilotRepository } from './aiPilot/repository.js';
import { createPilotProvider } from './cloud/providerRegistry.js';
import { postgresPool } from './infra/db/postgres.js';
import { ResilientHttpClient } from './infra/http/ResilientHttpClient.js';
import { PostgresContactEntityMemoryRepository } from './repositories/postgres/PostgresContactEntityMemoryRepository.js';
import { PostgresContactProfileRepository } from './repositories/postgres/PostgresContactProfileRepository.js';
import { PostgresContactAgendaImportRepository } from './repositories/postgres/PostgresContactAgendaImportRepository.js';
import { PostgresManualTicketWhatsappRepository } from './repositories/postgres/PostgresManualTicketWhatsappRepository.js';
import { PostgresContactRepository } from './repositories/postgres/PostgresContactRepository.js';
import { PostgresConversationRepository } from './repositories/postgres/PostgresConversationRepository.js';
import { PostgresMessageRepository } from './repositories/postgres/PostgresMessageRepository.js';
import { PostgresInactivityTrackingRepository } from './repositories/postgres/PostgresInactivityTrackingRepository.js';
import { PostgresWebhookEventRepository } from './repositories/postgres/PostgresWebhookEventRepository.js';
import { PostgresRoutingRepository } from './repositories/postgres/PostgresRoutingRepository.js';
import { PostgresSettingsRepository } from './repositories/postgres/PostgresSettingsRepository.js';
import { PostgresSolutionActionRepository } from './repositories/postgres/PostgresSolutionActionRepository.js';
import { PostgresAuditEventRepository } from './repositories/postgres/PostgresAuditEventRepository.js';
import { PostgresAiQualityAnalysisRepository } from './repositories/postgres/PostgresAiQualityAnalysisRepository.js';
import { PostgresMessageFlowRepository } from './repositories/postgres/PostgresMessageFlowRepository.js';
import { redisClient } from './cache/redisClient.js';
import { QualityDashboardService } from './services/QualityDashboardService.js';
import { ObservabilityService } from './services/ObservabilityService.js';

export function buildDependencies() {
  const httpClient = new ResilientHttpClient();
  const glpiClient = new GlpiClient(env.GLPI_API_BASE_URL, httpClient);
  const metaClient = new MetaClient(httpClient);
  const contactCacheRepository = new ContactCacheRepository();
  const keyLock = new RedisKeyLock();
  const contactRepository = new PostgresContactRepository(postgresPool);
  const conversationRepository = new PostgresConversationRepository(postgresPool);
  const messageRepository = new PostgresMessageRepository(postgresPool);
  const inactivityTrackingRepository = new PostgresInactivityTrackingRepository(postgresPool);
  const webhookEventRepository = new PostgresWebhookEventRepository(postgresPool);
  const routingRepository = new PostgresRoutingRepository(postgresPool);
  const settingsRepository = new PostgresSettingsRepository(postgresPool);
  const contactEntityMemoryRepository = new PostgresContactEntityMemoryRepository(postgresPool);
  const contactProfileRepository = new PostgresContactProfileRepository(postgresPool);
  const contactAgendaImportRepository = new PostgresContactAgendaImportRepository(postgresPool);
  const manualTicketWhatsappRepository = new PostgresManualTicketWhatsappRepository(postgresPool);
  const solutionActionRepository = new PostgresSolutionActionRepository(postgresPool);
  const auditEventRepository = new PostgresAuditEventRepository(postgresPool);
  const aiQualityAnalysisRepository = new PostgresAiQualityAnalysisRepository(postgresPool);
  const aiPilotRepository = new AiPilotRepository(postgresPool);
  const messageFlowRepository = new PostgresMessageFlowRepository(postgresPool);
  const qualityDashboardService = new QualityDashboardService(postgresPool, redisClient);
  const observabilityService = new ObservabilityService(postgresPool, redisClient, glpiClient);
  const auditService = new AuditService(auditEventRepository);
  const contactAgendaImportService = new ContactAgendaImportService(
    contactAgendaImportRepository,
    auditService,
    keyLock,
  );
  const operationalIntegrityAuditService = new OperationalIntegrityAuditService(postgresPool, auditService);
  const settingsService = new SettingsService(settingsRepository);
  const messageConfigurationService = new MessageConfigurationService(messageFlowRepository);
  const businessHoursService = new BusinessHoursService(messageFlowRepository);
  const contactEntityResolutionService = new ContactEntityResolutionService(settingsRepository);
  const contactProfileService = new ContactProfileService(settingsRepository, contactProfileRepository);
  const customerExperienceService = new CustomerExperienceService(glpiClient, contactProfileService);
  const outboundMessageService = new OutboundMessageService(
    conversationRepository,
    messageRepository,
    metaClient,
    env.OUTBOUND_SEND_MODE,
    env.META_PHONE_NUMBER_ID,
    auditService,
    inactivityTrackingRepository,
    messageConfigurationService,
  );
  const manualTicketWhatsappLinkService = new ManualTicketWhatsappLinkService(
    manualTicketWhatsappRepository,
    outboundMessageService,
    keyLock,
    auditService,
  );
  const inactivityAutomationService = new InactivityAutomationService(
    inactivityTrackingRepository,
    outboundMessageService,
    glpiClient,
    auditService,
    {
      enabled: env.INACTIVITY_AUTOCLOSE_ENABLED,
      reminderMinutes: parseReminderMinutes(env.INACTIVITY_REMINDER_MINUTES),
      autocloseMinutes: env.INACTIVITY_AUTOCLOSE_MINUTES,
      jobIntervalSeconds: env.INACTIVITY_JOB_INTERVAL_SECONDS,
    },
    undefined,
    messageConfigurationService,
    async () => settingsService.getInactivityRuntimeConfig(),
  );
  const entitySelectionService = new EntitySelectionService(
    conversationRepository,
    messageRepository,
    routingRepository,
    glpiClient,
    contactEntityMemoryRepository,
    outboundMessageService,
    customerExperienceService,
    {
      ticketCreateTimeoutMs: env.GLPI_TICKET_CREATE_TIMEOUT_MS,
      messageConfigurationService,
    },
  );
  const conversationSoftCloseService = new ConversationSoftCloseService(
    conversationRepository,
    keyLock,
    auditService,
  );
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
    auditService,
  );
  const ollamaClient = new OllamaClient(
    env.AI_SUPERVISOR_BASE_URL,
    env.AI_SUPERVISOR_MODEL,
    env.AI_SUPERVISOR_TIMEOUT_SECONDS * 1000,
  );
  const aiSupervisorService = new AiSupervisorService(
    aiQualityAnalysisRepository,
    ollamaClient,
    {
      enabled: env.AI_SUPERVISOR_ENABLED,
      provider: env.AI_SUPERVISOR_PROVIDER,
      model: env.AI_SUPERVISOR_MODEL,
      maxMessages: env.AI_SUPERVISOR_MAX_MESSAGES,
      maxChars: env.AI_SUPERVISOR_MAX_CHARS,
      dryRun: env.AI_SUPERVISOR_DRY_RUN,
    },
    auditService,
  );
  const copilotDraftProvider = new OllamaCopilotProvider(
    env.AI_SUPERVISOR_BASE_URL,
    env.AI_SUPERVISOR_MODEL,
    env.AI_SUPERVISOR_TIMEOUT_SECONDS * 1000,
  );
  const copilotDraftService = new CopilotDraftService(
    copilotDraftProvider,
    {
      enabled: env.AI_SUPERVISOR_ENABLED,
      provider: env.AI_SUPERVISOR_PROVIDER,
      model: env.AI_SUPERVISOR_MODEL,
      dryRun: env.AI_SUPERVISOR_DRY_RUN,
      maxChars: env.AI_SUPERVISOR_MAX_CHARS,
    },
    auditService,
  );
  const aiPilotService = new AiPilotService(
    {
      cloudEnabled: env.AI_PILOT_CLOUD_ENABLED,
      embeddingsEnabled: env.AI_PILOT_EMBEDDINGS_ENABLED,
      provider: env.AI_PILOT_PROVIDER,
      model: env.AI_PILOT_MODEL,
      monthlyBudgetLimit: env.AI_PILOT_MONTHLY_BUDGET_LIMIT,
      hardBudgetBlock: env.AI_PILOT_HARD_BUDGET_BLOCK,
      dpoApproved: env.AI_PILOT_DPO_APPROVED,
      adminOptIn: env.AI_PILOT_ADMIN_OPT_IN,
      incidentAck: env.AI_PILOT_INCIDENT_ACK,
      testEnvironmentOnly: env.AI_PILOT_TEST_ENVIRONMENT_ONLY,
      environment: env.AI_PILOT_ENVIRONMENT,
      timeoutMs: env.AI_PILOT_TIMEOUT_SECONDS * 1000,
      retryCount: env.AI_PILOT_RETRY_COUNT,
    },
    createPilotProvider(env.AI_PILOT_PROVIDER),
    new AiPilotBudgetGuard(postgresPool, env.AI_PILOT_MONTHLY_BUDGET_LIMIT, env.AI_PILOT_HARD_BUDGET_BLOCK),
    aiPilotRepository,
    auditService,
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
    contactEntityResolutionService,
    contactEntityMemoryRepository,
    contactProfileService,
    customerExperienceService,
    messageConfigurationService,
    businessHoursService,
  );
  return {
    inboundWebhookService,
    outboundMessageService,
    entitySelectionService,
    conversationSoftCloseService,
    operationalIntegrityAuditService,
    inactivityAutomationService,
    aiSupervisorService,
    copilotDraftService,
    aiPilotService,
    qualityDashboardService,
    observabilityService,
    contactAgendaImportService,
    manualTicketWhatsappLinkService,
    integrationServiceApiKey: env.INTEGRATION_SERVICE_API_KEY,
    glpiClient,
    metaClient,
    metaAppSecret: env.META_APP_SECRET,
    metaVerifyToken: env.META_VERIFY_TOKEN,
  };
}
