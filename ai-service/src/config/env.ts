import 'dotenv/config';

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  AI_ENABLED: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (typeof value === 'boolean') {
        return value;
      }

      if (typeof value === 'string') {
        return value.trim().toLowerCase() !== 'false';
      }

      return true;
    }),
  /** Trimmed; empty falls back to `mock` (Fase 2 PoC default). */
  AI_PROVIDER: z
    .string()
    .default('mock')
    .transform((value) => value.trim() || 'mock'),
});

export const env = envSchema.parse(process.env);
