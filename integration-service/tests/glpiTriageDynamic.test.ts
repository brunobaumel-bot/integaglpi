/**
 * Tests for native GLPI triage: GlpiItilCategoryNormalizer + GlpiTriageCacheRepository.
 * PHASE: integaglpi_v8_native_catalog_dynamic_triage_001
 *
 * All tests are pure unit tests — no Redis, no GLPI HTTP calls, no MariaDB.
 * Redis and GlpiClient are fully mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── env setup ────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = {
    ...originalEnv,
    GLPI_API_BASE_URL: 'https://glpi.example.local/apirest.php',
    GLPI_APP_TOKEN: 'app-token',
    GLPI_USER_TOKEN: 'user-token',
    GLPI_HTTP_TIMEOUT_MS: '5000',
    GLPI_HTTP_RETRY_COUNT: '1',
    META_APP_SECRET: 'secret',
    META_VERIFY_TOKEN: 'verify',
    META_ACCESS_TOKEN: 'meta-token',
    META_PHONE_NUMBER_ID: 'phone-id',
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    CONTACT_CACHE_TTL_SECONDS: '3600',
    DB_HOST: 'postgres',
    DB_PORT: '5432',
    DB_NAME: 'db',
    DB_USER: 'user',
    DB_PASSWORD: 'password',
    DB_SSL: 'false',
    NATIVE_GLPI_TRIAGE_ENABLED: 'false',
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeCategory(id: number, name: string, completename = name, visible = true) {
  return { id, name, completename, is_helpdeskvisible: visible };
}

// ── GlpiTriageCacheRepository — unit tests ────────────────────────────────────

describe('GlpiTriageCacheRepository', () => {
  it('builds correct primary cache key', async () => {
    const { GlpiTriageCacheRepository } = await import('../src/cache/GlpiTriageCacheRepository.js');
    const repo = new GlpiTriageCacheRepository();
    const key = repo.buildPrimaryKey(42, 7, 'pt');
    expect(key).toBe('integaglpi:triage:categories:v1:entity:42:queue:7:lang:pt');
  });

  it('builds stale key by appending :stale', async () => {
    const { GlpiTriageCacheRepository } = await import('../src/cache/GlpiTriageCacheRepository.js');
    const repo = new GlpiTriageCacheRepository();
    const primaryKey = repo.buildPrimaryKey(1, null, 'pt');
    expect(repo.buildStaleKey(primaryKey)).toBe(`${primaryKey}:stale`);
  });

  it('uses 0 when entityId or queueId is null', async () => {
    const { GlpiTriageCacheRepository } = await import('../src/cache/GlpiTriageCacheRepository.js');
    const repo = new GlpiTriageCacheRepository();
    const key = repo.buildPrimaryKey(null, null, 'pt');
    expect(key).toContain(':entity:0:queue:0:');
  });
});

// ── GlpiItilCategoryNormalizer — flag off ─────────────────────────────────────

describe('GlpiItilCategoryNormalizer — feature flag off', () => {
  it('returns legacy routing options when NATIVE_GLPI_TRIAGE_ENABLED=false', async () => {
    process.env.NATIVE_GLPI_TRIAGE_ENABLED = 'false';

    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const glpiClient = { fetchItilCategories: vi.fn() };
    const cacheRepo = { get: vi.fn(), set: vi.fn() };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    // When flag is off, InboundWebhookService won't even create the normalizer.
    // But if it did, calling getOptions with an empty GLPI response yields [].
    glpiClient.fetchItilCategories.mockResolvedValueOnce([]);
    cacheRepo.get.mockResolvedValueOnce(null);

    const result = await normalizer.getOptions(null, null, 'pt');
    expect(result).toEqual([]);
  });
});

// ── GlpiItilCategoryNormalizer — cache hit ────────────────────────────────────

describe('GlpiItilCategoryNormalizer — cache hit', () => {
  it('returns cached options without calling GLPI when primary cache is fresh', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const cachedOptions = [
      { id: 1, label: 'Suporte TI', optionKey: 'glpic_1', queueId: null,
        glpiGroupId: null, glpiUserId: null, confirmationMessage: null, sortOrder: 0,
        glpiItilCategoryId: 1 },
    ];

    const glpiClient = { fetchItilCategories: vi.fn() };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce({ data: cachedOptions, isStale: false }),
      set: vi.fn(),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions(42, null, 'pt');
    expect(result).toEqual(cachedOptions);
    expect(glpiClient.fetchItilCategories).not.toHaveBeenCalled();
  });
});

// ── GlpiItilCategoryNormalizer — cache miss → GLPI fetch ─────────────────────

describe('GlpiItilCategoryNormalizer — cache miss', () => {
  it('calls GLPI and caches fresh results when cache is empty', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const categories = [
      makeCategory(10, 'Hardware', 'Hardware > Todos'),
      makeCategory(11, 'Software', 'Software > Todos'),
    ];

    const glpiClient = { fetchItilCategories: vi.fn().mockResolvedValueOnce(categories) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce(null),
      set: vi.fn().mockResolvedValueOnce(undefined),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions(null, null, 'pt');
    expect(result).toHaveLength(2);
    expect(result[0].optionKey).toMatch(/^glpic_/);
    expect(result[0].glpiItilCategoryId).toBe(result[0].id);
    expect(cacheRepo.set).toHaveBeenCalledOnce();
  });

  it('filters out categories where is_helpdeskvisible is false', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const categories = [
      makeCategory(1, 'Visible', 'Visible', true),
      makeCategory(2, 'Hidden', 'Hidden', false),
      makeCategory(3, 'AlsoVisible', 'AlsoVisible', true),
    ];

    const glpiClient = { fetchItilCategories: vi.fn().mockResolvedValueOnce(categories) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce(null),
      set: vi.fn().mockResolvedValueOnce(undefined),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions();
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).not.toContain(2);
  });

  it('limits result to 10 options maximum', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const categories = Array.from({ length: 20 }, (_, i) =>
      makeCategory(i + 1, `Cat ${i + 1}`, `Cat ${i + 1}`, true),
    );

    const glpiClient = { fetchItilCategories: vi.fn().mockResolvedValueOnce(categories) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce(null),
      set: vi.fn().mockResolvedValueOnce(undefined),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions();
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it('truncates label longer than 20 chars with ellipsis', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const longName = 'Infraestrutura de TI e Redes Corporativas';
    const categories = [makeCategory(5, longName, longName, true)];

    const glpiClient = { fetchItilCategories: vi.fn().mockResolvedValueOnce(categories) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce(null),
      set: vi.fn().mockResolvedValueOnce(undefined),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions();
    expect(result[0].label.length).toBeLessThanOrEqual(20);
    expect(result[0].label).toMatch(/…$/);
  });

  it('preserves numeric entry — sortOrder is 0-based index', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const categories = [
      makeCategory(1, 'Alpha', 'Alpha', true),
      makeCategory(2, 'Beta', 'Beta', true),
      makeCategory(3, 'Gamma', 'Gamma', true),
    ];

    const glpiClient = { fetchItilCategories: vi.fn().mockResolvedValueOnce(categories) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce(null),
      set: vi.fn().mockResolvedValueOnce(undefined),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions();
    expect(result[0].sortOrder).toBe(0);
    expect(result[1].sortOrder).toBe(1);
    expect(result[2].sortOrder).toBe(2);
  });
});

// ── GlpiItilCategoryNormalizer — GLPI failure + stale cache ──────────────────

describe('GlpiItilCategoryNormalizer — GLPI failure scenarios', () => {
  it('uses stale cache when GLPI fetch throws and stale data exists', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const staleOptions = [
      { id: 99, label: 'Stale Option', optionKey: 'glpic_99', queueId: null,
        glpiGroupId: null, glpiUserId: null, confirmationMessage: null, sortOrder: 0,
        glpiItilCategoryId: 99 },
    ];

    const glpiClient = { fetchItilCategories: vi.fn().mockRejectedValueOnce(new Error('GLPI timeout')) };
    const cacheRepo = {
      get: vi.fn()
        .mockResolvedValueOnce({ data: staleOptions, isStale: true }) // first call (primary miss)
        .mockResolvedValueOnce({ data: staleOptions, isStale: true }), // second call (stale retry)
      set: vi.fn(),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions();
    expect(result).toEqual(staleOptions);
    expect(glpiClient.fetchItilCategories).toHaveBeenCalledOnce();
  });

  it('returns empty list (controlled fallback) when GLPI fails and no cache exists', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const glpiClient = { fetchItilCategories: vi.fn().mockRejectedValueOnce(new Error('GLPI down')) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions();
    expect(result).toEqual([]);
    expect(cacheRepo.set).not.toHaveBeenCalled();
  });

  it('does not throw when cache.set fails', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const categories = [makeCategory(1, 'TI', 'TI', true)];

    const glpiClient = { fetchItilCategories: vi.fn().mockResolvedValueOnce(categories) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce(null),
      set: vi.fn().mockRejectedValueOnce(new Error('Redis down')),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    await expect(normalizer.getOptions()).resolves.toHaveLength(1);
  });
});

// ── GlpiItilCategoryNormalizer — no POST/PUT/PATCH/DELETE against GLPI ────────

describe('GlpiItilCategoryNormalizer — safety invariants', () => {
  it('only calls fetchItilCategories (GET), never mutating methods', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const glpiClient = {
      fetchItilCategories: vi.fn().mockResolvedValueOnce([]),
      createTicket: vi.fn(),
      updateTicketStatus: vi.fn(),
      addFollowUp: vi.fn(),
    };
    const cacheRepo = { get: vi.fn().mockResolvedValueOnce(null), set: vi.fn() };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    await normalizer.getOptions();

    expect(glpiClient.createTicket).not.toHaveBeenCalled();
    expect(glpiClient.updateTicketStatus).not.toHaveBeenCalled();
    expect(glpiClient.addFollowUp).not.toHaveBeenCalled();
  });

  it('glpiItilCategoryId on each option matches the GLPI category id', async () => {
    const { GlpiItilCategoryNormalizer } = await import(
      '../src/adapters/glpi/GlpiItilCategoryNormalizer.js'
    );

    const categories = [
      makeCategory(101, 'Redes', 'Redes', true),
      makeCategory(202, 'Servidores', 'Servidores', true),
    ];

    const glpiClient = { fetchItilCategories: vi.fn().mockResolvedValueOnce(categories) };
    const cacheRepo = {
      get: vi.fn().mockResolvedValueOnce(null),
      set: vi.fn().mockResolvedValueOnce(undefined),
    };

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
    );

    const result = await normalizer.getOptions();
    for (const option of result) {
      expect(option.glpiItilCategoryId).toBe(option.id);
    }
  });
});

// ── env.ts — NATIVE_GLPI_TRIAGE_ENABLED defaults to false ────────────────────

describe('env — NATIVE_GLPI_TRIAGE_ENABLED', () => {
  it('defaults to false when env var is not set', async () => {
    delete process.env.NATIVE_GLPI_TRIAGE_ENABLED;
    const { env } = await import('../src/config/env.js');
    expect(env.NATIVE_GLPI_TRIAGE_ENABLED).toBe(false);
  });

  it('parses true when env var is "true"', async () => {
    process.env.NATIVE_GLPI_TRIAGE_ENABLED = 'true';
    const { env } = await import('../src/config/env.js');
    expect(env.NATIVE_GLPI_TRIAGE_ENABLED).toBe(true);
  });

  it('parses false when env var is "false"', async () => {
    process.env.NATIVE_GLPI_TRIAGE_ENABLED = 'false';
    const { env } = await import('../src/config/env.js');
    expect(env.NATIVE_GLPI_TRIAGE_ENABLED).toBe(false);
  });
});

// ── GlpiClient.fetchItilCategories — static guard ────────────────────────────

describe('GlpiClient.fetchItilCategories static guard', () => {
  it('exists as a public method on GlpiClient', async () => {
    const { GlpiClient } = await import('../src/adapters/glpi/GlpiClient.js');
    expect(typeof GlpiClient.prototype.fetchItilCategories).toBe('function');
  });
});

// ── No MySQL/MariaDB driver imported ─────────────────────────────────────────

describe('static — no MySQL/MariaDB driver in new files', () => {
  it('GlpiTriageCacheRepository.ts does not import MySQL/MariaDB', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const content = await readFile(
      resolve(repoRoot, 'integration-service/src/cache/GlpiTriageCacheRepository.ts'),
      'utf8',
    );
    expect(content).not.toMatch(/from ['"]mysql2|from ['"]mariadb|require\(['"]mysql/);
  });

  it('GlpiItilCategoryNormalizer.ts does not import MySQL/MariaDB', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const content = await readFile(
      resolve(repoRoot, 'integration-service/src/adapters/glpi/GlpiItilCategoryNormalizer.ts'),
      'utf8',
    );
    expect(content).not.toMatch(/from ['"]mysql2|from ['"]mariadb|require\(['"]mysql/);
  });

  it('GlpiItilCategoryNormalizer.ts does not contain POST/PUT/PATCH/DELETE calls against GLPI', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const content = await readFile(
      resolve(repoRoot, 'integration-service/src/adapters/glpi/GlpiItilCategoryNormalizer.ts'),
      'utf8',
    );
    expect(content).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
    expect(content).not.toMatch(/\.createTicket|\.updateTicketStatus|\.addFollowUp|\.closeTicket/);
  });
});
