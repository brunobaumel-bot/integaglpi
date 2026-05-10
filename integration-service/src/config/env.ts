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
  META_APP_SECRET: z.string().min(1),
  META_VERIFY_TOKEN: z.string().min(1),
  META_ACCESS_TOKEN: z.string().min(1),
  META_PHONE_NUMBER_ID: z.string().min(1),
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
});

export type AppEnv = z.infer<typeof envSchema>;

export const env = envSchema.parse(envSource);
