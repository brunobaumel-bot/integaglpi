import { ContactCacheRepository } from './cache/ContactCacheRepository.js';
import { RedisKeyLock } from './cache/RedisKeyLock.js';
import { LogmeinRedisSyncLock } from './cache/LogmeinRedisSyncLock.js';
import { LogmeinReconciliationService } from './domain/services/LogmeinReconciliationService.js';
import { PostgresLogmeinReconciliationRepository } from './repositories/postgres/PostgresLogmeinReconciliationRepository.js';
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
import { LogmeinReadonlyContextService } from './domain/services/LogmeinReadonlyContextService.js';
import { EntitySelectionService } from './domain/services/EntitySelectionService.js';
import { ConversationSoftCloseService } from './domain/services/ConversationSoftCloseService.js';
import { AiSupervisorService, type AiSupervisorConfig } from './domain/services/AiSupervisorService.js';
import { CopilotDraftService, type CopilotDraftRuntimeConfig } from './domain/services/CopilotDraftService.js';
import { AiPilotService } from './domain/services/AiPilotService.js';
import { AiOperationsService } from './domain/services/AiOperationsService.js';
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
import { PostgresLogmeinReadonlyRepository } from './repositories/postgres/PostgresLogmeinReadonlyRepository.js';
import { redisClient } from './cache/redisClient.js';
import { QualityDashboardService } from './services/QualityDashboardService.js';
import { ObservabilityService } from './services/ObservabilityService.js';

const AI_SETTINGS_KEYS = [
  'ai_supervisor_enabled',
  'ai_supervisor_provider',
  'ai_supervisor_model',
  'ai_supervisor_timeout_seconds',
  'ai_supervisor_max_messages',
  'ai_supervisor_max_chars',
  'ai_supervisor_dry_run',
  'copilot_enabled',
  'copilot_provider',
  'copilot_model',
  'copilot_dry_run',
  'copilot_timeout_ms',
  'copilot_max_context_messages',
  'copilot_max_context_chars',
] as const;

function settingText(settings: Map<string, unknown>, key: string): string {
  const value = settings.get(key);
  return value === undefined || value === null ? '' : String(value).trim();
}

function settingBool(settings: Map<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settingText(settings, key).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }
  return fallback;
}

function settingInt(settings: Map<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(settingText(settings, key));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function settingProvider(settings: Map<string, unknown>, key: string, fallback: 'disabled' | 'ollama'): 'disabled' | 'ollama' {
  const value = settingText(settings, key).toLowerCase();
  if (value === 'ollama' || value === 'local') {
    return 'ollama';
  }
  if (value === 'disabled') {
    return 'disabled';
  }
  return fallback;
}

function settingModel(settings: Map<string, unknown>, key: string, fallback: string): string {
  const value = settingText(settings, key).replace(/[^A-Za-z0-9_.:/-]+/g, '').slice(0, 120);
  return value !== '' ? value : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }
  return fallback;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(String(process.env[name] ?? '').trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function hasDbAiSettings(settings: Map<string, unknown>): boolean {
  return [...settings.keys()].some((key) => key !== 'updated_at');
}

async function loadAiSettingsFromDatabase(): Promise<Map<string, unknown>> {
  const columnsResult = await postgresPool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = ANY($2::text[])
    `,
    ['glpi_plugin_integaglpi_configs', ['context', 'updated_at', ...AI_SETTINGS_KEYS]],
  );
  const columns = columnsResult.rows.map((row) => row.column_name);
  if (!columns.includes('context')) {
    return new Map();
  }

  const projectionColumns = columns.filter((column) => column !== 'context');
  if (projectionColumns.length === 0) {
    return new Map();
  }

  const result = await postgresPool.query<Record<string, unknown>>(
    `
      SELECT ${projectionColumns.map((column) => `"${column}"`).join(', ')}
      FROM glpi_plugin_integaglpi_configs
      WHERE context = 'ai_settings'
      LIMIT 1
    `,
  );
  const row = result.rows[0] ?? {};
  const settings = new Map<string, unknown>();
  for (const key of projectionColumns) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      settings.set(key, value);
    }
  }

  return settings;
}

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
  const logmeinReadonlyRepository = new PostgresLogmeinReadonlyRepository(postgresPool);
  const qualityDashboardService = new QualityDashboardService(postgresPool, redisClient);
  const observabilityService = new ObservabilityService(postgresPool, redisClient, glpiClient);
  const aiOperationsService = new AiOperationsService(postgresPool);
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
  const logmeinSyncLock = new LogmeinRedisSyncLock(
    // TTL covers worst-case large sync; auto-expires if process dies.
    envInt('LOGMEIN_SYNC_LOCK_TTL_MS', 5 * 60 * 1_000, 30_000, 30 * 60 * 1_000),
  );
  const logmeinReconciliationLock = new LogmeinRedisSyncLock(
    // Reconciliation lock: longer TTL — report API + matching can take up to 10 min.
    envInt('LOGMEIN_RECONCILIATION_LOCK_TTL_MS', 10 * 60 * 1_000, 60_000, 30 * 60 * 1_000),
  );
  const logmeinReconciliationRepository = new PostgresLogmeinReconciliationRepository(postgresPool);
  const logmeinReconciliationService = envBool('LOGMEIN_RECONCILIATION_ENABLED', false)
    ? (() => {
        const lookbackHoursRaw = String(process.env.LOGMEIN_RECONCILIATION_LOOKBACK_HOURS ?? '').trim();
        const config = {
          enabled: true,
          reconciliationEnabled: true,
          baseUrl: process.env.LOGMEIN_API_BASE_URL,
          companyId: process.env.LOGMEIN_COMPANY_ID,
          psk: process.env.LOGMEIN_PSK,
          timeoutMs: envInt('LOGMEIN_TIMEOUT_MS', envInt('LOGMEIN_HTTP_TIMEOUT_MS', 15_000, 1_000, 60_000), 1_000, 60_000),
          lookbackDays: envInt('LOGMEIN_RECONCILIATION_LOOKBACK_DAYS', 7, 1, 90),
          lookbackHours: lookbackHoursRaw !== ''
            ? envInt('LOGMEIN_RECONCILIATION_LOOKBACK_HOURS', 7 * 24, 1, 2_160)
            : undefined,
          chunkMinutes: envInt('LOGMEIN_RECONCILIATION_CHUNK_MINUTES', 120, 5, 120),
          overlapMinutes: envInt('LOGMEIN_RECONCILIATION_OVERLAP_MINUTES', 10, 0, 119),
          maxRetries: envInt('LOGMEIN_RECONCILIATION_MAX_RETRIES', 2, 0, 3),
          circuitCooldownSeconds: envInt('LOGMEIN_RECONCILIATION_CIRCUIT_COOLDOWN_SECONDS', 900, 60, 3_600),
        };
        return new LogmeinReconciliationService(
          config,
          auditService,
          logmeinReconciliationRepository,
          logmeinReconciliationLock,
        );
      })()
    : undefined;
  const logmeinReadonlyContextService = new LogmeinReadonlyContextService(
    {
      enabled: envBool('LOGMEIN_INTEGRATION_ENABLED', false),
      baseUrl: process.env.LOGMEIN_API_BASE_URL,
      companyId: process.env.LOGMEIN_COMPANY_ID,
      psk: process.env.LOGMEIN_PSK,
      timeoutMs: envInt('LOGMEIN_TIMEOUT_MS', envInt('LOGMEIN_HTTP_TIMEOUT_MS', 5_000, 1_000, 30_000), 1_000, 30_000),
    },
    auditService,
    logmeinReadonlyRepository,
    logmeinSyncLock,
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
  const copilotDraftModel = env.COPILOT_DRAFT_MODEL.trim() !== ''
    ? env.COPILOT_DRAFT_MODEL.trim()
    : env.AI_SUPERVISOR_MODEL;
  const copilotTimeoutSeconds = env.COPILOT_TIMEOUT_SECONDS > 0
    ? env.COPILOT_TIMEOUT_SECONDS
    : env.AI_SUPERVISOR_TIMEOUT_SECONDS;
  const aiOnlineAlertModel = env.AI_ONLINE_ALERT_MODEL.trim() !== ''
    ? env.AI_ONLINE_ALERT_MODEL.trim()
    : env.AI_SUPERVISOR_MODEL;
  const aiOnlineAlertTimeoutSeconds = env.AI_ONLINE_ALERT_TIMEOUT_SECONDS > 0
    ? env.AI_ONLINE_ALERT_TIMEOUT_SECONDS
    : env.AI_SUPERVISOR_TIMEOUT_SECONDS;
  const aiSupervisorProvider = {
    analyze: async (prompt: string, runtimeConfig: { model?: string; timeoutMs?: number } = {}) => {
      const model = typeof runtimeConfig.model === 'string' && runtimeConfig.model.trim() !== ''
        ? runtimeConfig.model.trim()
        : env.AI_SUPERVISOR_MODEL;
      const timeoutMs = typeof runtimeConfig.timeoutMs === 'number' && Number.isFinite(runtimeConfig.timeoutMs) && runtimeConfig.timeoutMs > 0
        ? runtimeConfig.timeoutMs
        : env.AI_SUPERVISOR_TIMEOUT_SECONDS * 1000;
      return new OllamaClient(env.AI_SUPERVISOR_BASE_URL, model, timeoutMs).analyze(prompt);
    },
  };
  const aiOnlineAlertProvider = {
    analyze: async (prompt: string, runtimeConfig: { model?: string; timeoutMs?: number } = {}) => {
      const model = typeof runtimeConfig.model === 'string' && runtimeConfig.model.trim() !== ''
        ? runtimeConfig.model.trim()
        : aiOnlineAlertModel;
      const timeoutMs = typeof runtimeConfig.timeoutMs === 'number' && Number.isFinite(runtimeConfig.timeoutMs) && runtimeConfig.timeoutMs > 0
        ? runtimeConfig.timeoutMs
        : aiOnlineAlertTimeoutSeconds * 1000;
      return new OllamaClient(env.AI_SUPERVISOR_BASE_URL, model, timeoutMs).analyze(prompt);
    },
  };
  const loadAiSupervisorRuntimeConfig = async (): Promise<Partial<AiSupervisorConfig> | undefined> => {
    const settings = await loadAiSettingsFromDatabase();
    if (!hasDbAiSettings(settings)) {
      return undefined;
    }

    return {
      enabled: settingBool(settings, 'ai_supervisor_enabled', env.AI_SUPERVISOR_ENABLED),
      provider: settingProvider(settings, 'ai_supervisor_provider', env.AI_SUPERVISOR_PROVIDER),
      model: settingModel(settings, 'ai_supervisor_model', env.AI_SUPERVISOR_MODEL),
      maxMessages: settingInt(settings, 'ai_supervisor_max_messages', env.AI_SUPERVISOR_MAX_MESSAGES, 1, 30),
      maxChars: settingInt(settings, 'ai_supervisor_max_chars', env.AI_SUPERVISOR_MAX_CHARS, 500, 12_000),
      dryRun: settingBool(settings, 'ai_supervisor_dry_run', env.AI_SUPERVISOR_DRY_RUN),
      timeoutMs: settingInt(settings, 'ai_supervisor_timeout_seconds', env.AI_SUPERVISOR_TIMEOUT_SECONDS, 15, 180) * 1000,
      source: 'db_ai_settings',
    };
  };
  const loadCopilotRuntimeConfig = async (): Promise<CopilotDraftRuntimeConfig | undefined> => {
    const settings = await loadAiSettingsFromDatabase();
    if (!hasDbAiSettings(settings)) {
      return undefined;
    }

    const supervisorProvider = settingProvider(settings, 'ai_supervisor_provider', env.AI_SUPERVISOR_PROVIDER);
    const supervisorModel = settingModel(settings, 'ai_supervisor_model', env.AI_SUPERVISOR_MODEL);
    const envCopilotModel = env.COPILOT_DRAFT_MODEL.trim() !== '' ? env.COPILOT_DRAFT_MODEL.trim() : supervisorModel;
    const supervisorTimeoutMs = settingInt(settings, 'ai_supervisor_timeout_seconds', env.AI_SUPERVISOR_TIMEOUT_SECONDS, 15, 180) * 1000;
    const envCopilotTimeoutMs = env.COPILOT_TIMEOUT_SECONDS > 0 ? env.COPILOT_TIMEOUT_SECONDS * 1000 : supervisorTimeoutMs;

    return {
      enabled: settingBool(settings, 'copilot_enabled', settingBool(settings, 'ai_supervisor_enabled', env.AI_SUPERVISOR_ENABLED)),
      provider: settingProvider(settings, 'copilot_provider', supervisorProvider),
      model: settingModel(settings, 'copilot_model', envCopilotModel),
      dryRun: settingBool(settings, 'copilot_dry_run', settingBool(settings, 'ai_supervisor_dry_run', env.AI_SUPERVISOR_DRY_RUN)),
      maxChars: settingInt(settings, 'copilot_max_context_chars', env.AI_SUPERVISOR_MAX_CHARS, 1_000, 12_000),
      timeoutMs: settingInt(settings, 'copilot_timeout_ms', envCopilotTimeoutMs, 15_000, 120_000),
      source: 'db_ai_settings',
    };
  };
  const loadAiOnlineAlertRuntimeConfig = async (): Promise<Partial<AiSupervisorConfig> | undefined> => {
    const settings = await loadAiSettingsFromDatabase();
    const base = await loadAiSupervisorRuntimeConfig();
    if (base === undefined && !hasDbAiSettings(settings) && env.AI_ONLINE_ALERT_MODEL.trim() === '' && env.AI_ONLINE_ALERT_TIMEOUT_SECONDS <= 0) {
      return undefined;
    }

    const fallbackModel = typeof base?.model === 'string' && base.model.trim() !== '' ? base.model : env.AI_SUPERVISOR_MODEL;
    const fallbackTimeoutMs = typeof base?.timeoutMs === 'number' && base.timeoutMs > 0
      ? base.timeoutMs
      : env.AI_SUPERVISOR_TIMEOUT_SECONDS * 1000;

    return {
      enabled: typeof base?.enabled === 'boolean' ? base.enabled : env.AI_SUPERVISOR_ENABLED,
      provider: base?.provider ?? env.AI_SUPERVISOR_PROVIDER,
      model: env.AI_ONLINE_ALERT_MODEL.trim() !== '' ? env.AI_ONLINE_ALERT_MODEL.trim() : fallbackModel,
      maxMessages: base?.maxMessages ?? env.AI_SUPERVISOR_MAX_MESSAGES,
      maxChars: base?.maxChars ?? env.AI_SUPERVISOR_MAX_CHARS,
      dryRun: typeof base?.dryRun === 'boolean' ? base.dryRun : env.AI_SUPERVISOR_DRY_RUN,
      timeoutMs: env.AI_ONLINE_ALERT_TIMEOUT_SECONDS > 0
        ? env.AI_ONLINE_ALERT_TIMEOUT_SECONDS * 1000
        : fallbackTimeoutMs,
      source: env.AI_ONLINE_ALERT_MODEL.trim() !== '' || env.AI_ONLINE_ALERT_TIMEOUT_SECONDS > 0
        ? 'env_function_override'
        : 'db_ai_settings',
    };
  };
  const aiSupervisorService = new AiSupervisorService(
    aiQualityAnalysisRepository,
    aiSupervisorProvider,
    {
      enabled: env.AI_SUPERVISOR_ENABLED,
      provider: env.AI_SUPERVISOR_PROVIDER,
      model: env.AI_SUPERVISOR_MODEL,
      maxMessages: env.AI_SUPERVISOR_MAX_MESSAGES,
      maxChars: env.AI_SUPERVISOR_MAX_CHARS,
      dryRun: env.AI_SUPERVISOR_DRY_RUN,
      timeoutMs: env.AI_SUPERVISOR_TIMEOUT_SECONDS * 1000,
      source: 'env',
    },
    auditService,
    loadAiSupervisorRuntimeConfig,
  );
  const aiOnlineAlertSupervisorService = new AiSupervisorService(
    aiQualityAnalysisRepository,
    aiOnlineAlertProvider,
    {
      enabled: env.AI_SUPERVISOR_ENABLED,
      provider: env.AI_SUPERVISOR_PROVIDER,
      model: aiOnlineAlertModel,
      maxMessages: env.AI_SUPERVISOR_MAX_MESSAGES,
      maxChars: env.AI_SUPERVISOR_MAX_CHARS,
      dryRun: env.AI_SUPERVISOR_DRY_RUN,
      timeoutMs: aiOnlineAlertTimeoutSeconds * 1000,
      source: env.AI_ONLINE_ALERT_MODEL.trim() !== '' || env.AI_ONLINE_ALERT_TIMEOUT_SECONDS > 0 ? 'env_function_override' : 'env',
    },
    auditService,
    loadAiOnlineAlertRuntimeConfig,
  );
  const copilotDraftProvider = new OllamaCopilotProvider(
    env.AI_SUPERVISOR_BASE_URL,
    copilotDraftModel,
    copilotTimeoutSeconds * 1000,
  );
  const copilotDraftService = new CopilotDraftService(
    copilotDraftProvider,
    {
      enabled: env.AI_SUPERVISOR_ENABLED,
      provider: env.AI_SUPERVISOR_PROVIDER,
      model: copilotDraftModel,
      dryRun: env.AI_SUPERVISOR_DRY_RUN,
      maxChars: env.AI_SUPERVISOR_MAX_CHARS,
    },
    auditService,
    loadCopilotRuntimeConfig,
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
      directorApproved: env.AI_PILOT_DIRECTOR_APPROVED,
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
    aiOnlineAlertSupervisorService,
    copilotDraftService,
    aiPilotService,
    aiOperationsService,
    qualityDashboardService,
    observabilityService,
    contactAgendaImportService,
    manualTicketWhatsappLinkService,
    logmeinReadonlyContextService,
    logmeinReconciliationService,
    integrationServiceApiKey: env.INTEGRATION_SERVICE_API_KEY,
    glpiClient,
    metaClient,
    metaAppSecret: env.META_APP_SECRET,
    metaVerifyToken: env.META_VERIFY_TOKEN,
  };
}
