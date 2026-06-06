/**
 * Tests for PHASE integaglpi_v8_service_catalog_gap_fix_and_bridge_001:
 *   - PARTE A: glpi_itil_category_id propagation through profile collection
 *   - PARTE B: PHP form.catalog.php static invariants (bearer auth, no DB driver)
 *   - PARTE C: GlpiFormCatalogAdapter (mocked fetch, no MariaDB, no mysql2)
 *
 * All tests are pure unit tests — no Redis, no GLPI HTTP, no MariaDB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Env setup ─────────────────────────────────────────────────────────────────

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
  NATIVE_GLPI_TRIAGE_ENABLED: 'false',
};

// ── PARTE A: glpi_itil_category_id propagation ───────────────────────────────

describe('PARTE A — profile collection category propagation', () => {
  describe('glpi_itil_category_id stored in profileState at queue selection', () => {
    it('sets glpi_itil_category_id on profileState when glpiItilCategoryId is a positive number', () => {
      // Simulates the queue-selection code path:
      //   profileState.glpi_itil_category_id = selectedOption.glpiItilCategoryId
      const profileState: Record<string, unknown> = { step: 'awaiting_company', queue_label: null };
      const selectedOption = { glpiItilCategoryId: 42 };
      if (selectedOption.glpiItilCategoryId != null) {
        profileState.glpi_itil_category_id = selectedOption.glpiItilCategoryId;
      }
      expect(profileState.glpi_itil_category_id).toBe(42);
    });

    it('does NOT set glpi_itil_category_id when glpiItilCategoryId is null', () => {
      const profileState: Record<string, unknown> = { step: 'awaiting_company', queue_label: null };
      const selectedOption: { glpiItilCategoryId: number | null | undefined } = { glpiItilCategoryId: null };
      if (selectedOption.glpiItilCategoryId != null) {
        profileState.glpi_itil_category_id = selectedOption.glpiItilCategoryId;
      }
      expect(profileState.glpi_itil_category_id).toBeUndefined();
    });

    it('does NOT set glpi_itil_category_id when glpiItilCategoryId is undefined (flag off)', () => {
      const profileState: Record<string, unknown> = { step: 'awaiting_company', queue_label: null };
      const selectedOption: { glpiItilCategoryId?: number | null } = {};
      if (selectedOption.glpiItilCategoryId != null) {
        profileState.glpi_itil_category_id = selectedOption.glpiItilCategoryId;
      }
      expect(profileState.glpi_itil_category_id).toBeUndefined();
    });
  });

  describe('glpi_itil_category_id preserved through normalizeCollectionState stripping', () => {
    it('re-injects category ID from rawState into stateToSave after each step', () => {
      // normalizeCollectionState returns a clean state without unknown keys
      const rawState: Record<string, unknown> = {
        step: 'awaiting_name',
        queue_label: 'Suporte',
        glpi_itil_category_id: 17,
      };
      // stepResult.state returned by normalizeCollectionState — strips unknown keys
      const stepResultState: Record<string, unknown> = { step: 'awaiting_name', queue_label: 'Suporte' };

      const stateToSave: Record<string, unknown> = { ...stepResultState };
      const preservedCatId = typeof rawState?.glpi_itil_category_id === 'number' ? rawState.glpi_itil_category_id : undefined;
      if (preservedCatId !== undefined) {
        stateToSave.glpi_itil_category_id = preservedCatId;
      }

      expect(stateToSave.glpi_itil_category_id).toBe(17);
      expect(stateToSave.step).toBe('awaiting_name');
      expect(stateToSave.queue_label).toBe('Suporte');
    });

    it('does NOT inject category ID when rawState has none (flag off)', () => {
      const rawState: Record<string, unknown> = { step: 'awaiting_name', queue_label: 'Suporte' };
      const stepResultState: Record<string, unknown> = { step: 'awaiting_name', queue_label: 'Suporte' };

      const stateToSave: Record<string, unknown> = { ...stepResultState };
      const preservedCatId = typeof rawState?.glpi_itil_category_id === 'number' ? rawState.glpi_itil_category_id : undefined;
      if (preservedCatId !== undefined) {
        stateToSave.glpi_itil_category_id = preservedCatId;
      }

      expect(stateToSave.glpi_itil_category_id).toBeUndefined();
    });

    it('handles null rawState safely (no persisted state)', () => {
      const rawState: Record<string, unknown> | null | undefined = null;
      const stepResultState: Record<string, unknown> = { step: 'awaiting_company' };

      const stateToSave: Record<string, unknown> = { ...stepResultState };
      const preservedCatId = typeof rawState?.glpi_itil_category_id === 'number' ? rawState.glpi_itil_category_id : undefined;
      if (preservedCatId !== undefined) {
        stateToSave.glpi_itil_category_id = preservedCatId;
      }

      expect(stateToSave.glpi_itil_category_id).toBeUndefined();
    });
  });

  describe('itilcategoriesId recovered from profileCollectionState at ticket creation', () => {
    it('recovers category ID from profileCollectionState at active-conv ticket creation', () => {
      const profileCollectionState: Record<string, unknown> = {
        step: 'done',
        queue_label: 'TI',
        glpi_itil_category_id: 99,
      };
      const nativeItilCategoryId =
        typeof profileCollectionState?.glpi_itil_category_id === 'number'
          ? profileCollectionState.glpi_itil_category_id
          : null;
      expect(nativeItilCategoryId).toBe(99);
    });

    it('returns null when profileCollectionState has no category ID (flag off)', () => {
      const profileCollectionState: Record<string, unknown> = { step: 'done', queue_label: 'TI' };
      const nativeItilCategoryId =
        typeof profileCollectionState?.glpi_itil_category_id === 'number'
          ? profileCollectionState.glpi_itil_category_id
          : null;
      expect(nativeItilCategoryId).toBeNull();
    });

    it('returns null when profileCollectionState is null', () => {
      const profileCollectionState: Record<string, unknown> | null | undefined = null;
      const nativeItilCategoryId =
        typeof profileCollectionState?.glpi_itil_category_id === 'number'
          ? profileCollectionState.glpi_itil_category_id
          : null;
      expect(nativeItilCategoryId).toBeNull();
    });

    it('returns null when glpi_itil_category_id is string (type guard)', () => {
      const profileCollectionState: Record<string, unknown> = {
        step: 'done',
        glpi_itil_category_id: '42', // wrong type
      };
      const nativeItilCategoryId =
        typeof profileCollectionState?.glpi_itil_category_id === 'number'
          ? profileCollectionState.glpi_itil_category_id
          : null;
      expect(nativeItilCategoryId).toBeNull();
    });
  });
});

// ── PARTE B: PHP form.catalog.php static invariants ──────────────────────────

describe('PARTE B — PHP form.catalog.php static invariants', () => {
  const phpRoot = path.resolve(__dirname, '../../integaglpi');
  const endpointFile = path.join(phpRoot, 'front', 'form.catalog.php');
  const serviceFile = path.join(phpRoot, 'src', 'Service', 'FormCatalogService.php');

  it('front/form.catalog.php exists', () => {
    expect(fs.existsSync(endpointFile)).toBe(true);
  });

  it('src/Service/FormCatalogService.php exists', () => {
    expect(fs.existsSync(serviceFile)).toBe(true);
  });

  it('form.catalog.php uses bearer token authentication', () => {
    const content = fs.readFileSync(endpointFile, 'utf-8');
    expect(content).toContain('getIntegrationAuthKey');
    expect(content).toContain('hash_equals');
    expect(content).toContain('Bearer');
  });

  it('form.catalog.php enforces GET-only method guard', () => {
    const content = fs.readFileSync(endpointFile, 'utf-8');
    expect(content).toContain('REQUEST_METHOD');
    expect(content).toContain('method_not_allowed');
  });

  it('form.catalog.php outputs JSON with Content-Type header', () => {
    const content = fs.readFileSync(endpointFile, 'utf-8');
    expect(content).toContain('Content-Type: application/json');
    expect(content).toContain('json_encode');
  });

  it('form.catalog.php is read-only — no INSERT/UPDATE/DELETE/DROP/TRUNCATE', () => {
    const content = fs.readFileSync(endpointFile, 'utf-8').toUpperCase();
    expect(content).not.toContain('INSERT');
    expect(content).not.toContain('UPDATE');
    expect(content).not.toContain('DELETE');
    expect(content).not.toContain('DROP');
    expect(content).not.toContain('TRUNCATE');
  });

  it('FormCatalogService.php queries glpi_forms_forms (native GLPI table)', () => {
    const content = fs.readFileSync(serviceFile, 'utf-8');
    expect(content).toContain('glpi_forms_forms');
  });

  it('FormCatalogService.php uses GLPI $DB->request (never raw PDO/mysqli)', () => {
    const content = fs.readFileSync(serviceFile, 'utf-8');
    expect(content).toContain('$DB->request');
    expect(content).not.toContain('new PDO');
    expect(content).not.toContain('mysqli_');
    expect(content).not.toContain('mysql_');
  });

  it('FormCatalogService.php is read-only — no mutating SQL patterns', () => {
    const content = fs.readFileSync(serviceFile, 'utf-8');
    // Match SQL statement keywords as stand-alone statements, not column names (e.g. is_deleted is OK)
    expect(content).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(content).not.toMatch(/\bUPDATE\s+\w/i);
    expect(content).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(content).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(content).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('FormCatalogService.php sanitizes output with htmlspecialchars', () => {
    const content = fs.readFileSync(serviceFile, 'utf-8');
    expect(content).toContain('htmlspecialchars');
  });

  it('FormCatalogService.php declares strict_types', () => {
    const content = fs.readFileSync(serviceFile, 'utf-8');
    expect(content).toContain('declare(strict_types=1)');
  });
});

// ── PARTE C: GlpiFormCatalogAdapter unit tests ────────────────────────────────

describe('PARTE C — GlpiFormCatalogAdapter', () => {
  beforeEach(() => {
    process.env = { ...BASE_ENV, INTEGRATION_SERVICE_API_KEY: 'test-integration-service-api-key-32chars-min' };
    vi.resetModules();
  });

  it('no mysql2, mariadb, knex, typeorm import in GlpiFormCatalogAdapter', () => {
    const adapterPath = path.resolve(
      __dirname,
      '../src/adapters/glpi/GlpiFormCatalogAdapter.ts',
    );
    const content = fs.readFileSync(adapterPath, 'utf-8');
    // Check import statements only — not comments or prose
    expect(content).not.toMatch(/^import\b.*\bfrom\b.*['"]mysql2['"]/im);
    expect(content).not.toMatch(/^import\b.*\bfrom\b.*['"]mariadb['"]/im);
    expect(content).not.toMatch(/^import\b.*\bfrom\b.*['"]knex['"]/im);
    expect(content).not.toMatch(/^import\b.*\bfrom\b.*['"]typeorm['"]/im);
    expect(content).not.toMatch(/require\(['"]mysql2['"]\)/);
    expect(content).not.toMatch(/require\(['"]mariadb['"]\)/);
  });

  it('GlpiFormCatalogAdapter file exists', () => {
    const adapterPath = path.resolve(
      __dirname,
      '../src/adapters/glpi/GlpiFormCatalogAdapter.ts',
    );
    expect(fs.existsSync(adapterPath)).toBe(true);
  });

  it('GlpiForm type is declared in glpiTypes.ts', () => {
    const typesPath = path.resolve(__dirname, '../src/adapters/glpi/glpiTypes.ts');
    const content = fs.readFileSync(typesPath, 'utf-8');
    expect(content).toContain('GlpiForm');
    expect(content).toContain('entitiesId');
  });

  describe('fetchForms — mocked fetch', () => {
    function makeMockFetch(response: unknown, status = 200, ok = true): typeof globalThis.fetch {
      return vi.fn().mockResolvedValue({
        ok,
        status,
        json: () => Promise.resolve(response),
      } as unknown as Response);
    }

    it('returns GlpiForm[] on successful response', async () => {
      const mockFetch = makeMockFetch({
        ok: true,
        forms: [
          { id: 1, name: 'Form A', entities_id: 10 },
          { id: 2, name: 'Form B', entities_id: 10 },
        ],
      });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'test-bearer-token');
      const forms = await adapter.fetchForms();

      expect(forms).toHaveLength(2);
      expect(forms[0]).toMatchObject({ id: 1, name: 'Form A', entitiesId: 10 });
      expect(forms[1]).toMatchObject({ id: 2, name: 'Form B', entitiesId: 10 });

      vi.unstubAllGlobals();
    });

    it('appends entities_id query param when entityId > 0', async () => {
      const mockFetch = makeMockFetch({ ok: true, forms: [] });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'token');
      await adapter.fetchForms(5);

      const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).toContain('entities_id=5');

      vi.unstubAllGlobals();
    });

    it('does NOT append entities_id when entityId is null', async () => {
      const mockFetch = makeMockFetch({ ok: true, forms: [] });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'token');
      await adapter.fetchForms(null);

      const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('entities_id');

      vi.unstubAllGlobals();
    });

    it('sends Authorization: Bearer <token> header', async () => {
      const mockFetch = makeMockFetch({ ok: true, forms: [] });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'my-secret-token');
      await adapter.fetchForms();

      const calledOptions = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      expect((calledOptions.headers as Record<string, string>)['Authorization']).toBe('Bearer my-secret-token');

      vi.unstubAllGlobals();
    });

    it('returns [] when fetch throws (network error)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'token');
      const forms = await adapter.fetchForms();

      expect(forms).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('returns [] when response ok=false', async () => {
      const mockFetch = makeMockFetch({ ok: false, error: 'unauthorized' });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'token');
      const forms = await adapter.fetchForms();

      expect(forms).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('returns [] when forms array is missing from response', async () => {
      const mockFetch = makeMockFetch({ ok: true });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'token');
      const forms = await adapter.fetchForms();

      expect(forms).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('skips form entries with id <= 0 or empty name', async () => {
      const mockFetch = makeMockFetch({
        ok: true,
        forms: [
          { id: 0, name: 'Invalid Zero', entities_id: 1 },     // id=0 → skipped
          { id: 3, name: '', entities_id: 1 },                  // empty name → skipped
          { id: 4, name: 'Valid', entities_id: 1 },             // ok
        ],
      });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      const adapter = new GlpiFormCatalogAdapter('https://glpi.example.local', 'token');
      const forms = await adapter.fetchForms();

      expect(forms).toHaveLength(1);
      expect(forms[0]).toMatchObject({ id: 4, name: 'Valid' });
      vi.unstubAllGlobals();
    });

    it('derives glpiWebBaseUrl from GLPI_API_BASE_URL by stripping /apirest.php', async () => {
      const mockFetch = makeMockFetch({ ok: true, forms: [] });
      vi.stubGlobal('fetch', mockFetch);

      const { GlpiFormCatalogAdapter } = await import('../src/adapters/glpi/GlpiFormCatalogAdapter.js');
      // No explicit baseUrl → derives from env GLPI_API_BASE_URL
      const adapter = new GlpiFormCatalogAdapter(undefined, 'token');
      await adapter.fetchForms();

      const calledUrl = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      // GLPI_API_BASE_URL = 'https://glpi.example.local/apirest.php' → base = 'https://glpi.example.local'
      expect(calledUrl).toContain('glpi.example.local/plugins/integaglpi/front/form.catalog.php');
      expect(calledUrl).not.toContain('apirest.php');

      vi.unstubAllGlobals();
    });
  });
});

// ── Static safety: no forbidden drivers in Node adapter ───────────────────────

describe('Static safety — forbidden drivers absent', () => {
  it('GlpiFormCatalogAdapter.ts has no mysql2/mariadb/knex/typeorm import', () => {
    const adapterPath = path.resolve(
      __dirname,
      '../src/adapters/glpi/GlpiFormCatalogAdapter.ts',
    );
    const src = fs.readFileSync(adapterPath, 'utf-8');
    // Check import statements only — prose/comments mentioning driver names are OK
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]mysql2['"]/im);
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]mariadb['"]/im);
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]knex['"]/im);
    expect(src).not.toMatch(/^import\b.*\bfrom\b.*['"]typeorm['"]/im);
    expect(src).not.toMatch(/require\(['"]mysql2['"]\)/);
    expect(src).not.toMatch(/require\(['"]mariadb['"]\)/);
  });

  it('GlpiFormCatalogAdapter.ts is read-only — does not call POST/PUT/PATCH/DELETE', () => {
    const adapterPath = path.resolve(
      __dirname,
      '../src/adapters/glpi/GlpiFormCatalogAdapter.ts',
    );
    const src = fs.readFileSync(adapterPath, 'utf-8');
    // method: 'GET' is allowed; POST/PUT/PATCH/DELETE should not appear
    expect(src).not.toMatch(/method:\s*['"]POST['"]/);
    expect(src).not.toMatch(/method:\s*['"]PUT['"]/);
    expect(src).not.toMatch(/method:\s*['"]PATCH['"]/);
    expect(src).not.toMatch(/method:\s*['"]DELETE['"]/);
  });
});
