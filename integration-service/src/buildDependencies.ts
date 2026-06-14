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
import { GlpiCategoryClassifierService } from './domain/services/GlpiCategoryClassifierService.js';
import { AssetContextSummaryService } from './domain/services/AssetContextSummaryService.js';
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
import {
  AiOnlineSupervisorAlertService,
  createDefaultAiOnlineSupervisorAlertConfig,
} from './domain/services/AiOnlineSupervisorAlertService.js';
import { RiskScoringService } from './domain/services/RiskScoringService.js';
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
import { PostgresKbFeedbackRepository } from './repositories/postgres/PostgresKbFeedbackRepository.js';
import { PostgresCloudAuditRepository } from './repositories/postgres/PostgresCloudAuditRepository.js';
import { PostgresKbCandidateSearchRepository } from './repositories/postgres/PostgresKbCandidateSearchRepository.js';
import { PostgresRagAuditRepository } from './repositories/postgres/PostgresRagAuditRepository.js';
import type { KbRagCachePort } from './domain/services/KbRagCopilotService.js';
import { FeedbackService } from './domain/services/FeedbackService.js';
import { ExternalResearchService } from './domain/services/ExternalResearchService.js';
import { SmartHelpService } from './domain/services/SmartHelpService.js';
import { KbRagCopilotService } from './domain/services/KbRagCopilotService.js';
import { KbRerankerService } from './domain/services/KbRerankerService.js';
import { KbCustomResponseService } from './domain/services/KbCustomResponseService.js';
import type { KbSearchPort } from './domain/services/SmartHelpService.js';
import { CoachingService } from './domain/services/CoachingService.js';
import { HttpKbSearchPort } from './infra/http/HttpKbSearchPort.js';
import { redisClient } from './cache/redisClient.js';
import { QualityDashboardService } from './services/QualityDashboardService.js';
import { ObservabilityService } from './services/ObservabilityService.js';
import { KbEffectivenessService } from './services/KbEffectivenessService.js';
import { PostgresLogmeinAlarmRepository } from './repositories/postgres/PostgresLogmeinAlarmRepository.js';
import { LogmeinOperationsDashboardService } from './domain/services/LogmeinOperationsDashboardService.js';
import { CentralHubAggregatorService } from './domain/services/CentralHubAggregatorService.js';
import { LogmeinRuleTestService } from './domain/services/LogmeinRuleTestService.js';
import { LogmeinLowDiskCheckService } from './domain/services/LogmeinLowDiskCheckService.js';
import { LogmeinCoverageReportService } from './domain/services/LogmeinCoverageReportService.js';
import { LogmeinAlarmCorrelationService } from './domain/services/LogmeinAlarmCorrelationService.js';
import { ControlledAutomationService } from './domain/services/ControlledAutomationService.js';
import { LogmeinAssetMatchingService } from './domain/services/LogmeinAssetMatchingService.js';
import { LogmeinHardwareInventoryService } from './domain/services/LogmeinHardwareInventoryService.js';
import { LogmeinFieldMappingService } from './domain/services/LogmeinFieldMappingService.js';
import { PostgresLogmeinFieldMappingRepository } from './repositories/postgres/PostgresLogmeinFieldMappingRepository.js';

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

/**
 * Instantiates GlpiCategoryClassifierService for runtime injection.
 *
 * Rules:
 *  - Flag off: returns null — InboundWebhookService uses legacy menu flow, untouched.
 *  - Flag on, local AI configured: classifier with Ollama (heuristic + AI, local only).
 *  - Flag on, no local AI: classifier heuristic-only (localAi=null).
 *  - Cloud AI: NEVER used.
 *  - Boot failure of local AI config: falls back to heuristic-only (never throws).
 *
 * PHASE: integaglpi_ai_category_classification_fix_001
 */
function buildCategoryClassifier(cfg: typeof env): GlpiCategoryClassifierService | null {
  if (!cfg.AI_CATEGORY_CLASSIFICATION_ENABLED) return null;

  const localAiConfig =
    cfg.AI_SUPERVISOR_PROVIDER === 'ollama' &&
    cfg.AI_SUPERVISOR_BASE_URL &&
    cfg.AI_SUPERVISOR_MODEL
      ? {
          baseUrl: cfg.AI_SUPERVISOR_BASE_URL,
          model: cfg.AI_SUPERVISOR_MODEL,
          timeoutMs: Math.min((cfg.AI_SUPERVISOR_TIMEOUT_SECONDS ?? 30) * 1_000, 10_000),
        }
      : null;

  return new GlpiCategoryClassifierService({
    autoThreshold: cfg.AI_CATEGORY_CLASSIFICATION_AUTO_THRESHOLD,
    confirmThreshold: cfg.AI_CATEGORY_CLASSIFICATION_CONFIRM_THRESHOLD,
    localAi: localAiConfig,
  });
}

/**
 * Instantiates the safe asset context summarizer only when enabled.
 * It uses GLPI REST data through GlpiClient and injects an internal private note.
 * No cloud AI and no WhatsApp outbound path are wired here.
 *
 * PHASE: integaglpi_asset_context_summary_001
 */
function buildAssetContextSummaryService(
  cfg: typeof env,
  client: GlpiClient,
  logmeinRepository?: PostgresLogmeinReadonlyRepository,
): AssetContextSummaryService | null {
  if (!cfg.ASSET_CONTEXT_SUMMARY_ENABLED) {
    return null;
  }
  return new AssetContextSummaryService(client, logmeinRepository ?? null);
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
          accountTz: process.env.LOGMEIN_ACCOUNT_TZ ?? 'America/Sao_Paulo',
    // LogMeIn allows 1 API call/min; enforce a minimum 62 s inter-chunk delay.
    // Allow 0 only in test environments (NODE_ENV=test) to keep the test suite fast.
    interChunkDelayMs: envInt('LOGMEIN_RECONCILIATION_INTER_CHUNK_DELAY_MS', 62_000, 62_000, 300_000),
        };
        return new LogmeinReconciliationService(
          config,
          auditService,
          logmeinReconciliationRepository,
          logmeinReconciliationLock,
        );
      })()
    : undefined;

  // ── AI/KB ecosystem services (backed by migration 044) ──────────────────────
  const cloudAuditRepository = new PostgresCloudAuditRepository(postgresPool);
  const kbFeedbackRepository = new PostgresKbFeedbackRepository(postgresPool);
  const feedbackService = new FeedbackService(kbFeedbackRepository, auditService);
  // Cloud provider is NOT wired yet; the EXTERNAL_RESEARCH_CLOUD_ENABLED flag
  // (default false) keeps researchDynamic returning an informative
  // 'provider_unavailable' message instead of a generic failure — while still
  // enforcing human consent + PII sanitization + audit on every call.
  const externalResearchCloudEnabled = envBool('EXTERNAL_RESEARCH_CLOUD_ENABLED', false);
  const externalResearchService = new ExternalResearchService(
    undefined,
    cloudAuditRepository,
    externalResearchCloudEnabled,
  );

  // Native GLPI KB search lives in MariaDB, owned by PHP. When GLPI_KB_SEARCH_URL
  // is configured, Node queries it through the bearer-gated PHP endpoint
  // (front/kb.search.php) via HttpKbSearchPort. Otherwise it falls back to an
  // empty stub — SmartHelp still serves checklist + questions + cloud-offer, and
  // the PHP panel supplies native articles directly. Either way the route mounts.
  const kbSearchUrl = String(process.env.GLPI_KB_SEARCH_URL ?? '').trim();
  const nodeKbSearchPort: KbSearchPort = kbSearchUrl !== ''
    ? new HttpKbSearchPort({
        endpointUrl: kbSearchUrl,
        apiKey: env.INTEGRATION_SERVICE_API_KEY,
        timeoutMs: envInt('GLPI_KB_SEARCH_TIMEOUT_MS', 4_000, 1_000, 15_000),
      })
    : {
        async searchNativeKb(): Promise<[]> {
          return [];
        },
      };
  // feedbackService doubles as the RankingBiasPort (it exposes getRankingBias).
  const smartHelpService = new SmartHelpService(nodeKbSearchPort, feedbackService);

  // LOCAL-AI technical summarizer (Ollama free-text). Used ONLY on the manual
  // "Ajuda Inteligente" click path; never on auto-run (PHP gates on ai_summary=1).
  // Cloud is never used here. The prompt forbids personal data; the PHP side also
  // sanitizes PII before sending the context.
  const technicalSummaryTimeoutMs = envInt('AI_TECHNICAL_SUMMARY_TIMEOUT_MS', 12_000, 1_000, 60_000);
  const technicalSummarizer = {
    async generate(input: { ticketId: number; context: string }): Promise<string> {
      // Use the SAME effective LOCAL provider/model as the working internal Copilot
      // (DB ai_settings -> copilot_model -> COPILOT_DRAFT_MODEL -> AI_SUPERVISOR_MODEL).
      // This avoids provider_unavailable when AI_SUPERVISOR_MODEL (default llama3.1)
      // is not pulled but the Copilot model (e.g. qwen2.5:7b) is. Cloud is never used.
      let model = env.COPILOT_DRAFT_MODEL.trim() !== '' ? env.COPILOT_DRAFT_MODEL.trim() : env.AI_SUPERVISOR_MODEL;
      let timeoutMs = Math.max(technicalSummaryTimeoutMs, copilotTimeoutSeconds * 1000);
      try {
        const runtime = await loadCopilotRuntimeConfig();
        if (runtime && typeof runtime.model === 'string' && runtime.model.trim() !== '') {
          model = runtime.model.trim();
        }
        if (runtime && typeof runtime.timeoutMs === 'number' && runtime.timeoutMs > 0) {
          timeoutMs = Math.max(technicalSummaryTimeoutMs, runtime.timeoutMs);
        }
      } catch {
        // DB settings unavailable: keep the env-derived effective model/timeout above.
      }
      const prompt = [
        'Você é um assistente técnico de suporte de TI.',
        'Reescreva o atendimento abaixo como uma DESCRIÇÃO TÉCNICA do problema, em português,',
        'em no máximo 3 frases, em prosa corrida (sem rótulos, sem listas, sem bullet points).',
        '',
        'REGRAS DE FIDELIDADE (obrigatórias):',
        '- Use SOMENTE fatos explicitamente presentes no texto. NÃO invente causa, sistema, produto,',
        '  banco de dados, GLPI, registro, atualização ou processamento se não estiverem escritos.',
        '- Preserve os termos técnicos exatos citados (ex.: "sync do AD", "Active Directory", mensagem de erro,',
        '  nome do sistema/produto mencionado). Priorize as últimas mensagens do cliente.',
        '- Corrija apenas typos óbvios e seguros (ex.: "esotu" -> "estou", "grace" -> "grave").',
        '- Se faltarem detalhes técnicos, diga explicitamente que faltam dados e liste o que coletar',
        '  (ex.: domínio/usuários/máquinas afetados, mensagem de erro, horário de início, mudanças recentes, logs).',
        '- NÃO inclua dados pessoais: sem nomes próprios, empresa, telefones, e-mails, CPF, CNPJ,',
        '  número do chamado, patrimônio/etiqueta ou endereços.',
        '',
        'Atendimento:',
        input.context,
      ].join('\n');
      return new OllamaClient(env.AI_SUPERVISOR_BASE_URL, model, timeoutMs).generateText(prompt);
    },
  };
  const coachingService = new CoachingService(postgresPool, auditService);

  // ── KB RAG Copilot — local-first, technician-only ──────────────────────────
  // Uses PostgreSQL full-text search over kb_candidates (approved + candidate).
  // Calls local Ollama if available; deterministic fallback always works.
  // Cloud AI is structurally absent: OllamaRagPort has no cloud implementation.
  const kbRagSearchRepo = new PostgresKbCandidateSearchRepository(postgresPool);
  const ragAuditRepo = new PostgresRagAuditRepository(postgresPool);
  const kbRagTimeoutMs = envInt('KB_RAG_TIMEOUT_MS', 8_000, 1_000, 30_000);
  const kbRagModel = (process.env.KB_RAG_MODEL ?? '').trim() ||
    (env.COPILOT_DRAFT_MODEL.trim() !== '' ? env.COPILOT_DRAFT_MODEL.trim() : env.AI_SUPERVISOR_MODEL);
  // OllamaRagPort: only instantiate if a valid Ollama URL is configured.
  // The KbRagCopilotService gracefully falls back to deterministic if ollamaRagPort is null.
  const ollamaBaseUrl = env.AI_SUPERVISOR_BASE_URL.trim();
  const ollamaRagPort = ollamaBaseUrl !== ''
    ? new OllamaClient(ollamaBaseUrl, kbRagModel, kbRagTimeoutMs)
    : null;
  // Redis cache for KB RAG search results (TTL 300s).
  // Cache key = query hash (no PII). Non-blocking: cache failure never affects response.
  const kbRagCache: KbRagCachePort = {
    get: (key: string) => redisClient.get(key),
    set: async (key: string, value: string, ttlSeconds: number): Promise<void> => {
      await redisClient.set(key, value, 'EX', ttlSeconds);
    },
  };
  // F3 — resposta customizada complementar (CUSTOM_RESPONSE_ENABLED=false default;
  // o serviço se auto-gateia e nunca substitui o KB original).
  const kbCustomResponseService = new KbCustomResponseService(ollamaRagPort);
  // F2.3 runtime wiring — reranker local SÓ instanciado com RERANKER_ENABLED=true
  // e Ollama configurado. null → caminho legado intacto (nunca no caminho crítico).
  const kbRerankerService = env.RERANKER_ENABLED && ollamaBaseUrl !== ''
    ? new KbRerankerService(null, kbRagModel, ollamaBaseUrl)
    : null;
  const kbRagCopilotService = new KbRagCopilotService(
    kbRagSearchRepo,
    ollamaRagPort,
    ragAuditRepo,
    kbRagCache,
    undefined,
    undefined,
    undefined,
    kbCustomResponseService,
    // F2.2 runtime wiring — bias agregado não-punitivo; o serviço só o consulta
    // com FEEDBACK_RANKING_ENABLED=true (flag off → ranking idêntico ao legado).
    feedbackService,
    kbRerankerService,
  );

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
  // ── F3 Central Hub services (read-only aggregators) ──────────────────────────
  const kbEffectivenessService = new KbEffectivenessService(postgresPool, kbFeedbackRepository);
  const logmeinAlarmRepository = new PostgresLogmeinAlarmRepository(postgresPool);
  const logmeinOperationsDashboardService = new LogmeinOperationsDashboardService(logmeinAlarmRepository);
  const centralHubAggregatorService = new CentralHubAggregatorService({
    pool: postgresPool,
    kbEffectivenessService,
    logmeinContextService: logmeinReadonlyContextService,
    logmeinDashboardService: logmeinOperationsDashboardService,
    alarmRepository: logmeinAlarmRepository,
  });
  // ── F2B LogMeIn Operations + F4 Correlation + F5 Automation ─────────────────
  const logmeinRuleTestService = new LogmeinRuleTestService();
  const logmeinLowDiskCheckService = new LogmeinLowDiskCheckService();
  const logmeinCoverageReportService = new LogmeinCoverageReportService(logmeinReadonlyRepository);
  const logmeinAlarmCorrelationService = new LogmeinAlarmCorrelationService(logmeinAlarmRepository);
  const controlledAutomationService = new ControlledAutomationService();
  const logmeinAssetMatchingService = new LogmeinAssetMatchingService();
  const logmeinFieldMappingRepository = new PostgresLogmeinFieldMappingRepository(postgresPool);
  const logmeinFieldMappingService = new LogmeinFieldMappingService(logmeinFieldMappingRepository);
  const logmeinHardwareInventoryService = new LogmeinHardwareInventoryService(
    {
      enabled: env.LOGMEIN_HARDWARE_INVENTORY_ENABLED,
      baseUrl: process.env.LOGMEIN_API_BASE_URL,
      companyId: process.env.LOGMEIN_COMPANY_ID,
      psk: process.env.LOGMEIN_PSK,
      timeoutMs: envInt('LOGMEIN_TIMEOUT_MS', envInt('LOGMEIN_HTTP_TIMEOUT_MS', 5_000, 1_000, 30_000), 1_000, 30_000),
    },
    logmeinFieldMappingService,
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
  // Near-real-time supervisory alert pipeline: the periodic worker scans all
  // conversations every 60-120s; this same service is also nudged on each inbound
  // message so explicit risk signals (frustration / supervisor request) surface
  // immediately. Shares all dedup/cooldown/rate-limit/PII-sanitization with the worker.
  const aiOnlineAlertRedisFacade = {
    get: (key: string) => redisClient.get(key),
    set: (key: string, value: string, mode?: string, ttlSeconds?: number) => {
      if (mode === 'EX' && typeof ttlSeconds === 'number') {
        return redisClient.set(key, value, 'EX', ttlSeconds);
      }
      return redisClient.set(key, value);
    },
    incr: (key: string) => redisClient.incr(key),
    expire: (key: string, seconds: number) => redisClient.expire(key, seconds),
  };
  const aiOnlineSupervisorAlertService = new AiOnlineSupervisorAlertService(
    postgresPool,
    aiOnlineAlertRedisFacade,
    new RedisKeyLock(120_000, 0, 0),
    new RiskScoringService(),
    aiOnlineAlertSupervisorService,
    auditService,
    createDefaultAiOnlineSupervisorAlertConfig(),
  );
  const aiOnlineAlertInboundTrigger = {
    onInboundConversationActivity: (conversationId: string): void => {
      // Fire-and-forget, deterministic-only (no Ollama) so the webhook is never blocked.
      void aiOnlineSupervisorAlertService
        .evaluateConversationById(conversationId, { deterministicOnly: true })
        .catch(() => undefined);
    },
  };

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
    aiOnlineAlertInboundTrigger,
    // AI category classifier — only instantiated when flag is on.
    // Uses heuristic-only when AI_SUPERVISOR_PROVIDER=disabled (safe default).
    // Never uses cloud AI. Failure never blocks webhook (classifier is optional param).
    // PHASE: integaglpi_ai_category_classification_fix_001
    buildCategoryClassifier(env),
    // Asset context summary — feature-flagged, internal-note only.
    // PHASE: integaglpi_asset_context_summary_001
    buildAssetContextSummaryService(env, glpiClient, logmeinReadonlyRepository),
    logmeinReadonlyRepository,
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
    feedbackService,
    externalResearchService,
    cloudAuditRepository,
    smartHelpService,
    technicalSummarizer,
    coachingService,
    kbRagCopilotService,
    centralHubAggregatorService,
    logmeinOperationsDashboardService,
    logmeinAlarmRepository,
    logmeinRuleTestService,
    logmeinLowDiskCheckService,
    logmeinCoverageReportService,
    logmeinAlarmCorrelationService,
    controlledAutomationService,
    // F5 wiring fix: app.ts gates /automation/* on auditService being present.
    auditService,
    logmeinAssetMatchingService,
    logmeinHardwareInventoryService,
    logmeinReadonlyRepository,
    integrationServiceApiKey: env.INTEGRATION_SERVICE_API_KEY,
    glpiClient,
    metaClient,
    metaAppSecret: env.META_APP_SECRET,
    metaVerifyToken: env.META_VERIFY_TOKEN,
  };
}
