import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..');
const syncServicePath = join(repoRoot, 'integaglpi', 'src', 'Service', 'ExternalSettingsSyncService.php');
const contactProfileConfigServicePath = join(repoRoot, 'integaglpi', 'src', 'Service', 'ContactProfileConfigService.php');
const pluginConfigServicePath = join(repoRoot, 'integaglpi', 'src', 'Service', 'PluginConfigService.php');
const configTemplatePath = join(repoRoot, 'integaglpi', 'templates', 'config.php');

describe('PHP external settings sync source', () => {
  it('syncs the selected entity_resolution_mode into the runtime entity_resolution context', async () => {
    const source = await readFile(syncServicePath, 'utf8');

    expect(source).toContain("self::syncEntityResolutionSettings($pdo, $values)");
    expect(source).toContain("self::upsertContext($pdo, 'entity_resolution'");
    expect(source).toContain("'entity_resolution_mode' => self::normalizeEntityResolutionMode");
    expect(source).toContain("return 'defer_until_known';");
    expect(source).not.toContain("return 'use_default_entity';");
    expect(source).not.toContain('insertEntityResolutionDefaults');
  });

  it('stores only manual entity selection and normalizes legacy modes', async () => {
    const source = await readFile(contactProfileConfigServicePath, 'utf8');

    expect(source).toContain("private const ENTITY_RESOLUTION_MODE_ALLOWED = ['defer_until_known'];");
    expect(source).toContain("if ($normalized === 'use_triage_entity' || $normalized === 'use_default_entity')");
    expect(source).toContain("return self::ENTITY_RESOLUTION_MODE_DEFAULT;");
    expect(source).toContain('$payload[self::ENTITY_RESOLUTION_MODE_FIELD]');
  });

  it('exposes only manual entity selection in the existing Recepção Inteligente form', async () => {
    const source = await readFile(configTemplatePath, 'utf8');

    expect(source).toContain('name="entity_resolution_mode"');
    expect(source).toContain('value="defer_until_known"');
    expect(source).not.toContain('value="use_default_entity"');
    expect(source).not.toContain('Usar entidade padrão');
    expect(source).not.toContain('value="use_triage_entity"');
  });

  it('normalizes business-hours booleans and never sends empty strings to PostgreSQL boolean fields', async () => {
    const service = await readFile(pluginConfigServicePath, 'utf8');
    const template = await readFile(configTemplatePath, 'utf8');

    expect(service).toContain('private function normalizeBool(mixed $value): bool');
    expect(service).toContain("if ($normalized === '')");
    expect(service).toContain("['1', 'true', 'on', 'yes']");
    expect(service).toContain("['0', 'false', 'off', 'no']");
    expect(service).toContain("PDO::PARAM_BOOL");
    expect(service).toContain('bindBusinessHoursParams');
    expect(service).toContain('requireTimeRange');
    expect(service).toContain('optionalTimeRange');
    expect(service).toContain('end time must be after start time');
    expect(template).toContain('type="hidden" name="business_hours_enabled" value="0"');
    expect(template).toContain('type="hidden" name="saturday_enabled" value="0"');
    expect(template).toContain('type="hidden" name="sunday_enabled" value="0"');
  });

  it('normalizes message catalog booleans and binds them as PostgreSQL booleans', async () => {
    const service = await readFile(pluginConfigServicePath, 'utf8');
    const template = await readFile(configTemplatePath, 'utf8');

    expect(service).toContain("'is_active' => $this->normalizeBool($input['is_active'] ?? false)");
    expect(service).toContain("'expects_response' => $this->normalizeBool($input['expects_response'] ?? false)");
    expect(service).toContain('bindMessageCatalogParams');
    expect(service).toContain("$stmt->bindValue(':is_active', (bool) $payload['is_active'], PDO::PARAM_BOOL)");
    expect(service).toContain("$stmt->bindValue(':expects_response', (bool) $payload['expects_response'], PDO::PARAM_BOOL)");
    expect(service).toContain('bindNullableString');
    expect(template).toContain('type="hidden" name="is_active" value="0"');
    expect(template).toContain('type="hidden" name="expects_response" value="0"');
  });
});
