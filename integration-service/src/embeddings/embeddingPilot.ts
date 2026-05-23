import { createHash } from 'node:crypto';

import type { SqlExecutor } from '../infra/db/postgres.js';
import { anonymizeAiPilotPayload } from '../privacy/anonymizeForAiPilot.js';

export interface EmbeddingPilotInput {
  sourceType: 'native_kb' | 'kb_candidate' | 'historical_insight' | 'synthetic';
  sourceId: string;
  sourceVersion: string;
  content: string;
  model: string;
  provider: string;
  enabled: boolean;
}

export function deterministicSyntheticVector(text: string): number[] {
  const digest = createHash('sha256').update(text).digest();
  return Array.from(digest.subarray(0, 8)).map((byte) => Number((byte / 255).toFixed(6)));
}

export async function indexSanitizedEmbedding(executor: SqlExecutor, input: EmbeddingPilotInput): Promise<{
  indexed: boolean;
  blockedReason: string | null;
  sanitizedPayloadHash: string;
}> {
  const sanitized = anonymizeAiPilotPayload(input.content);
  if (!input.enabled) {
    return {
      indexed: false,
      blockedReason: 'AI_PILOT_EMBEDDINGS_DISABLED',
      sanitizedPayloadHash: sanitized.anonymizedPayloadHash,
    };
  }
  if (sanitized.blocked) {
    return {
      indexed: false,
      blockedReason: sanitized.blockedReason,
      sanitizedPayloadHash: sanitized.anonymizedPayloadHash,
    };
  }

  const vector = deterministicSyntheticVector(sanitized.text);
  await executor.query(
    `
      INSERT INTO public.glpi_plugin_integaglpi_ai_pilot_embeddings (
        source_type,
        source_id_hash,
        source_version,
        content_hash,
        embedding_model,
        embedding_provider,
        sanitized_payload_hash,
        vector_json,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      ON CONFLICT (source_type, source_id_hash, source_version, content_hash) DO NOTHING
    `,
    [
      input.sourceType,
      createHash('sha256').update(input.sourceId).digest('hex'),
      input.sourceVersion,
      sanitized.originalHash,
      input.model,
      input.provider,
      sanitized.anonymizedPayloadHash,
      JSON.stringify(vector),
    ],
  );

  return {
    indexed: true,
    blockedReason: null,
    sanitizedPayloadHash: sanitized.anonymizedPayloadHash,
  };
}
