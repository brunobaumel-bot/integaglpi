import { describe, expect, it, vi } from 'vitest';

import { deterministicSyntheticVector, indexSanitizedEmbedding } from '../src/embeddings/embeddingPilot.js';

function createExecutor() {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })),
  };
}

describe('embedding pilot', () => {
  it('is disabled by default and does not persist', async () => {
    const executor = createExecutor();
    const result = await indexSanitizedEmbedding(executor, {
      sourceType: 'synthetic',
      sourceId: 'demo',
      sourceVersion: 'v1',
      content: 'payload sintetico',
      model: 'pilot-disabled',
      provider: 'disabled',
      enabled: false,
    });

    expect(result.indexed).toBe(false);
    expect(result.blockedReason).toBe('AI_PILOT_EMBEDDINGS_DISABLED');
    expect(executor.query).not.toHaveBeenCalled();
  });

  it('rejects unsanitized sensitive payloads before indexing', async () => {
    const executor = createExecutor();
    const result = await indexSanitizedEmbedding(executor, {
      sourceType: 'synthetic',
      sourceId: 'demo',
      sourceVersion: 'v1',
      content: 'senha=secret token=abc123456789',
      model: 'pilot',
      provider: 'local',
      enabled: true,
    });

    expect(result.indexed).toBe(false);
    expect(result.blockedReason).toBe('AI_PILOT_PAYLOAD_BLOCKED_PII_OR_SECRET');
    expect(executor.query).not.toHaveBeenCalled();
  });

  it('stores only hashed source metadata and vector_json for sanitized content', async () => {
    const executor = createExecutor();
    const result = await indexSanitizedEmbedding(executor, {
      sourceType: 'synthetic',
      sourceId: 'demo-id',
      sourceVersion: 'v1',
      content: 'conteudo sintetico sem dados reais',
      model: 'pilot',
      provider: 'local',
      enabled: true,
    });

    expect(result.indexed).toBe(true);
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining('glpi_plugin_integaglpi_ai_pilot_embeddings'), expect.arrayContaining([
      'synthetic',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'v1',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'pilot',
      'local',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(String),
    ]));
    expect(deterministicSyntheticVector('abc')).toHaveLength(8);
  });
});
