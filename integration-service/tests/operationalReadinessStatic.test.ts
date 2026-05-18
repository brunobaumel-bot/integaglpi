import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '../..');

async function readRel(pathFromRepo: string): Promise<string> {
  return readFile(resolve(repoRoot, pathFromRepo), 'utf8');
}

function assertNoSecrets(value: string): void {
  expect(value).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]+/i);
  expect(value).not.toMatch(/META_ACCESS_TOKEN\s*[:=]\s*[^,\n"}]+/i);
  expect(value).not.toMatch(/GLPI_APP_TOKEN\s*[:=]\s*[^,\n"}]+/i);
  expect(value).not.toMatch(/GLPI_USER_TOKEN\s*[:=]\s*[^,\n"}]+/i);
  expect(value).not.toMatch(/DB_PASSWORD\s*[:=]\s*[^,\n"}]+/i);
  expect(value).not.toMatch(/INTEGRATION_SERVICE_API_KEY\s*[:=]\s*[^,\n"}]+/i);
}

describe('operational hardening readiness package (static)', () => {
  it('ships a package manifest without secrets and with critical metadata', async () => {
    const manifestText = await readRel('package_manifest.json');
    const manifest = JSON.parse(manifestText) as {
      build_id?: string;
      package_id?: string;
      phase_ids?: string[];
      critical_files?: Array<{ path?: string; sha256?: string }>;
      expected_migrations?: string[];
    };

    expect(manifest.build_id).toBe('integaglpi-8x-operational-hardening-2026-05-18');
    expect(manifest.package_id).toBe('integaglpi-production-readiness-mvp-001');
    expect(manifest.phase_ids).toContain('integaglpi_operational_hardening_and_production_readiness_001');
    expect(manifest.critical_files?.length).toBeGreaterThanOrEqual(10);
    expect(manifest.expected_migrations).toContain('023_entity_selection_attempt_finished_at.sql');
    expect(manifest.critical_files?.every((entry) => typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256))).toBe(true);
    expect(manifestText).not.toContain('D:\\');
    assertNoSecrets(manifestText);
  });

  it('adds read-only plugin diagnostics without server commands or destructive SQL', async () => {
    const files = await Promise.all([
      readRel('integaglpi/front/operational.diagnostics.php'),
      readRel('integaglpi/src/Service/RuntimeGuardService.php'),
      readRel('integaglpi/src/Service/OperationalDiagnosticsService.php'),
      readRel('integaglpi/src/Renderer/OperationalDiagnosticsRenderer.php'),
      readRel('integaglpi/templates/operational_diagnostics.php'),
      readRel('integaglpi/src/OperationalDiagnosticsMenu.php'),
    ]);
    const combined = files.join('\n');

    expect(combined).toContain('requireOperationalDiagnosticsRead');
    expect(combined).toContain('runtime_mismatch');
    expect(combined).toContain('package_incomplete');
    expect(combined).toContain('Somente leitura');
    expect(combined).not.toMatch(/\bshell_exec\s*\(/);
    expect(combined).not.toMatch(/\bexec\s*\(/);
    expect(combined).not.toMatch(/\bsystem\s*\(/);
    expect(combined).not.toMatch(/\bpassthru\s*\(/);
    expect(combined).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(combined).not.toMatch(/\bUPDATE\s+[a-z_]/i);
    expect(combined).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(combined).not.toMatch(/\bDROP\s+/i);
    assertNoSecrets(combined);
  });

  it('registers the operational diagnostics menu behind supervisor permissions', async () => {
    const setup = await readRel('integaglpi/setup.php');
    const plugin = await readRel('integaglpi/src/Plugin.php');

    expect(setup).toContain('OperationalDiagnosticsMenu');
    expect(setup).toContain('OperationalDiagnosticsMenu::class');
    expect(plugin).toContain('getOperationalDiagnosticsUrl');
    expect(plugin).toContain('canOperationalDiagnosticsRead');
    expect(plugin).toContain('return self::canSupervisorRead();');
  });

  it('exposes node readiness data through sanitized diagnostics helpers', async () => {
    const health = await readRel('integration-service/src/controllers/healthController.ts');
    const manifestService = await readRel('integration-service/src/services/RuntimeManifestService.ts');

    expect(health).toContain('readRuntimeManifest');
    expect(health).toContain('diagnostic_categories');
    expect(health).toContain('webhook_guard');
    expect(health).toContain('client_status: redisClient.status');
    expect(manifestService).toContain('package_incomplete');
    expect(manifestService).toContain('missing_critical_files');
    assertNoSecrets(health + manifestService);
  });

  it('documents manual production readiness, rollback, smoke and cloud without Git', async () => {
    const docs = await Promise.all([
      readRel('docs/runtime_manifest_readiness.md'),
      readRel('docs/producao_readiness_checklist.md'),
      readRel('docs/producao_rollback_playbook.md'),
      readRel('docs/producao_smoke_checklist.md'),
      readRel('docs/cloud_sem_git_package_playbook.md'),
    ]);
    const combined = docs.join('\n');

    expect(combined).toContain('Cloud sem Git');
    expect(combined).toContain('Rollback');
    expect(combined).toContain('Smoke Produção');
    expect(combined).toContain('OPcache');
    expect(combined).toContain('manual');
    assertNoSecrets(combined);
  });
});
