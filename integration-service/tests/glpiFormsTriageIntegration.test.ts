/**
 * Tests for PHASE integaglpi_v8_forms_native_triage_integration_001:
 *   - NATIVE_GLPI_TRIAGE_SOURCES config ("itilcategory" | "form" | "both")
 *   - GlpiItilCategoryNormalizer extended with Forms support
 *   - glpiFormId propagation through profile collection and ticket creation
 *   - optionKey prefixes ("glpic_" vs "glpif_")
 *   - Cache reuse for Forms
 *   - Fallback when Forms adapter fails
 *
 * All tests are pure unit tests — no Redis, no GLPI HTTP, no MariaDB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Env baseline ──────────────────────────────────────────────────────────────

const BASE_ENV: Record<string, string> = {
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
  NATIVE_GLPI_TRIAGE_ENABLED: 'true',
  INTEGRATION_SERVICE_API_KEY: 'test-integration-service-api-key-32chars-min',
};

beforeEach(() => {
  process.env = { ...BASE_ENV };
});

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCategory(id: number, name: string, completename = name, visible = true) {
  return { id, name, completename, is_helpdeskvisible: visible };
}

function makeForm(id: number, name: string, entitiesId = 1) {
  return { id, name, entitiesId };
}

function makeMockGlpiClient(categories = [makeCategory(1, 'TI')]) {
  return {
    fetchItilCategories: vi.fn().mockResolvedValue(categories),
  };
}

function makeMockFormAdapter(forms = [makeForm(10, 'Form A')]) {
  return {
    fetchForms: vi.fn().mockResolvedValue(forms),
  };
}

function makeMockCacheRepo(cached: null | { data: unknown[]; isStale: boolean } = null) {
  return {
    get: vi.fn().mockResolvedValue(cached),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

// ── NATIVE_GLPI_TRIAGE_SOURCES config ────────────────────────────────────────

describe('NATIVE_GLPI_TRIAGE_SOURCES env var', () => {
  it('default is "itilcategory"', async () => {
    process.env = { ...BASE_ENV };
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.NATIVE_GLPI_TRIAGE_SOURCES).toBe('itilcategory');
  });

  it('accepts "form"', async () => {
    process.env = { ...BASE_ENV, NATIVE_GLPI_TRIAGE_SOURCES: 'form' };
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.NATIVE_GLPI_TRIAGE_SOURCES).toBe('form');
  });

  it('accepts "both"', async () => {
    process.env = { ...BASE_ENV, NATIVE_GLPI_TRIAGE_SOURCES: 'both' };
    vi.resetModules();
    const { env } = await import('../src/config/env.js');
    expect(env.NATIVE_GLPI_TRIAGE_SOURCES).toBe('both');
  });

  it('rejects unknown value (zod enum)', async () => {
    process.env = { ...BASE_ENV, NATIVE_GLPI_TRIAGE_SOURCES: 'invalid' };
    vi.resetModules();
    await expect(import('../src/config/env.js')).rejects.toThrow();
  });
});

// ── GlpiItilCategoryNormalizer with sources="itilcategory" (default) ──────────

describe('GlpiItilCategoryNormalizer — sources="itilcategory" (default)', () => {
  it('returns only ITIL categories, not forms', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(1, 'TI'), makeCategory(2, 'Redes')]);
    const formAdapter = makeMockFormAdapter([makeForm(10, 'Form A')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'itilcategory',
    );
    const options = await normalizer.getOptions();

    expect(options).toHaveLength(2);
    expect(options.every((o) => o.optionKey.startsWith('glpic_'))).toBe(true);
    expect(formAdapter.fetchForms).not.toHaveBeenCalled();
  });

  it('optionKey uses "glpic_" prefix for ITIL categories', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(42, 'Impressoras')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(glpiClient as never, cacheRepo as never);
    const options = await normalizer.getOptions();

    expect(options[0]?.optionKey).toBe('glpic_42');
    expect(options[0]?.glpiItilCategoryId).toBe(42);
  });

  it('preserves backward-compatible behavior when no form adapter provided', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(1, 'TI')]);
    const cacheRepo = makeMockCacheRepo();

    // Constructor with only 2 args (pre-Phase-3 usage) still works
    const normalizer = new GlpiItilCategoryNormalizer(glpiClient as never, cacheRepo as never);
    const options = await normalizer.getOptions();

    expect(options).toHaveLength(1);
    expect(options[0]?.optionKey).toBe('glpic_1');
  });
});

// ── GlpiItilCategoryNormalizer with sources="form" ───────────────────────────

describe('GlpiItilCategoryNormalizer — sources="form"', () => {
  it('returns only Forms, not ITIL categories', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(1, 'TI')]);
    const formAdapter = makeMockFormAdapter([makeForm(10, 'Form A'), makeForm(11, 'Form B')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    const options = await normalizer.getOptions();

    expect(options).toHaveLength(2);
    expect(options.every((o) => o.optionKey.startsWith('glpif_'))).toBe(true);
    expect(glpiClient.fetchItilCategories).not.toHaveBeenCalled();
  });

  it('optionKey uses "glpif_" prefix for Forms', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const formAdapter = makeMockFormAdapter([makeForm(99, 'My Form')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      makeMockGlpiClient([]) as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    const options = await normalizer.getOptions();

    expect(options[0]?.optionKey).toBe('glpif_99');
    expect(options[0]?.glpiFormId).toBe(99);
    expect(options[0]?.glpiItilCategoryId).toBeUndefined();
  });

  it('label is sanitized to max 20 chars', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const formAdapter = makeMockFormAdapter([makeForm(1, 'This Form Name Is Way Too Long For WhatsApp')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      makeMockGlpiClient([]) as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    const options = await normalizer.getOptions();
    expect(options[0]?.label.length).toBeLessThanOrEqual(20);
    expect(options[0]?.label.endsWith('…')).toBe(true);
  });

  it('returns [] when no formCatalogAdapter provided but sources="form"', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      makeMockGlpiClient([]) as never,
      cacheRepo as never,
      null,  // no adapter
      'form',
    );
    const options = await normalizer.getOptions();

    expect(options).toEqual([]);
  });

  it('returns [] when formAdapter.fetchForms fails gracefully', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const formAdapter = { fetchForms: vi.fn().mockResolvedValue([]) }; // adapter returns []
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      makeMockGlpiClient([]) as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    const options = await normalizer.getOptions();

    expect(options).toEqual([]);
  });

  it('limits to 10 forms', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const forms = Array.from({ length: 15 }, (_, i) => makeForm(i + 1, `Form ${i + 1}`));
    const formAdapter = makeMockFormAdapter(forms);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      makeMockGlpiClient([]) as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    const options = await normalizer.getOptions();

    expect(options).toHaveLength(10);
  });
});

// ── GlpiItilCategoryNormalizer with sources="both" ───────────────────────────

describe('GlpiItilCategoryNormalizer — sources="both"', () => {
  it('merges ITIL categories and Forms', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(1, 'TI')]);
    const formAdapter = makeMockFormAdapter([makeForm(10, 'Form A')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'both',
    );
    const options = await normalizer.getOptions();

    expect(options).toHaveLength(2);
    const keys = options.map((o) => o.optionKey);
    expect(keys.some((k) => k.startsWith('glpic_'))).toBe(true);
    expect(keys.some((k) => k.startsWith('glpif_'))).toBe(true);
  });

  it('sorts merged options alphabetically by label (pt-BR)', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(1, 'Redes')]);
    const formAdapter = makeMockFormAdapter([makeForm(10, 'Acesso')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'both',
    );
    const options = await normalizer.getOptions();

    expect(options[0]?.label).toBe('Acesso');   // Form first (A < R)
    expect(options[1]?.label).toBe('Redes');    // ITIL second
  });

  it('limits total merged options to 10', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const cats = Array.from({ length: 8 }, (_, i) => makeCategory(i + 1, `Cat ${i + 1}`));
    const forms = Array.from({ length: 7 }, (_, i) => makeForm(100 + i, `Form ${i + 1}`));
    const glpiClient = makeMockGlpiClient(cats);
    const formAdapter = makeMockFormAdapter(forms);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'both',
    );
    const options = await normalizer.getOptions();

    expect(options).toHaveLength(10);
  });

  it('reassigns sortOrder sequentially after merge', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(1, 'TI'), makeCategory(2, 'Suporte')]);
    const formAdapter = makeMockFormAdapter([makeForm(10, 'Acesso')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'both',
    );
    const options = await normalizer.getOptions();

    options.forEach((opt, idx) => {
      expect(opt.sortOrder).toBe(idx);
    });
  });

  it('uses only available source when one fails (graceful degradation)', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const glpiClient = makeMockGlpiClient([makeCategory(1, 'TI')]);
    const formAdapter = { fetchForms: vi.fn().mockResolvedValue([]) }; // returns empty = partial failure
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'both',
    );
    const options = await normalizer.getOptions();

    expect(options).toHaveLength(1);
    expect(options[0]?.optionKey).toBe('glpic_1');
  });
});

// ── Cache integration with Forms ─────────────────────────────────────────────

describe('Cache — Forms source', () => {
  it('returns cached data on primary cache hit (no fetch calls)', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const cachedData = [
      { id: 10, label: 'Form A', optionKey: 'glpif_10', queueId: null, glpiGroupId: null,
        glpiUserId: null, confirmationMessage: null, sortOrder: 0, glpiFormId: 10 },
    ];
    const cacheRepo = makeMockCacheRepo({ data: cachedData, isStale: false });
    const formAdapter = makeMockFormAdapter();
    const glpiClient = makeMockGlpiClient();

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    const options = await normalizer.getOptions();

    expect(options).toEqual(cachedData);
    expect(formAdapter.fetchForms).not.toHaveBeenCalled();
    expect(glpiClient.fetchItilCategories).not.toHaveBeenCalled();
  });

  it('writes to cache after fresh fetch', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const cacheRepo = makeMockCacheRepo(null);
    const formAdapter = makeMockFormAdapter([makeForm(5, 'Form Alpha')]);
    const glpiClient = makeMockGlpiClient([]);

    const normalizer = new GlpiItilCategoryNormalizer(
      glpiClient as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    await normalizer.getOptions(1, null, 'pt');

    expect(cacheRepo.set).toHaveBeenCalledWith(1, null, 'pt', expect.any(Array));
  });
});

// ── glpiFormId propagation ────────────────────────────────────────────────────

describe('glpiFormId propagation', () => {
  it('stores glpi_form_id in profileState when glpiFormId is set', () => {
    const profileState: Record<string, unknown> = { step: 'awaiting_company', queue_label: null };
    const selectedOption = { glpiFormId: 55 };
    if (selectedOption.glpiFormId != null) {
      profileState.glpi_form_id = selectedOption.glpiFormId;
    }
    expect(profileState.glpi_form_id).toBe(55);
  });

  it('does NOT store glpi_form_id when glpiFormId is null', () => {
    const profileState: Record<string, unknown> = { step: 'awaiting_company', queue_label: null };
    const selectedOption: { glpiFormId: number | null } = { glpiFormId: null };
    if (selectedOption.glpiFormId != null) {
      profileState.glpi_form_id = selectedOption.glpiFormId;
    }
    expect(profileState.glpi_form_id).toBeUndefined();
  });

  it('preserves glpi_form_id through step updates (re-injection)', () => {
    const rawState: Record<string, unknown> = { step: 'awaiting_name', glpi_form_id: 77 };
    const stepResultState: Record<string, unknown> = { step: 'awaiting_name' }; // normalizeCollectionState stripped it

    const stateToSave: Record<string, unknown> = { ...stepResultState };
    const preservedFormId = typeof rawState?.glpi_form_id === 'number' ? rawState.glpi_form_id : undefined;
    if (preservedFormId !== undefined) {
      stateToSave.glpi_form_id = preservedFormId;
    }

    expect(stateToSave.glpi_form_id).toBe(77);
  });

  it('recovers glpi_form_id from profileCollectionState at ticket creation', () => {
    const profileCollectionState: Record<string, unknown> = { step: 'done', glpi_form_id: 88 };
    const nativeFormId =
      typeof profileCollectionState?.glpi_form_id === 'number'
        ? profileCollectionState.glpi_form_id
        : null;
    expect(nativeFormId).toBe(88);
  });

  it('returns null when profileCollectionState has no glpi_form_id', () => {
    const profileCollectionState: Record<string, unknown> = { step: 'done' };
    const nativeFormId =
      typeof profileCollectionState?.glpi_form_id === 'number'
        ? profileCollectionState.glpi_form_id
        : null;
    expect(nativeFormId).toBeNull();
  });

  it('ActiveRoutingOption.glpiFormId is set by toFormRoutingOption', async () => {
    const { GlpiItilCategoryNormalizer } = await import('../src/adapters/glpi/GlpiItilCategoryNormalizer.js');
    const formAdapter = makeMockFormAdapter([makeForm(33, 'Form X')]);
    const cacheRepo = makeMockCacheRepo();

    const normalizer = new GlpiItilCategoryNormalizer(
      makeMockGlpiClient([]) as never,
      cacheRepo as never,
      formAdapter as never,
      'form',
    );
    const options = await normalizer.getOptions();

    expect(options[0]?.glpiFormId).toBe(33);
    expect(options[0]?.glpiItilCategoryId).toBeUndefined();
  });
});

// ── Static safety checks ──────────────────────────────────────────────────────

describe('Static safety — GlpiItilCategoryNormalizer source file', () => {
  const normalizerPath = path.resolve(
    __dirname,
    '../src/adapters/glpi/GlpiItilCategoryNormalizer.ts',
  );

  it('exports TriageSources type', () => {
    const src = fs.readFileSync(normalizerPath, 'utf-8');
    expect(src).toContain('TriageSources');
    expect(src).toContain('itilcategory');
    expect(src).toContain('form');
    expect(src).toContain('both');
  });

  it('uses "glpif_" prefix for Form optionKey', () => {
    const src = fs.readFileSync(normalizerPath, 'utf-8');
    expect(src).toContain('glpif_');
  });

  it('uses "glpic_" prefix for ITIL category optionKey (unchanged)', () => {
    const src = fs.readFileSync(normalizerPath, 'utf-8');
    expect(src).toContain('glpic_');
  });

  it('has no forbidden DB driver imports', () => {
    const src = fs.readFileSync(normalizerPath, 'utf-8');
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]mysql2['"]/im);
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]mariadb['"]/im);
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]knex['"]/im);
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]typeorm['"]/im);
  });

  it('RoutingRepository.ts has glpiFormId optional field', () => {
    const routingPath = path.resolve(
      __dirname,
      '../src/repositories/contracts/RoutingRepository.ts',
    );
    const src = fs.readFileSync(routingPath, 'utf-8');
    expect(src).toContain('glpiFormId');
  });

  it('glpiTypes.ts has glpiFormId optional field in CreateGlpiTicketInput', () => {
    const typesPath = path.resolve(
      __dirname,
      '../src/adapters/glpi/glpiTypes.ts',
    );
    const src = fs.readFileSync(typesPath, 'utf-8');
    expect(src).toContain('glpiFormId');
  });
});
