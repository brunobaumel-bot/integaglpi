import 'dotenv/config';

import { z } from 'zod';

const envSource = {
  ...process.env,
  PORT: process.env.PORT ?? process.env.INTEGRATION_SERVICE_PORT ?? '3001',
  INTEGRATION_SERVICE_API_KEY:
    process.env.INTEGRATION_SERVICE_API_KEY ??
    (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
      ? 'test-integration-service-api-key-32chars-min'
      : ''),
  OUTBOUND_SEND_MODE: process.env.OUTBOUND_SEND_MODE ?? 'mock',
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  GLPI_API_BASE_URL: z.string().url(),
  GLPI_APP_TOKEN: z.string().min(1),
  GLPI_USER_TOKEN: z.string().min(1),
  GLPI_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  GLPI_HTTP_RETRY_COUNT: z.coerce.number().int().min(0).default(1),
  GLPI_TICKET_CREATE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_PHONE_NUMBER_ID: z.string().min(1),
  ALLOWED_META_PHONE_NUMBER_IDS: z.string().default(''),
  ALLOWED_META_DISPLAY_PHONE_NUMBERS: z.string().default(''),
  ALLOWED_META_PHONE_ID: z.string().default(''),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive(),
  CONTACT_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_SSL: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  INTEGRATION_SERVICE_API_KEY: z
    .string()
    .min(32, 'INTEGRATION_SERVICE_API_KEY must be at least 32 characters (use a strong random secret).'),
  OUTBOUND_SEND_MODE: z.enum(['mock', 'real']).default('mock'),
  META_MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(15_728_640),
  INACTIVITY_AUTOCLOSE_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  INACTIVITY_REMINDER_MINUTES: z.string().default('15,20,25'),
  INACTIVITY_AUTOCLOSE_MINUTES: z.coerce.number().int().positive().default(30),
  INACTIVITY_JOB_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  AI_SUPERVISOR_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_SUPERVISOR_PROVIDER: z.enum(['disabled', 'ollama']).default('disabled'),
  AI_SUPERVISOR_MODEL: z.string().min(1).default('llama3.1'),
  AI_SUPERVISOR_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  AI_SUPERVISOR_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  AI_SUPERVISOR_MAX_MESSAGES: z.coerce.number().int().positive().default(30),
  AI_SUPERVISOR_MAX_CHARS: z.coerce.number().int().positive().default(12_000),
  AI_SUPERVISOR_DRY_RUN: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((value) => value === 'true'),
  COPILOT_DRAFT_MODEL: z.string().default(''),
  COPILOT_TIMEOUT_SECONDS: z.coerce.number().int().min(0).default(0),
  AI_ONLINE_ALERT_MODEL: z.string().default(''),
  AI_ONLINE_ALERT_TIMEOUT_SECONDS: z.coerce.number().int().min(0).default(0),
  AI_ONLINE_ALERT_WORKER_LOOP: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_ONLINE_ALERT_WORKER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  AI_PILOT_CLOUD_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PILOT_EMBEDDINGS_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PILOT_PROVIDER: z.enum(['disabled', 'local', 'cloud']).default('disabled'),
  AI_PILOT_MODEL: z.string().min(1).default('pilot-disabled'),
  AI_PILOT_MONTHLY_BUDGET_LIMIT: z.coerce.number().min(0).default(0),
  AI_PILOT_HARD_BUDGET_BLOCK: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((value) => value === 'true'),
  AI_PILOT_DPO_APPROVED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PILOT_DIRECTOR_APPROVED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PILOT_ADMIN_OPT_IN: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PILOT_INCIDENT_ACK: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  AI_PILOT_TEST_ENVIRONMENT_ONLY: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((value) => value === 'true'),
  AI_PILOT_ENVIRONMENT: z.enum(['test', 'homologation', 'production']).default('test'),
  AI_PILOT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(45),
  AI_PILOT_RETRY_COUNT: z.coerce.number().int().min(0).max(1).default(1),
  NATIVE_GLPI_TRIAGE_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Enables LogMeIn Hardware Inventory enrichment (default false).
   * When true, the service fetches CPU/RAM/disk/MAC/OS/serial/model from
   * GET /public-api/v1/inventory/hardware/reports. Rate limit respected.
   */
  LOGMEIN_HARDWARE_INVENTORY_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  /** When true the network_connections[].ip_address is included in hardware sync payloads. Default false (IP = sensitive). */
  LOGMEIN_SYNC_LOCAL_IP: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Fontes de triagem nativa do GLPI usadas quando NATIVE_GLPI_TRIAGE_ENABLED=true.
   *   itilcategory (default) — apenas ITILCategory via REST API do GLPI.
   *   form                   — apenas Forms nativos via endpoint PHP form.catalog.php.
   *   both                   — mescla categorias + forms (máximo 10 opções, A-Z).
   * PHASE: integaglpi_v8_forms_native_triage_integration_001
   */
  NATIVE_GLPI_TRIAGE_SOURCES: z
    .enum(['itilcategory', 'form', 'both'])
    .default('itilcategory'),
  /**
   * Habilita classificação assistida de categoria GLPI.
   * Quando true e NATIVE_GLPI_TRIAGE_ENABLED=true:
   *   - Usuário descreve o problema em linguagem natural.
   *   - Heurística local (+ IA local opcional) sugere uma categoria.
   *   - confidence >= AI_CATEGORY_CLASSIFICATION_AUTO_THRESHOLD: aplica automaticamente.
   *   - AI_CATEGORY_CLASSIFICATION_CONFIRM_THRESHOLD <= confidence < auto: pede confirmação.
   *   - confidence < AI_CATEGORY_CLASSIFICATION_CONFIRM_THRESHOLD: exibe menu manual numerado.
   * Quando false, fluxo anterior (menu manual) permanece intacto.
   * PHASE: integaglpi_ai_category_classification_001
   */
  AI_CATEGORY_CLASSIFICATION_ENABLED: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
  /** confidence mínima para aplicar categoria automaticamente (default 0.85). */
  AI_CATEGORY_CLASSIFICATION_AUTO_THRESHOLD: z
    .string()
    .default('0.85')
    .transform((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.85;
    }),
  /** confidence mínima para pedir confirmação (abaixo = menu manual) (default 0.55). */
  AI_CATEGORY_CLASSIFICATION_CONFIRM_THRESHOLD: z
    .string()
    .default('0.55')
    .transform((v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.55;
    }),
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(envSource);
